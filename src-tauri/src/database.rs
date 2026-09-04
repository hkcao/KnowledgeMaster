use crate::models::*;
use rusqlite::{params, Connection, Transaction};
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;

const SCHEMA_VERSION: i64 = 1;
const DATA_VERSION: usize = 8;

pub fn load_or_migrate(root: &Path) -> Result<KnowledgeData, String> {
    let database = database_path(root);
    if database.exists() {
        return load(root);
    }

    let legacy = root.join("knowledge.json");
    let mut data = if legacy.exists() {
        serde_json::from_slice::<KnowledgeData>(&fs::read(&legacy).map_err(error)?)
            .map_err(error)?
    } else {
        KnowledgeData::default()
    };
    data.version = DATA_VERSION;
    repair_legacy_relations(&mut data);
    save(root, &data)?;
    if legacy.exists() {
        let backup = root.join("knowledge.json.migrated-v8.bak");
        fs::copy(&legacy, &backup).map_err(error)?;
        fs::remove_file(legacy).map_err(error)?;
    }
    Ok(data)
}

fn repair_legacy_relations(data: &mut KnowledgeData) {
    let document_ids = data
        .documents
        .iter()
        .map(|item| item.id)
        .collect::<HashSet<_>>();
    let topic_ids = data
        .topics
        .iter()
        .map(|item| item.id)
        .collect::<HashSet<_>>();
    for topic in &mut data.topics {
        if topic.parent_id.is_some_and(|id| !topic_ids.contains(&id)) {
            topic.parent_id = None;
        }
    }
    let mut document_topics = HashSet::new();
    data.document_topics.retain(|item| {
        document_ids.contains(&item.document_id)
            && topic_ids.contains(&item.topic_id)
            && document_topics.insert((item.document_id, item.topic_id))
    });
    let mut bookmarks = HashSet::new();
    data.bookmarks.retain(|item| {
        document_ids.contains(&item.document_id) && bookmarks.insert(item.document_id)
    });
    data.annotations
        .retain(|item| document_ids.contains(&item.document_id));
    for annotation in &mut data.annotations {
        annotation.rects = normalize_annotation_rects(std::mem::take(&mut annotation.rects));
    }
    let annotation_ids = data
        .annotations
        .iter()
        .map(|item| item.id)
        .collect::<HashSet<_>>();
    for conversation in &mut data.conversations {
        let mut conversation_documents = HashSet::new();
        conversation
            .document_ids
            .retain(|id| document_ids.contains(id));
        conversation
            .document_ids
            .retain(|id| conversation_documents.insert(*id));
        let mut conversation_topics = HashSet::new();
        conversation.topic_ids.retain(|id| topic_ids.contains(id));
        conversation
            .topic_ids
            .retain(|id| conversation_topics.insert(*id));
        if conversation
            .current_document_id
            .is_some_and(|id| !document_ids.contains(&id))
        {
            conversation.current_document_id = None;
        }
    }
    let mut topic_summaries = HashSet::new();
    data.topic_summaries
        .retain(|item| topic_ids.contains(&item.topic_id) && topic_summaries.insert(item.topic_id));
    for note in &mut data.summary_notes {
        let mut linked_annotations = HashSet::new();
        note.annotation_ids.retain(|id| annotation_ids.contains(id));
        note.annotation_ids
            .retain(|id| linked_annotations.insert(*id));
    }
}

pub fn load(root: &Path) -> Result<KnowledgeData, String> {
    let connection = connect(root)?;
    let mut data = KnowledgeData {
        version: DATA_VERSION,
        documents: load_documents(&connection)?,
        topics: load_topics(&connection)?,
        document_topics: load_document_topics(&connection)?,
        bookmarks: load_bookmarks(&connection)?,
        annotations: load_annotations(&connection)?,
        conversations: load_conversations(&connection)?,
        topic_summaries: load_topic_summaries(&connection)?,
        summary_notes: load_summary_notes(&connection)?,
    };
    for conversation in &mut data.conversations {
        conversation.summary_message_count = conversation
            .summary_message_count
            .min(conversation.messages.len());
    }
    Ok(data)
}

pub fn save(root: &Path, data: &KnowledgeData) -> Result<(), String> {
    let mut connection = connect(root)?;
    let transaction = connection.transaction().map_err(error)?;
    let mut sync = SyncState::load(&transaction)?;

    save_documents(&transaction, &mut sync, &data.documents)?;
    save_topics(&transaction, &mut sync, &data.topics)?;
    save_document_topics(&transaction, &mut sync, &data.document_topics)?;
    save_bookmarks(&transaction, &mut sync, &data.bookmarks)?;
    save_annotations(&transaction, &mut sync, &data.annotations)?;
    save_conversations(&transaction, &mut sync, &data.conversations)?;
    save_topic_summaries(&transaction, &mut sync, &data.topic_summaries)?;
    save_summary_notes(&transaction, &mut sync, &data.summary_notes)?;
    sync.remove_deleted(&transaction)?;
    transaction
        .execute(
            "INSERT INTO app_meta(key, value) VALUES('data_version', ?1)\
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [DATA_VERSION.to_string()],
        )
        .map_err(error)?;
    transaction.commit().map_err(error)
}

fn database_path(root: &Path) -> PathBuf {
    root.join("knowledge.db")
}

fn connect(root: &Path) -> Result<Connection, String> {
    fs::create_dir_all(root).map_err(error)?;
    let connection = Connection::open(database_path(root)).map_err(error)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(error)?;
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(error)?;
    connection
        .pragma_update(None, "journal_mode", "DELETE")
        .map_err(error)?;
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(error)?;
    ensure_schema(&connection)?;
    Ok(connection)
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(error)?;
    if version > SCHEMA_VERSION {
        return Err(format!(
            "资料库版本 {version} 高于当前应用支持的版本 {SCHEMA_VERSION}"
        ));
    }
    if version == SCHEMA_VERSION {
        return Ok(());
    }
    connection.execute_batch(SCHEMA).map_err(error)?;
    connection
        .pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(error)
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT,
    extension TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    stored_path TEXT,
    imported_at TEXT NOT NULL,
    status TEXT NOT NULL,
    page_count INTEGER,
    error TEXT,
    source_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(sha256);
CREATE INDEX IF NOT EXISTS idx_documents_name ON documents(name);
CREATE INDEX IF NOT EXISTS idx_documents_display_name ON documents(display_name);
CREATE TABLE IF NOT EXISTS document_authors (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY(document_id, position)
);
CREATE INDEX IF NOT EXISTS idx_document_authors_name ON document_authors(name);
CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES topics(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_parent ON topics(parent_id);
CREATE TABLE IF NOT EXISTS document_topics (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(document_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_document_topics_topic ON document_topics(topic_id, document_id);
CREATE TABLE IF NOT EXISTS bookmarks (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    page_index INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page INTEGER,
    quote TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('highlight', 'underline', 'note')),
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_document_page ON annotations(document_id, page);
CREATE TABLE IF NOT EXISTS annotation_rects (
    annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    page INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL CHECK(width > 0),
    height REAL NOT NULL CHECK(height > 0),
    PRIMARY KEY(annotation_id, position)
);
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    include_current_page INTEGER NOT NULL,
    include_annotations INTEGER NOT NULL,
    current_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    summary_message_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE TABLE IF NOT EXISTS conversation_documents (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY(conversation_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_documents_document ON conversation_documents(document_id);
CREATE TABLE IF NOT EXISTS conversation_topics (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY(conversation_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_topics_topic ON conversation_topics(topic_id);
CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    prompt_content TEXT,
    quote_json TEXT,
    sources_json TEXT,
    backend TEXT,
    generated_files_json TEXT,
    pending_imports_json TEXT,
    trace_events_json TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id, position);
CREATE TABLE IF NOT EXISTS agent_sessions (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    session_key TEXT NOT NULL,
    id TEXT NOT NULL,
    scope_signature TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    PRIMARY KEY(conversation_id, session_key)
);
CREATE TABLE IF NOT EXISTS topic_summaries (
    topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    summary TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS summary_notes (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    stored_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS summary_note_annotations (
    note_id TEXT NOT NULL REFERENCES summary_notes(id) ON DELETE CASCADE,
    annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY(note_id, annotation_id)
);
CREATE INDEX IF NOT EXISTS idx_summary_note_annotations_annotation ON summary_note_annotations(annotation_id);
CREATE TABLE IF NOT EXISTS entity_fingerprints (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    PRIMARY KEY(entity_type, entity_id)
);
"#;

struct SyncState {
    existing: HashMap<(String, String), String>,
    seen: HashSet<(String, String)>,
}

impl SyncState {
    fn load(transaction: &Transaction<'_>) -> Result<Self, String> {
        let mut statement = transaction
            .prepare("SELECT entity_type, entity_id, fingerprint FROM entity_fingerprints")
            .map_err(error)?;
        let rows = statement
            .query_map([], |row| Ok(((row.get(0)?, row.get(1)?), row.get(2)?)))
            .map_err(error)?
            .collect::<Result<HashMap<(String, String), String>, _>>()
            .map_err(error)?;
        Ok(Self {
            existing: rows,
            seen: HashSet::new(),
        })
    }

    fn changed<T: Serialize>(
        &mut self,
        entity_type: &str,
        entity_id: &str,
        position: usize,
        value: &T,
    ) -> Result<bool, String> {
        let key = (entity_type.to_string(), entity_id.to_string());
        let fingerprint = fingerprint(position, value)?;
        let changed = self.existing.get(&key) != Some(&fingerprint);
        self.seen.insert(key.clone());
        if changed {
            self.existing.insert(key, fingerprint);
        }
        Ok(changed)
    }

    fn record(
        &self,
        transaction: &Transaction<'_>,
        entity_type: &str,
        entity_id: &str,
    ) -> Result<(), String> {
        let key = (entity_type.to_string(), entity_id.to_string());
        let value = self.existing.get(&key).ok_or("元数据指纹缺失")?;
        transaction
            .execute(
                "INSERT INTO entity_fingerprints(entity_type, entity_id, fingerprint) VALUES(?1, ?2, ?3)\
                 ON CONFLICT(entity_type, entity_id) DO UPDATE SET fingerprint = excluded.fingerprint",
                params![entity_type, entity_id, value],
            )
            .map_err(error)?;
        Ok(())
    }

    fn remove_deleted(&self, transaction: &Transaction<'_>) -> Result<(), String> {
        let stale = self
            .existing
            .keys()
            .filter(|key| !self.seen.contains(*key))
            .cloned()
            .collect::<Vec<_>>();
        for (entity_type, entity_id) in stale {
            match entity_type.as_str() {
                "document" => delete(transaction, "documents", "id", &entity_id)?,
                "topic" => delete(transaction, "topics", "id", &entity_id)?,
                "document_topic" => {
                    if let Some((document_id, topic_id)) = entity_id.split_once(':') {
                        transaction
                            .execute(
                                "DELETE FROM document_topics WHERE document_id = ?1 AND topic_id = ?2",
                                params![document_id, topic_id],
                            )
                            .map_err(error)?;
                    }
                }
                "bookmark" => delete(transaction, "bookmarks", "document_id", &entity_id)?,
                "annotation" => delete(transaction, "annotations", "id", &entity_id)?,
                "conversation" => delete(transaction, "conversations", "id", &entity_id)?,
                "topic_summary" => delete(transaction, "topic_summaries", "topic_id", &entity_id)?,
                "summary_note" => delete(transaction, "summary_notes", "id", &entity_id)?,
                _ => {}
            }
            transaction
                .execute(
                    "DELETE FROM entity_fingerprints WHERE entity_type = ?1 AND entity_id = ?2",
                    params![entity_type, entity_id],
                )
                .map_err(error)?;
        }
        Ok(())
    }
}

fn delete(
    transaction: &Transaction<'_>,
    table: &str,
    column: &str,
    id: &str,
) -> Result<(), String> {
    transaction
        .execute(&format!("DELETE FROM {table} WHERE {column} = ?1"), [id])
        .map_err(error)?;
    Ok(())
}

fn fingerprint<T: Serialize>(position: usize, value: &T) -> Result<String, String> {
    let mut digest = Sha256::new();
    digest.update(position.to_le_bytes());
    digest.update(serde_json::to_vec(value).map_err(error)?);
    Ok(format!("{:x}", digest.finalize()))
}

fn save_documents(
    transaction: &Transaction<'_>,
    sync: &mut SyncState,
    values: &[KnowledgeDocument],
) -> Result<(), String> {
    for (position, value) in values.iter().enumerate() {
        let id = value.id.to_string();
        if !sync.changed("document", &id, position, value)? {
            continue;
        }
        transaction.execute(
            "INSERT INTO documents(id, position, name, display_name, extension, size, sha256, stored_path, imported_at, status, page_count, error, source_url)\
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)\
             ON CONFLICT(id) DO UPDATE SET position=excluded.position, name=excluded.name, display_name=excluded.display_name, extension=excluded.extension, size=excluded.size, sha256=excluded.sha256, stored_path=excluded.stored_path, imported_at=excluded.imported_at, status=excluded.status, page_count=excluded.page_count, error=excluded.error, source_url=excluded.source_url",
            params![id, position as i64, value.name, value.display_name, value.extension_name, value.size, value.sha256, value.stored_path, value.imported_at, value.status, value.page_count.map(|item| item as i64), value.error, value.source_url],
        ).map_err(error)?;
        transaction
            .execute("DELETE FROM document_authors WHERE document_id = ?1", [&id])
            .map_err(error)?;
        for (author_position, author) in value.authors.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO document_authors(document_id, position, name) VALUES(?1, ?2, ?3)",
                    params![id, author_position as i64, author],
                )
                .map_err(error)?;
        }
        sync.record(transaction, "document", &id)?;
    }
    Ok(())
}

fn save_topics(
    transaction: &Transaction<'_>,
    sync: &mut SyncState,
    values: &[Topic],
) -> Result<(), String> {
    for (position, value) in values.iter().enumerate() {
        let id = value.id.to_string();
        if !sync.changed("topic", &id, position, value)? {
            continue;
        }
        transaction.execute(
            "INSERT INTO topics(id, position, name, parent_id, created_at) VALUES(?1, ?2, ?3, ?4, ?5)\
             ON CONFLICT(id) DO UPDATE SET position=excluded.position, name=excluded.name, parent_id=excluded.parent_id, created_at=excluded.created_at",
            params![id, position as i64, value.name, value.parent_id.map(|item| item.to_string()), value.created_at],
        ).map_err(error)?;
        sync.record(transaction, "topic", &id)?;
    }
    Ok(())
}

fn save_document_topics(
    transaction: &Transaction<'_>,
    sync: &mut SyncState,
    values: &[DocumentTopic],
) -> Result<(), String> {
    for (position, value) in values.iter().enumerate() {
        let document_id = value.document_id.to_string();
        let topic_id = value.topic_id.to_string();
        let id = format!("{document_id}:{topic_id}");
        if !sync.changed("document_topic", &id, position, value)? {
            continue;
        }
        transaction.execute(
            "INSERT INTO document_topics(document_id, topic_id, position, created_at) VALUES(?1, ?2, ?3, ?4)\
             ON CONFLICT(document_id, topic_id) DO UPDATE SET position=excluded.position, created_at=excluded.created_at",
            params![document_id, topic_id, position as i64, value.created_at],
        ).map_err(error)?;
        sync.record(transaction, "document_topic", &id)?;
    }
    Ok(())
}

fn save_bookmarks(
    transaction: &Transaction<'_>,
    sync: &mut SyncState,
    values: &[DocumentBookmark],
) -> Result<(), String> {
    for (position, value) in values.iter().enumerate() {
        let id = value.document_id.to_string();
        if !sync.changed("bookmark", &id, position, value)? {
            continue;
        }
        transaction.execute(
            "INSERT INTO bookmarks(document_id, position, page_index, updated_at) VALUES(?1, ?2, ?3, ?4)\
             ON CONFLICT(document_id) DO UPDATE SET position=excluded.position, page_index=excluded.page_index, updated_at=excluded.updated_at",
            params![id, position as i64, value.page_index as i64, value.updated_at],
        ).map_err(error)?;
        sync.record(transaction, "bookmark", &id)?;
    }
    Ok(())
}

fn save_annotations(
    transaction: &Transaction<'_>,
    sync: &mut SyncState,
    values: &[KnowledgeAnnotation],
) -> Result<(), String> {
    for (position, value) in values.iter().enumerate() {
        let id = value.id.to_string();
        if !sync.changed("annotation", &id, position, value)? {
            continue;
        }
        transaction.execute(
            "INSERT INTO annotations(id, position, document_id, page, quote, kind, note, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)\
             ON CONFLICT(id) DO UPDATE SET position=excluded.position, document_id=excluded.document_id, page=excluded.page, quote=excluded.quote, kind=excluded.kind, note=excluded.note, created_at=excluded.created_at, updated_at=excluded.updated_at",
            params![id, position as i64, value.document_id.to_string(), value.page.map(|item| item as i64), value.quote, value.kind, value.note, value.created_at, value.updated_at],
        ).map_err(error)?;
        transaction
            .execute(
                "DELETE FROM annotation_rects WHERE annotation_id = ?1",
                [&id],
            )
            .map_err(error)?;
        for (rect_position, rect) in value.rects.iter().enumerate() {
            transaction.execute(
                "INSERT INTO annotation_rects(annotation_id, position, page, x, y, width, height) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, rect_position as i64, rect.page as i64, rect.x, rect.y, rect.width, rect.height],
            ).map_err(error)?;
        }
        sync.record(transaction, "annotation", &id)?;
    }
    Ok(())
}

fn save_conversations(
    transaction: &Transaction<'_>,
    sync: &mut SyncState,
    values: &[Conversation],
) -> Result<(), String> {
    for (position, value) in values.iter().enumerate() {
        let id = value.id.to_string();
        if !sync.changed("conversation", &id, position, value)? {
            continue;
        }
        transaction.execute(
            "INSERT INTO conversations(id, position, title, include_current_page, include_annotations, current_document_id, summary, summary_message_count, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)\
             ON CONFLICT(id) DO UPDATE SET position=excluded.position, title=excluded.title, include_current_page=excluded.include_current_page, include_annotations=excluded.include_annotations, current_document_id=excluded.current_document_id, summary=excluded.summary, summary_message_count=excluded.summary_message_count, created_at=excluded.created_at, updated_at=excluded.updated_at",
            params![id, position as i64, value.title, value.include_current_page as i64, value.include_annotations as i64, value.current_document_id.map(|item| item.to_string()), value.summary, value.summary_message_count as i64, value.created_at, value.updated_at],
        ).map_err(error)?;
        for table in [
            "conversation_documents",
            "conversation_topics",
            "conversation_messages",
            "agent_sessions",
        ] {
            transaction
                .execute(
                    &format!("DELETE FROM {table} WHERE conversation_id = ?1"),
                    [&id],
                )
                .map_err(error)?;
        }
        for (item_position, document_id) in value.document_ids.iter().enumerate() {
            transaction.execute(
                "INSERT INTO conversation_documents(conversation_id, document_id, position) VALUES(?1, ?2, ?3)",
                params![id, document_id.to_string(), item_position as i64],
            ).map_err(error)?;
        }
        for (item_position, topic_id) in value.topic_ids.iter().enumerate() {
            transaction.execute(
                "INSERT INTO conversation_topics(conversation_id, topic_id, position) VALUES(?1, ?2, ?3)",
                params![id, topic_id.to_string(), item_position as i64],
            ).map_err(error)?;
        }
        for (message_position, message) in value.messages.iter().enumerate() {
            transaction.execute(
                "INSERT INTO conversation_messages(id, conversation_id, position, role, content, prompt_content, quote_json, sources_json, backend, generated_files_json, pending_imports_json, trace_events_json, created_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![message.id.to_string(), id, message_position as i64, message.role, message.content, message.prompt_content, to_json_option(&message.quote)?, to_json_option(&message.sources)?, message.backend, to_json_option(&message.generated_files)?, to_json_option(&message.pending_imports)?, to_json_option(&message.trace_events)?, message.created_at],
            ).map_err(error)?;
        }
        for (session_key, session) in &value.agent_sessions {
            transaction.execute(
                "INSERT INTO agent_sessions(conversation_id, session_key, id, scope_signature, message_count) VALUES(?1, ?2, ?3, ?4, ?5)",
                params![id, session_key, session.id, session.scope_signature, session.message_count as i64],
            ).map_err(error)?;
        }
        sync.record(transaction, "conversation", &id)?;
    }
    Ok(())
}

fn save_topic_summaries(
    transaction: &Transaction<'_>,
    sync: &mut SyncState,
    values: &[TopicSummary],
) -> Result<(), String> {
    for (position, value) in values.iter().enumerate() {
        let id = value.topic_id.to_string();
        if !sync.changed("topic_summary", &id, position, value)? {
            continue;
        }
        transaction.execute(
            "INSERT INTO topic_summaries(topic_id, position, summary, updated_at) VALUES(?1, ?2, ?3, ?4)\
             ON CONFLICT(topic_id) DO UPDATE SET position=excluded.position, summary=excluded.summary, updated_at=excluded.updated_at",
            params![id, position as i64, value.summary, value.updated_at],
        ).map_err(error)?;
        sync.record(transaction, "topic_summary", &id)?;
    }
    Ok(())
}

fn save_summary_notes(
    transaction: &Transaction<'_>,
    sync: &mut SyncState,
    values: &[SummaryNote],
) -> Result<(), String> {
    for (position, value) in values.iter().enumerate() {
        let id = value.id.to_string();
        if !sync.changed("summary_note", &id, position, value)? {
            continue;
        }
        transaction.execute(
            "INSERT INTO summary_notes(id, position, title, content, stored_path, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)\
             ON CONFLICT(id) DO UPDATE SET position=excluded.position, title=excluded.title, content=excluded.content, stored_path=excluded.stored_path, created_at=excluded.created_at, updated_at=excluded.updated_at",
            params![id, position as i64, value.title, value.content, value.stored_path, value.created_at, value.updated_at],
        ).map_err(error)?;
        transaction
            .execute(
                "DELETE FROM summary_note_annotations WHERE note_id = ?1",
                [&id],
            )
            .map_err(error)?;
        for (item_position, annotation_id) in value.annotation_ids.iter().enumerate() {
            transaction.execute(
                "INSERT INTO summary_note_annotations(note_id, annotation_id, position) VALUES(?1, ?2, ?3)",
                params![id, annotation_id.to_string(), item_position as i64],
            ).map_err(error)?;
        }
        sync.record(transaction, "summary_note", &id)?;
    }
    Ok(())
}

fn load_documents(connection: &Connection) -> Result<Vec<KnowledgeDocument>, String> {
    let mut authors = HashMap::<String, Vec<String>>::new();
    let mut statement = connection
        .prepare("SELECT document_id, name FROM document_authors ORDER BY document_id, position")
        .map_err(error)?;
    for row in statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(error)?
    {
        let (id, name) = row.map_err(error)?;
        authors.entry(id).or_default().push(name);
    }
    let mut statement = connection.prepare("SELECT id, name, display_name, extension, size, sha256, stored_path, imported_at, status, page_count, error, source_url FROM documents ORDER BY position").map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
            ))
        })
        .map_err(error)?;
    let mut values = vec![];
    for row in rows {
        let (
            id,
            name,
            display_name,
            extension_name,
            size,
            sha256,
            stored_path,
            imported_at,
            status,
            page_count,
            item_error,
            source_url,
        ) = row.map_err(error)?;
        values.push(KnowledgeDocument {
            id: uuid(&id)?,
            name,
            display_name,
            authors: authors.remove(&id).unwrap_or_default(),
            extension_name,
            size,
            sha256,
            stored_path,
            imported_at,
            status,
            page_count: page_count.map(|item| item as usize),
            error: item_error,
            source_url,
        });
    }
    Ok(values)
}

fn load_topics(connection: &Connection) -> Result<Vec<Topic>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, parent_id, created_at FROM topics ORDER BY position")
        .map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(error)?;
    rows.map(|row| {
        let (id, name, parent_id, created_at) = row.map_err(error)?;
        Ok(Topic {
            id: uuid(&id)?,
            name,
            parent_id: parent_id.map(|item| uuid(&item)).transpose()?,
            created_at,
        })
    })
    .collect()
}

fn load_document_topics(connection: &Connection) -> Result<Vec<DocumentTopic>, String> {
    let mut statement = connection
        .prepare("SELECT document_id, topic_id, created_at FROM document_topics ORDER BY position")
        .map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(error)?;
    rows.map(|row| {
        let (document_id, topic_id, created_at) = row.map_err(error)?;
        Ok(DocumentTopic {
            document_id: uuid(&document_id)?,
            topic_id: uuid(&topic_id)?,
            created_at,
        })
    })
    .collect()
}

fn load_bookmarks(connection: &Connection) -> Result<Vec<DocumentBookmark>, String> {
    let mut statement = connection
        .prepare("SELECT document_id, page_index, updated_at FROM bookmarks ORDER BY position")
        .map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(error)?;
    rows.map(|row| {
        let (document_id, page_index, updated_at) = row.map_err(error)?;
        Ok(DocumentBookmark {
            document_id: uuid(&document_id)?,
            page_index: page_index as usize,
            updated_at,
        })
    })
    .collect()
}

fn load_annotations(connection: &Connection) -> Result<Vec<KnowledgeAnnotation>, String> {
    let mut rects = HashMap::<String, Vec<AnnotationRect>>::new();
    let mut statement = connection.prepare("SELECT annotation_id, page, x, y, width, height FROM annotation_rects ORDER BY annotation_id, position").map_err(error)?;
    for row in statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, f64>(5)?,
            ))
        })
        .map_err(error)?
    {
        let (id, page, x, y, width, height) = row.map_err(error)?;
        rects.entry(id).or_default().push(AnnotationRect {
            page: page as usize,
            x,
            y,
            width,
            height,
        });
    }
    let mut statement = connection.prepare("SELECT id, document_id, page, quote, kind, note, created_at, updated_at FROM annotations ORDER BY position").map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            ))
        })
        .map_err(error)?;
    let mut values = vec![];
    for row in rows {
        let (id, document_id, page, quote, kind, note, created_at, updated_at) =
            row.map_err(error)?;
        values.push(KnowledgeAnnotation {
            id: uuid(&id)?,
            document_id: uuid(&document_id)?,
            page: page.map(|item| item as usize),
            quote,
            kind,
            note,
            rects: rects.remove(&id).unwrap_or_default(),
            created_at,
            updated_at,
        });
    }
    Ok(values)
}

fn load_conversations(connection: &Connection) -> Result<Vec<Conversation>, String> {
    let document_ids = load_uuid_children(connection, "SELECT conversation_id, document_id FROM conversation_documents ORDER BY conversation_id, position")?;
    let topic_ids = load_uuid_children(connection, "SELECT conversation_id, topic_id FROM conversation_topics ORDER BY conversation_id, position")?;
    let mut messages = HashMap::<String, Vec<ChatMessage>>::new();
    let mut statement = connection.prepare("SELECT conversation_id, id, role, content, prompt_content, quote_json, sources_json, backend, generated_files_json, pending_imports_json, trace_events_json, created_at FROM conversation_messages ORDER BY conversation_id, position").map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, String>(11)?,
            ))
        })
        .map_err(error)?;
    for row in rows {
        let (
            conversation_id,
            id,
            role,
            content,
            prompt_content,
            quote,
            sources,
            backend,
            generated_files,
            pending_imports,
            trace_events,
            created_at,
        ) = row.map_err(error)?;
        messages
            .entry(conversation_id)
            .or_default()
            .push(ChatMessage {
                id: uuid(&id)?,
                role,
                content,
                prompt_content,
                quote: from_json_option(quote)?,
                sources: from_json_option(sources)?,
                backend,
                generated_files: from_json_option(generated_files)?,
                pending_imports: from_json_option(pending_imports)?,
                trace_events: from_json_option(trace_events)?,
                created_at,
            });
    }
    let mut sessions = HashMap::<String, HashMap<String, AgentSessionState>>::new();
    let mut statement = connection.prepare("SELECT conversation_id, session_key, id, scope_signature, message_count FROM agent_sessions").map_err(error)?;
    for row in statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(error)?
    {
        let (conversation_id, key, id, scope_signature, message_count) = row.map_err(error)?;
        sessions.entry(conversation_id).or_default().insert(
            key,
            AgentSessionState {
                id,
                scope_signature,
                message_count: message_count as usize,
            },
        );
    }
    let mut statement = connection.prepare("SELECT id, title, include_current_page, include_annotations, current_document_id, summary, summary_message_count, created_at, updated_at FROM conversations ORDER BY position").map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
            ))
        })
        .map_err(error)?;
    let mut values = vec![];
    for row in rows {
        let (
            id,
            title,
            include_current_page,
            include_annotations,
            current_document_id,
            summary,
            summary_message_count,
            created_at,
            updated_at,
        ) = row.map_err(error)?;
        values.push(Conversation {
            id: uuid(&id)?,
            title,
            document_ids: document_ids.get(&id).cloned().unwrap_or_default(),
            topic_ids: topic_ids.get(&id).cloned().unwrap_or_default(),
            include_current_page: include_current_page != 0,
            include_annotations: include_annotations != 0,
            current_document_id: current_document_id.map(|item| uuid(&item)).transpose()?,
            messages: messages.remove(&id).unwrap_or_default(),
            summary,
            summary_message_count: summary_message_count as usize,
            agent_sessions: sessions.remove(&id).unwrap_or_default(),
            created_at,
            updated_at,
        });
    }
    Ok(values)
}

fn load_uuid_children(
    connection: &Connection,
    sql: &str,
) -> Result<HashMap<String, Vec<Uuid>>, String> {
    let mut values = HashMap::<String, Vec<Uuid>>::new();
    let mut statement = connection.prepare(sql).map_err(error)?;
    for row in statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(error)?
    {
        let (parent, child) = row.map_err(error)?;
        values.entry(parent).or_default().push(uuid(&child)?);
    }
    Ok(values)
}

fn load_topic_summaries(connection: &Connection) -> Result<Vec<TopicSummary>, String> {
    let mut statement = connection
        .prepare("SELECT topic_id, summary, updated_at FROM topic_summaries ORDER BY position")
        .map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(error)?;
    rows.map(|row| {
        let (topic_id, summary, updated_at) = row.map_err(error)?;
        Ok(TopicSummary {
            topic_id: uuid(&topic_id)?,
            summary,
            updated_at,
        })
    })
    .collect()
}

fn load_summary_notes(connection: &Connection) -> Result<Vec<SummaryNote>, String> {
    let annotation_ids = load_uuid_children(
        connection,
        "SELECT note_id, annotation_id FROM summary_note_annotations ORDER BY note_id, position",
    )?;
    let mut statement = connection.prepare("SELECT id, title, content, stored_path, created_at, updated_at FROM summary_notes ORDER BY position").map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(error)?;
    let mut values = vec![];
    for row in rows {
        let (id, title, content, stored_path, created_at, updated_at) = row.map_err(error)?;
        values.push(SummaryNote {
            id: uuid(&id)?,
            title,
            content,
            stored_path,
            annotation_ids: annotation_ids.get(&id).cloned().unwrap_or_default(),
            created_at,
            updated_at,
        });
    }
    Ok(values)
}

fn to_json_option<T: Serialize>(value: &Option<T>) -> Result<Option<String>, String> {
    value
        .as_ref()
        .map(|item| serde_json::to_string(item).map_err(error))
        .transpose()
}

fn from_json_option<T: DeserializeOwned>(value: Option<String>) -> Result<Option<T>, String> {
    value
        .map(|item| serde_json::from_str(&item).map_err(error))
        .transpose()
}

fn uuid(value: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(error)
}

fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_data() -> KnowledgeData {
        let document_id = Uuid::new_v4();
        let topic_id = Uuid::new_v4();
        let annotation_id = Uuid::new_v4();
        let conversation_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();
        let note_id = Uuid::new_v4();
        let timestamp = now();
        KnowledgeData {
            version: DATA_VERSION,
            documents: vec![KnowledgeDocument {
                id: document_id,
                name: "paper.pdf".into(),
                display_name: Some("Zhao et al., Paper".into()),
                authors: vec!["Hank Zhao".into(), "Alice Li".into()],
                extension_name: ".pdf".into(),
                size: 42,
                sha256: "hash".into(),
                stored_path: Some("source/paper.pdf".into()),
                imported_at: timestamp.clone(),
                status: "ready".into(),
                page_count: Some(3),
                error: None,
                source_url: Some("https://example.com/paper.pdf".into()),
            }],
            topics: vec![Topic {
                id: topic_id,
                name: "研究".into(),
                parent_id: None,
                created_at: timestamp.clone(),
            }],
            document_topics: vec![DocumentTopic {
                document_id,
                topic_id,
                created_at: timestamp.clone(),
            }],
            bookmarks: vec![DocumentBookmark {
                document_id,
                page_index: 1,
                updated_at: timestamp.clone(),
            }],
            annotations: vec![KnowledgeAnnotation {
                id: annotation_id,
                document_id,
                page: Some(2),
                quote: "selected text".into(),
                kind: "highlight".into(),
                note: "note".into(),
                rects: vec![AnnotationRect {
                    page: 2,
                    x: 1.0,
                    y: 2.0,
                    width: 3.0,
                    height: 4.0,
                }],
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
            }],
            conversations: vec![Conversation {
                id: conversation_id,
                title: "Chat".into(),
                document_ids: vec![document_id],
                topic_ids: vec![topic_id],
                include_current_page: true,
                include_annotations: true,
                current_document_id: Some(document_id),
                messages: vec![ChatMessage {
                    id: message_id,
                    role: "user".into(),
                    content: "question".into(),
                    prompt_content: Some("internal".into()),
                    quote: Some(ReaderQuote {
                        text: "selected text".into(),
                        document_id: Some(document_id),
                        document_name: "paper.pdf".into(),
                        page: Some(2),
                        image_base64: None,
                    }),
                    sources: None,
                    backend: Some("direct".into()),
                    generated_files: Some(vec![]),
                    pending_imports: None,
                    trace_events: None,
                    created_at: timestamp.clone(),
                }],
                summary: "summary".into(),
                summary_message_count: 1,
                agent_sessions: HashMap::from([(
                    "codex".into(),
                    AgentSessionState {
                        id: "session".into(),
                        scope_signature: "scope".into(),
                        message_count: 1,
                    },
                )]),
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
            }],
            topic_summaries: vec![TopicSummary {
                topic_id,
                summary: "topic summary".into(),
                updated_at: timestamp.clone(),
            }],
            summary_notes: vec![SummaryNote {
                id: note_id,
                title: "Overview".into(),
                content: "Body".into(),
                stored_path: Some(format!("source/notes/{note_id}.md")),
                annotation_ids: vec![annotation_id],
                created_at: timestamp.clone(),
                updated_at: timestamp,
            }],
        }
    }

    #[test]
    fn sqlite_round_trip_preserves_normalized_metadata() {
        let root = tempfile::tempdir().unwrap();
        let data = sample_data();
        save(root.path(), &data).unwrap();
        let loaded = load(root.path()).unwrap();
        assert_eq!(
            serde_json::to_value(loaded).unwrap(),
            serde_json::to_value(data).unwrap()
        );
    }

    #[test]
    fn legacy_json_is_migrated_once_and_kept_as_backup() {
        let root = tempfile::tempdir().unwrap();
        let mut data = sample_data();
        data.annotations[0].rects.push(AnnotationRect {
            page: 2,
            x: 1.1,
            y: 2.1,
            width: 2.8,
            height: 3.8,
        });
        fs::write(
            root.path().join("knowledge.json"),
            serde_json::to_vec(&data).unwrap(),
        )
        .unwrap();
        let loaded = load_or_migrate(root.path()).unwrap();
        assert_eq!(loaded.documents.len(), 1);
        assert_eq!(loaded.annotations[0].rects.len(), 1);
        assert!(root.path().join("knowledge.db").exists());
        assert!(root.path().join("knowledge.json.migrated-v8.bak").exists());
        assert!(!root.path().join("knowledge.json").exists());
    }

    #[test]
    fn snapshot_sync_deletes_removed_rows() {
        let root = tempfile::tempdir().unwrap();
        let mut data = sample_data();
        save(root.path(), &data).unwrap();
        data.annotations.clear();
        data.summary_notes[0].annotation_ids.clear();
        save(root.path(), &data).unwrap();
        assert!(load(root.path()).unwrap().annotations.is_empty());
    }
}

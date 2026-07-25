use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use sha2::{Sha256, Digest};
use uuid::Uuid;
use crate::models::*;
use crate::errors::{AppError, AppResult};

pub struct KnowledgeStore {
    pub data: KnowledgeData,
    pub root_path: PathBuf,
}

impl KnowledgeStore {
    fn config_path() -> Option<PathBuf> {
        let dir = dirs::config_dir()?.join("knowledge-master");
        Some(dir.join("config.json"))
    }

    fn saved_library_root() -> Option<PathBuf> {
        let path = Self::config_path()?;
        if path.exists() {
            let content = std::fs::read_to_string(&path).ok()?;
            let config: serde_json::Value = serde_json::from_str(&content).ok()?;
            config.get("library_root")
                .and_then(|v| v.as_str())
                .map(PathBuf::from)
        } else {
            None
        }
    }

    fn save_library_root(path: &Path) {
        if let Some(config_path) = Self::config_path() {
            if let Some(parent) = config_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let config = serde_json::json!({"library_root": path.to_string_lossy()});
            let _ = std::fs::write(&config_path, serde_json::to_string(&config).unwrap_or_default());
        }
    }

    pub fn new(root_path: Option<PathBuf>) -> AppResult<Self> {
        let default_root = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
            .join("KnowledgeMaster")
            .join("library");
        let root_path = root_path
            .or_else(Self::saved_library_root)
            .unwrap_or(default_root);
        let mut store = Self {
            data: KnowledgeData::new(),
            root_path,
        };
        store.prepare_directories()?;
        store.load()?;
        Ok(store)
    }

    pub fn source_dir(&self) -> PathBuf { self.root_path.join("source") }
    pub fn documents_dir(&self) -> PathBuf { self.source_dir().join("documents") }
    pub fn index_dir(&self) -> PathBuf { self.source_dir().join("index") }
    pub fn notes_dir(&self) -> PathBuf { self.source_dir().join("notes") }
    pub fn metadata_path(&self) -> PathBuf { self.root_path.join("knowledge.json") }

    pub fn generated_dir(&self, conversation_id: Uuid) -> PathBuf {
        self.source_dir().join("generated").join(conversation_id.to_string())
    }

    pub fn agent_cache_dir(&self) -> PathBuf {
        self.source_dir().join("generated").join("agent-cache")
    }

    pub fn pending_agent_downloads_dir(&self, run_id: Uuid) -> PathBuf {
        self.source_dir().join("downloads").join("pending").join(run_id.to_string())
    }

    fn prepare_directories(&self) -> AppResult<()> {
        for dir in &[self.root_path.clone(), self.documents_dir(), self.index_dir(), self.notes_dir(),
                      self.source_dir().join("downloads"), self.source_dir().join("generated")] {
            fs::create_dir_all(dir)?;
        }
        Ok(())
    }

    fn load(&mut self) -> AppResult<()> {
        let path = self.metadata_path();
        if !path.exists() {
            return self.save();
        }
        let content = fs::read_to_string(&path)?;
        self.data = serde_json::from_str(&content)?;
        self.data.version = 5;
        self.migrate_summary_notes()?;
        Ok(())
    }

    pub fn save(&self) -> AppResult<()> {
        self.prepare_directories()?;
        let encoded = serde_json::to_string_pretty(&self.data)?;
        let path = self.metadata_path();
        let backup = self.root_path.join("knowledge.json.bak");
        if path.exists() {
            let _ = fs::remove_file(&backup);
            let _ = fs::copy(&path, &backup);
        }
        let mut file = tempfile::NamedTempFile::new_in(&self.root_path)?;
        file.write_all(encoded.as_bytes())?;
        file.persist(&path).map_err(|e| AppError::Io(e.error))?;
        Ok(())
    }

    pub fn switch_root(&mut self, new_root: PathBuf, migrate: bool) -> AppResult<()> {
        Self::save_library_root(&new_root);
        if migrate && new_root != self.root_path {
            fs::create_dir_all(&new_root)?;
            for name in &["knowledge.json", "knowledge.json.bak", "source"] {
                let src = self.root_path.join(name);
                let dst = new_root.join(name);
                if src.exists() && !dst.exists() {
                    if src.is_dir() {
                        copy_dir_recursive(&src, &dst)?;
                    } else {
                        fs::copy(&src, &dst)?;
                    }
                }
            }
        }
        self.root_path = new_root;
        self.data = KnowledgeData::new();
        self.prepare_directories()?;
        self.load()?;
        Ok(())
    }

    pub fn stored_path_for(&self, document: &KnowledgeDocument) -> PathBuf {
        if let Some(ref stored_path) = document.stored_path {
            if stored_path.starts_with('/') {
                return PathBuf::from(stored_path);
            }
            return self.root_path.join(stored_path);
        }
        self.documents_dir()
            .join(document.id.to_string())
            .join(&document.name)
    }

    pub fn extracted_content_for(&self, document_id: Uuid) -> AppResult<ExtractedDocument> {
        let path = self.index_dir().join(format!("{}.json", document_id));
        if !path.exists() {
            return Ok(ExtractedDocument { text: String::new(), pages: Vec::new() });
        }
        let content = fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&content)?)
    }

    pub fn import_files(&mut self, urls: &[PathBuf]) -> AppResult<Vec<String>> {
        let supported = ["pdf", "html", "htm", "md", "markdown", "txt", "doc", "docx"];
        let mut messages = Vec::new();

        for source in urls {
            let ext = source.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();

            if !supported.contains(&ext.as_str()) {
                messages.push(format!("不支持：{}", source.file_name().unwrap_or_default().to_string_lossy()));
                continue;
            }

            let filename = source.file_name().unwrap_or_default().to_string_lossy().to_string();
            if self.data.documents.iter().any(|d| d.name.to_lowercase() == filename.to_lowercase()) {
                messages.push(format!("同名丢弃：{}", filename));
                continue;
            }

            let file_data = fs::read(source)?;
            let mut hasher = Sha256::new();
            hasher.update(&file_data);
            let digest = hex::encode(hasher.finalize());

            if self.data.documents.iter().any(|d| d.sha256 == digest) {
                messages.push(format!("内容重复：{}", filename));
                continue;
            }

            let id = Uuid::new_v4();
            let stored_name = flat_stored_filename(id, &filename);
            let relative = format!("source/documents/{}", stored_name);
            let destination = self.root_path.join(&relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(source, &destination)?;

            let extracted = crate::extraction::extract(&destination)
                .unwrap_or_else(|_| ExtractedDocument { text: String::new(), pages: Vec::new() });
            let index_path = self.index_dir().join(format!("{}.json", id));
            let index_json = serde_json::to_string_pretty(&extracted).unwrap_or_default();
            let _ = fs::write(&index_path, index_json);

            let display_name = if ext == "pdf" {
                crate::extraction::paper_display_name_at(&destination)
            } else {
                None
            };

            let size = fs::metadata(source)?.len() as i64;
            self.data.documents.push(KnowledgeDocument {
                id,
                name: filename.clone(),
                display_name,
                extension_name: format!(".{}", ext),
                size,
                sha256: digest,
                stored_path: Some(relative),
                imported_at: chrono::Utc::now(),
                status: "ready".into(),
                page_count: if extracted.pages.is_empty() { None } else { Some(extracted.pages.len() as i32) },
                error: None,
                source_url: None,
            });

            self.save()?;
            messages.push(format!("已导入：{}", filename));
        }
        Ok(messages)
    }

    pub fn delete_document(&mut self, id: Uuid) -> AppResult<()> {
        let doc = match self.data.documents.iter().find(|d| d.id == id) {
            Some(d) => d.clone(),
            None => return Ok(()),
        };

        let file_path = self.stored_path_for(&doc);
        let _ = fs::remove_file(&file_path);
        // Clean up empty parent dir if it's under documents/
        if let Some(parent) = file_path.parent() {
            if parent.starts_with(self.documents_dir()) {
                let _ = fs::remove_dir(parent);
            }
        }

        let index_path = self.index_dir().join(format!("{}.json", id));
        let _ = fs::remove_file(&index_path);

        self.data.documents.retain(|d| d.id != id);
        self.data.document_topics.retain(|dt| dt.document_id != id);
        self.data.bookmarks.retain(|b| b.document_id != id);

        let removed_annotation_ids: Vec<Uuid> = self.data.annotations.iter()
            .filter(|a| a.document_id == id)
            .map(|a| a.id)
            .collect();
        self.data.annotations.retain(|a| a.document_id != id);

        for note in &mut self.data.summary_notes {
            note.annotation_ids.retain(|aid| !removed_annotation_ids.contains(aid));
        }

        for conv in &mut self.data.conversations {
            conv.document_ids.retain(|did| *did != id);
            if conv.current_document_id == Some(id) {
                conv.current_document_id = None;
            }
        }

        self.save()?;
        Ok(())
    }

    pub fn update_display_name(&mut self, id: Uuid, display_name: Option<String>) -> AppResult<()> {
        if let Some(doc) = self.data.documents.iter_mut().find(|d| d.id == id) {
            let value = display_name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
            doc.display_name = value;
            self.save()?;
        }
        Ok(())
    }

    pub fn create_topic(&mut self, name: &str, parent_id: Option<Uuid>) -> AppResult<Option<Topic>> {
        let name = name.trim().to_string();
        if name.is_empty() { return Ok(None); }
        if let Some(pid) = parent_id {
            if !self.data.topics.iter().any(|t| t.id == pid) { return Ok(None); }
        }
        let topic = Topic {
            id: Uuid::new_v4(),
            name,
            parent_id,
            created_at: chrono::Utc::now(),
        };
        self.data.topics.push(topic.clone());
        self.save()?;
        Ok(Some(topic))
    }

    pub fn rename_topic(&mut self, id: Uuid, name: &str) -> AppResult<()> {
        let name = name.trim().to_string();
        if name.is_empty() { return Ok(()); }
        if let Some(topic) = self.data.topics.iter_mut().find(|t| t.id == id) {
            topic.name = name;
            self.save()?;
        }
        Ok(())
    }

    pub fn delete_topic(&mut self, id: Uuid) -> AppResult<()> {
        if !self.data.topics.iter().any(|t| t.id == id) { return Ok(()); }
        let mut removed = std::collections::HashSet::new();
        removed.insert(id);
        loop {
            let before = removed.len();
            let children: Vec<Uuid> = self.data.topics.iter()
                .filter(|t| t.parent_id.map_or(false, |pid| removed.contains(&pid)))
                .map(|t| t.id)
                .collect();
            removed.extend(children);
            if removed.len() == before { break; }
        }
        self.data.topics.retain(|t| !removed.contains(&t.id));
        self.data.document_topics.retain(|dt| !removed.contains(&dt.topic_id));
        self.save()?;
        Ok(())
    }

    pub fn link_document(&mut self, document_id: Uuid, topic_id: Uuid) -> AppResult<()> {
        if self.data.document_topics.iter().any(|dt| dt.document_id == document_id && dt.topic_id == topic_id) {
            return Ok(());
        }
        self.data.document_topics.push(DocumentTopic {
            document_id,
            topic_id,
            created_at: chrono::Utc::now(),
        });
        self.save()?;
        Ok(())
    }

    pub fn unlink_document(&mut self, document_id: Uuid, topic_id: Uuid) -> AppResult<()> {
        self.data.document_topics.retain(|dt| dt.document_id != document_id || dt.topic_id != topic_id);
        self.save()?;
        Ok(())
    }

    pub fn move_document(&mut self, document_id: Uuid, from_topic: Option<Uuid>, to_topic: Option<Uuid>) -> AppResult<bool> {
        if !self.data.documents.iter().any(|d| d.id == document_id) { return Ok(false); }
        if let Some(ref tid) = to_topic {
            if !self.data.topics.iter().any(|t| t.id == *tid) { return Ok(false); }
        }
        if from_topic == to_topic { return Ok(false); }

        if let Some(ref tid) = to_topic {
            if !self.data.document_topics.iter().any(|dt| dt.document_id == document_id && dt.topic_id == *tid) {
                self.data.document_topics.push(DocumentTopic {
                    document_id,
                    topic_id: *tid,
                    created_at: chrono::Utc::now(),
                });
            }
        }

        if let Some(ref fid) = from_topic {
            self.data.document_topics.retain(|dt| dt.document_id != document_id || dt.topic_id != *fid);
        } else if to_topic.is_none() {
            return Ok(false);
        }

        if to_topic.is_none() {
            self.data.document_topics.retain(|dt| dt.document_id != document_id);
        }

        self.save()?;
        Ok(true)
    }

    pub fn bookmark_page_for(&self, document_id: Uuid) -> Option<i32> {
        self.data.bookmarks.iter()
            .find(|b| b.document_id == document_id)
            .map(|b| b.page_index)
    }

    pub fn toggle_bookmark(&mut self, document_id: Uuid, page_index: i32) -> AppResult<bool> {
        if page_index < 0 { return Ok(false); }
        if let Some(doc) = self.data.documents.iter().find(|d| d.id == document_id) {
            if doc.extension_name != ".pdf" { return Ok(false); }
            if let Some(ref pc) = doc.page_count {
                if page_index >= *pc { return Ok(false); }
            }
        } else {
            return Ok(false);
        }

        if let Some(idx) = self.data.bookmarks.iter().position(|b| b.document_id == document_id) {
            if self.data.bookmarks[idx].page_index == page_index {
                self.data.bookmarks.remove(idx);
                self.save()?;
                return Ok(false);
            }
            self.data.bookmarks[idx].page_index = page_index;
            self.data.bookmarks[idx].updated_at = chrono::Utc::now();
        } else {
            self.data.bookmarks.push(DocumentBookmark {
                document_id,
                page_index,
                updated_at: chrono::Utc::now(),
            });
        }
        self.save()?;
        Ok(true)
    }

    pub fn add_annotation(&mut self, document_id: Uuid, selection: &ReaderSelection, kind: &str, note: &str) -> AppResult<KnowledgeAnnotation> {
        let annotation = KnowledgeAnnotation {
            id: Uuid::new_v4(),
            document_id,
            page: selection.page,
            quote: selection.text.clone(),
            kind: kind.to_string(),
            note: note.to_string(),
            rects: selection.rects.clone(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        self.data.annotations.push(annotation.clone());
        self.save()?;
        Ok(annotation)
    }

    pub fn update_annotation(&mut self, id: Uuid, note: &str) -> AppResult<()> {
        if let Some(ann) = self.data.annotations.iter_mut().find(|a| a.id == id) {
            ann.note = note.to_string();
            ann.updated_at = chrono::Utc::now();
            self.save()?;
        }
        Ok(())
    }

    pub fn delete_annotation(&mut self, id: Uuid) -> AppResult<()> {
        self.data.annotations.retain(|a| a.id != id);
        for note in &mut self.data.summary_notes {
            note.annotation_ids.retain(|aid| *aid != id);
        }
        self.save()?;
        Ok(())
    }

    pub fn annotations_for(&self, document_id: Uuid) -> Vec<KnowledgeAnnotation> {
        self.data.annotations.iter()
            .filter(|a| a.document_id == document_id)
            .cloned()
            .collect()
    }

    pub fn create_summary_note(&mut self, title: &str, content: &str, annotation_ids: &[Uuid]) -> AppResult<Option<SummaryNote>> {
        let title = title.trim().to_string();
        if title.is_empty() { return Ok(None); }
        let valid_ids: std::collections::HashSet<Uuid> = self.data.annotations.iter().map(|a| a.id).collect();
        let filtered_ids: Vec<Uuid> = annotation_ids.iter().filter(|id| valid_ids.contains(id)).copied().collect();
        let content = content.trim().to_string();

        let id = Uuid::new_v4();
        let stored_path = format!("source/notes/{}.md", id);
        let target = self.root_path.join(&stored_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let md = summary_note_markdown(&title, &content);
        fs::write(&target, &md)?;

        let note = SummaryNote {
            id,
            title,
            content,
            stored_path: Some(stored_path),
            annotation_ids: filtered_ids,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        self.data.summary_notes.insert(0, note.clone());
        self.save()?;
        Ok(Some(note))
    }

    pub fn update_summary_note(&mut self, id: Uuid, title: &str, content: &str, annotation_ids: &[Uuid]) -> AppResult<()> {
        let idx = match self.data.summary_notes.iter().position(|n| n.id == id) {
            Some(i) => i,
            None => return Ok(()),
        };
        let title = title.trim().to_string();
        if title.is_empty() { return Ok(()); }
        let content = content.trim().to_string();
        let valid_ids: std::collections::HashSet<Uuid> = self.data.annotations.iter().map(|a| a.id).collect();
        let filtered_ids: Vec<Uuid> = annotation_ids.iter().filter(|id| valid_ids.contains(id)).copied().collect();

        let stored_path = self.data.summary_notes[idx].stored_path.clone()
            .unwrap_or_else(|| format!("source/notes/{}.md", id));
        let target = self.root_path.join(&stored_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let md = summary_note_markdown(&title, &content);
        fs::write(&target, &md)?;

        self.data.summary_notes[idx].title = title;
        self.data.summary_notes[idx].content = content;
        self.data.summary_notes[idx].stored_path = Some(stored_path);
        self.data.summary_notes[idx].annotation_ids = filtered_ids;
        self.data.summary_notes[idx].updated_at = chrono::Utc::now();
        self.save()?;
        Ok(())
    }

    pub fn delete_summary_note(&mut self, id: Uuid) -> AppResult<()> {
        if let Some(note) = self.data.summary_notes.iter().find(|n| n.id == id) {
            if let Some(ref sp) = note.stored_path {
                if sp.starts_with("source/notes/") {
                    let _ = fs::remove_file(self.root_path.join(sp));
                }
            }
        }
        self.data.summary_notes.retain(|n| n.id != id);
        self.save()?;
        Ok(())
    }

    pub fn summary_note_markdown_for(&self, note: &SummaryNote) -> AppResult<String> {
        if let Some(ref sp) = note.stored_path {
            if sp.starts_with("source/notes/") {
                let path = self.root_path.join(sp);
                if path.exists() {
                    return Ok(fs::read_to_string(&path)?);
                }
            }
        }
        Ok(summary_note_markdown(&note.title, &note.content))
    }

    pub fn search(&self, query: &str, topic_id: Option<Uuid>) -> Vec<KnowledgeDocument> {
        let terms = query_terms(query);
        if terms.is_empty() {
            return self.documents_for_topic(topic_id);
        }
        self.documents_for_topic(topic_id).into_iter().filter(|doc| {
            let content = self.extracted_content_for(doc.id)
                .map(|e| e.text.to_lowercase())
                .unwrap_or_default();
            let name = (doc.name.clone() + "\n" + &doc.display_title()).to_lowercase();
            terms.iter().any(|t| content.contains(t) || name.contains(t))
        }).collect()
    }

    pub fn documents_for_topic(&self, topic_id: Option<Uuid>) -> Vec<KnowledgeDocument> {
        match topic_id {
            Some(tid) => {
                let ids: std::collections::HashSet<Uuid> = self.data.document_topics.iter()
                    .filter(|dt| dt.topic_id == tid)
                    .map(|dt| dt.document_id)
                    .collect();
                self.data.documents.iter().filter(|d| ids.contains(&d.id)).cloned().collect()
            }
            None => self.data.documents.clone(),
        }
    }

    pub fn save_conversation(&mut self, conversation: &Conversation) -> AppResult<()> {
        if let Some(idx) = self.data.conversations.iter().position(|c| c.id == conversation.id) {
            self.data.conversations[idx] = conversation.clone();
        } else {
            self.data.conversations.insert(0, conversation.clone());
        }
        self.save()?;
        Ok(())
    }

    pub fn context_chunks(&self, query: &str, document_ids: &[Uuid], topic_ids: &[Uuid]) -> Vec<ContextChunk> {
        let topic_doc_ids: Vec<Uuid> = self.data.document_topics.iter()
            .filter(|dt| topic_ids.contains(&dt.topic_id))
            .map(|dt| dt.document_id)
            .collect();
        let all_ids: std::collections::HashSet<Uuid> = document_ids.iter().chain(topic_doc_ids.iter()).copied().collect();
        let selected_docs: Vec<&KnowledgeDocument> = self.data.documents.iter()
            .filter(|d| all_ids.contains(&d.id))
            .collect();

        let mut candidates: Vec<(i32, &KnowledgeDocument, Option<i32>, String)> = Vec::new();
        for doc in &selected_docs {
            if let Ok(extracted) = self.extracted_content_for(doc.id) {
                if extracted.pages.is_empty() {
                    for chunk in chunks(&extracted.text, 1400, 180) {
                        candidates.push((score(query, &chunk, &doc.display_title()), *doc, None, chunk));
                    }
                } else {
                    for page in &extracted.pages {
                        for chunk in chunks(&page.text, 1400, 180) {
                            candidates.push((score(query, &chunk, &doc.display_title()), *doc, Some(page.number), chunk));
                        }
                    }
                }
            }
        }

        candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));

        let mut selected: Vec<(i32, &KnowledgeDocument, Option<i32>, String)> = Vec::new();
        let mut used = std::collections::HashSet::new();

        for doc in selected_docs.iter().take(10) {
            if let Some(best) = candidates.iter().find(|c| c.1.id == doc.id) {
                let key = format!("{}:{:?}:{}", best.1.id, best.2, best.3);
                if used.insert(key) {
                    selected.push(best.clone());
                }
            }
        }
        for item in &candidates {
            if selected.len() >= 10 { break; }
            let key = format!("{}:{:?}:{}", item.1.id, item.2, item.3);
            if used.insert(key) {
                selected.push(item.clone());
            }
        }

        selected.iter().take(10).enumerate().map(|(i, item)| {
            ContextChunk {
                id: Uuid::new_v4(),
                label: format!("资料{}", i + 1),
                document_id: item.1.id,
                document_name: item.1.display_title(),
                page: item.2,
                text: item.3.clone(),
            }
        }).collect()
    }

    pub fn recommend_topics_for(&self, document: &KnowledgeDocument) -> Vec<TopicRecommendation> {
        let material = format!("{}\n{}",
            document.display_title(),
            self.extracted_content_for(document.id)
                .map(|e| e.text.chars().take(3000).collect::<String>())
                .unwrap_or_default()
        ).to_lowercase();

        let rules: Vec<(&str, Vec<&str>)> = vec![
            ("RAG与知识库", vec!["rag", "知识库", "检索增强", "rerank"]),
            ("Agent", vec!["agent", "智能体", "工具调用"]),
            ("大模型", vec!["大模型", "llm", "transformer", "prompt"]),
            ("向量数据库", vec!["向量数据库", "embedding", "milvus", "pgvector"]),
            ("存储系统", vec!["存储系统", "文件系统", "对象存储", "nvme"]),
            ("AI Infra", vec!["ai infra", "gpu", "推理集群", "模型服务"]),
            ("软件开发", vec!["软件开发", "编程", "api", "架构设计"]),
        ];

        rules.into_iter().filter_map(|(name, keywords)| {
            let hits: Vec<&str> = keywords.iter().filter(|k| material.contains(*k)).copied().collect();
            if hits.is_empty() { return None; }
            Some(TopicRecommendation {
                name: name.to_string(),
                reason: format!("命中：{}", hits.iter().take(3).copied().collect::<Vec<_>>().join("、")),
            })
        }).take(3).collect()
    }

    pub fn apply_recommendations(&mut self, recommendations: &[TopicRecommendation], document_id: Uuid) -> AppResult<()> {
        for rec in recommendations {
            let tid = self.data.topics.iter()
                .find(|t| t.name.to_lowercase() == rec.name.to_lowercase())
                .map(|t| t.id)
                .unwrap_or_else(|| {
                    let id = Uuid::new_v4();
                    self.data.topics.push(Topic {
                        id,
                        name: rec.name.clone(),
                        parent_id: None,
                        created_at: chrono::Utc::now(),
                    });
                    id
                });
            self.link_document(document_id, tid)?;
        }
        self.save()?;
        Ok(())
    }

    pub fn annotation_context(&self, query: &str, document_ids: &[Uuid], topic_ids: &[Uuid]) -> Vec<KnowledgeAnnotation> {
        let topic_doc_ids: Vec<Uuid> = self.data.document_topics.iter()
            .filter(|dt| topic_ids.contains(&dt.topic_id))
            .map(|dt| dt.document_id)
            .collect();
        let selected: std::collections::HashSet<Uuid> = document_ids.iter().chain(topic_doc_ids.iter()).copied().collect();

        let mut annotations: Vec<&KnowledgeAnnotation> = self.data.annotations.iter()
            .filter(|a| selected.contains(&a.document_id))
            .collect();

        annotations.sort_by(|a, b| {
            let sa = score(query, &(a.quote.clone() + "\n" + &a.note), "");
            let sb = score(query, &(b.quote.clone() + "\n" + &b.note), "");
            sb.cmp(&sa)
        });

        annotations.iter().take(30).cloned().cloned().collect()
    }

    pub fn agent_documents(&self, document_ids: &[Uuid], topic_ids: &[Uuid]) -> Vec<AgentDocument> {
        let all_ids = all_selected_ids(&self.data.document_topics, document_ids, topic_ids);
        self.data.documents.iter()
            .filter(|d| all_ids.contains(&d.id))
            .map(|doc| {
                let content = self.extracted_content_for(doc.id).map(|e| {
                    if e.pages.is_empty() {
                        e.text
                    } else {
                        e.pages.iter()
                            .map(|p| format!("## 第 {} 页\n\n{}", p.number, p.text))
                            .collect::<Vec<_>>()
                            .join("\n\n")
                    }
                }).unwrap_or_default();
                AgentDocument {
                    id: doc.id,
                    name: doc.display_title(),
                    content,
                }
            })
            .collect()
    }

    pub fn agent_source_documents(&self, document_ids: &[Uuid], topic_ids: &[Uuid]) -> Vec<AgentSourceDocument> {
        let all_ids = all_selected_ids(&self.data.document_topics, document_ids, topic_ids);
        let agent_cache = self.agent_cache_dir();
        let index_dir = self.index_dir();

        self.data.documents.iter()
            .filter(|d| all_ids.contains(&d.id))
            .map(|doc| {
                let baseline = index_dir.join(format!("{}.json", doc.id));
                AgentSourceDocument {
                    id: doc.id,
                    name: doc.name.clone(),
                    display_name: Some(doc.display_title()),
                    source_url: self.stored_path_for(doc),
                    cache_url: agent_cache.join(doc.id.to_string()),
                    baseline_extraction_url: if baseline.exists() { Some(baseline) } else { None },
                }
            })
            .collect()
    }

    fn migrate_summary_notes(&mut self) -> AppResult<()> {
        let notes_dir = self.notes_dir();
        for note in &mut self.data.summary_notes {
            let expected = format!("source/notes/{}.md", note.id);
            if note.stored_path.is_none() {
                note.stored_path = Some(expected);
            }
            if let Some(ref sp) = note.stored_path {
                if sp.starts_with("source/notes/") {
                    let path = self.root_path.join(sp);
                    if let Some(parent) = path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if !path.exists() {
                        let md = summary_note_markdown(&note.title, &note.content);
                        let _ = fs::write(&path, &md);
                    }
                }
            }
        }
        Ok(())
    }
}

// -- Helpers --

fn dirs_next() -> Option<PathBuf> {
    dirs::data_dir()
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(&entry.path(), &target)?;
        }
    }
    Ok(())
}

pub fn flat_stored_filename(id: Uuid, original_name: &str) -> String {
    let safe = original_name.replace('/', "_").replace(':', "_");
    format!("{}--{}", id, if safe.is_empty() { "document" } else { &safe })
}

pub fn query_terms(query: &str) -> Vec<String> {
    query.to_lowercase()
        .split(|c: char| c.is_whitespace() || c.is_ascii_punctuation())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn score(query: &str, text: &str, title: &str) -> i32 {
    let terms = query_terms(query);
    let body = text.to_lowercase();
    let name = title.to_lowercase();
    terms.iter().map(|t| {
        (if body.contains(t) { 2 } else { 0 }) + (if name.contains(t) { 8 } else { 0 })
    }).sum()
}

pub fn chunks(text: &str, size: usize, overlap: usize) -> Vec<String> {
    if text.is_empty() { return Vec::new(); }
    let chars: Vec<char> = text.chars().collect();
    let mut result = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let end = (start + size).min(chars.len());
        result.push(chars[start..end].iter().collect());
        if end == chars.len() { break; }
        start = end.saturating_sub(overlap);
    }
    result
}

pub fn summary_note_markdown(title: &str, content: &str) -> String {
    format!("# {}\n\n{}\n", title.trim(), content.trim())
}

fn all_selected_ids(doc_topics: &[DocumentTopic], document_ids: &[Uuid], topic_ids: &[Uuid]) -> std::collections::HashSet<Uuid> {
    let topic_doc_ids: Vec<Uuid> = doc_topics.iter()
        .filter(|dt| topic_ids.contains(&dt.topic_id))
        .map(|dt| dt.document_id)
        .collect();
    document_ids.iter().chain(topic_doc_ids.iter()).copied().collect()
}

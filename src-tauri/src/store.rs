use crate::models::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;
use walkdir::WalkDir;

pub const SUPPORTED_EXTENSIONS: &[&str] =
    &["pdf", "html", "htm", "md", "markdown", "txt", "doc", "docx"];

#[derive(Clone)]
pub struct Inner {
    pub root: PathBuf,
    pub data: KnowledgeData,
    pub settings: AppSettings,
}

pub struct AppState {
    pub inner: Mutex<Inner>,
    pub processes: Mutex<HashMap<String, u32>>,
    pub cancelled_runs: Mutex<HashSet<String>>,
    pub api_key_cache: Mutex<Option<String>>,
}

impl AppState {
    pub fn load() -> Result<Self, String> {
        let settings = load_local_settings()?;
        let root = load_root_preference().unwrap_or_else(default_root);
        prepare_directories(&root)?;
        let mut data = load_data(&root)?;
        migrate_notes(&root, &mut data)?;
        save_data(&root, &data)?;
        Ok(Self {
            inner: Mutex::new(Inner {
                root,
                data,
                settings,
            }),
            processes: Mutex::new(HashMap::new()),
            cancelled_runs: Mutex::new(HashSet::new()),
            api_key_cache: Mutex::new(None),
        })
    }
}

fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("KnowledgeMaster")
}

fn default_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("KnowledgeMaster")
        .join("library")
}

fn local_settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

fn root_preference_path() -> PathBuf {
    config_dir().join("library-root.txt")
}

pub fn load_local_settings() -> Result<AppSettings, String> {
    let path = local_settings_path();
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    serde_json::from_slice(&fs::read(path).map_err(error)?).map_err(error)
}

pub fn save_local_settings(settings: &AppSettings) -> Result<(), String> {
    fs::create_dir_all(config_dir()).map_err(error)?;
    fs::write(
        local_settings_path(),
        serde_json::to_vec_pretty(settings).map_err(error)?,
    )
    .map_err(error)
}

fn load_root_preference() -> Option<PathBuf> {
    let value = fs::read_to_string(root_preference_path()).ok()?;
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| PathBuf::from(trimmed))
}

pub fn save_root_preference(root: &Path) -> Result<(), String> {
    fs::create_dir_all(config_dir()).map_err(error)?;
    fs::write(root_preference_path(), root.to_string_lossy().as_bytes()).map_err(error)
}

pub fn source_dir(root: &Path) -> PathBuf {
    root.join("source")
}

pub fn library_root_from_selection(path: &Path) -> Result<PathBuf, String> {
    let selected = absolute_clean(path)?;
    let selected_source = selected
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("source"));
    if selected_source {
        selected
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "source 目录缺少上级目录".to_string())
    } else {
        Ok(selected)
    }
}

pub fn documents_dir(root: &Path) -> PathBuf {
    source_dir(root).join("documents")
}
pub fn index_dir(root: &Path) -> PathBuf {
    source_dir(root).join("index")
}
pub fn notes_dir(root: &Path) -> PathBuf {
    source_dir(root).join("notes")
}
pub fn cache_dir(root: &Path) -> PathBuf {
    source_dir(root).join("generated").join("agent-cache")
}
pub fn pending_dir(root: &Path) -> PathBuf {
    source_dir(root).join("downloads").join("pending")
}

pub fn prepare_directories(root: &Path) -> Result<(), String> {
    for path in [
        root.to_path_buf(),
        documents_dir(root),
        index_dir(root),
        notes_dir(root),
        source_dir(root).join("downloads"),
        pending_dir(root),
        source_dir(root).join("generated"),
        cache_dir(root),
    ] {
        fs::create_dir_all(path).map_err(error)?;
    }
    Ok(())
}

pub fn load_data(root: &Path) -> Result<KnowledgeData, String> {
    let path = root.join("knowledge.json");
    if !path.exists() {
        return Ok(KnowledgeData::default());
    }
    let mut data: KnowledgeData =
        serde_json::from_slice(&fs::read(path).map_err(error)?).map_err(error)?;
    data.version = 6;
    for conversation in &mut data.conversations {
        conversation.summary_message_count = conversation
            .summary_message_count
            .min(conversation.messages.len());
    }
    Ok(data)
}

pub fn save_data(root: &Path, data: &KnowledgeData) -> Result<(), String> {
    prepare_directories(root)?;
    let metadata = root.join("knowledge.json");
    let backup = root.join("knowledge.json.bak");
    let temporary = root.join("knowledge.json.tmp");
    if metadata.exists() {
        let _ = fs::copy(&metadata, &backup);
    }
    fs::write(&temporary, serde_json::to_vec_pretty(data).map_err(error)?).map_err(error)?;
    #[cfg(windows)]
    if metadata.exists() {
        fs::remove_file(&metadata).map_err(error)?;
    }
    fs::rename(&temporary, &metadata).map_err(error)
}

pub fn switch_root(inner: &mut Inner, target: PathBuf, migrate: bool) -> Result<(), String> {
    let target = library_root_from_selection(&target)?;
    if migrate && target != inner.root {
        fs::create_dir_all(&target).map_err(error)?;
        for name in ["knowledge.json", "knowledge.json.bak", "source"] {
            let source = inner.root.join(name);
            let destination = target.join(name);
            if source.exists() && !destination.exists() {
                if source.is_dir() {
                    copy_tree(&source, &destination)?;
                } else {
                    fs::copy(source, destination).map_err(error)?;
                }
            }
        }
    }
    prepare_directories(&target)?;
    inner.root = target;
    inner.data = load_data(&inner.root)?;
    migrate_notes(&inner.root, &mut inner.data)?;
    save_root_preference(&inner.root)?;
    save_data(&inner.root, &inner.data)
}

pub fn stored_path(root: &Path, document: &KnowledgeDocument) -> Result<PathBuf, String> {
    let relative = document
        .stored_path
        .as_deref()
        .ok_or_else(|| "资料缺少存储路径".to_string())?;
    let value = PathBuf::from(relative);
    if value.is_absolute() {
        return Ok(value);
    }
    let candidate = root.join(value);
    ensure_inside(root, &candidate)?;
    Ok(candidate)
}

pub fn extract_path(path: &Path) -> Result<ExtractedDocument, String> {
    let extension = extension(path);
    match extension.as_str() {
        "pdf" => {
            let text = pdf_extract::extract_text(path).map_err(error)?;
            let parts: Vec<String> = text
                .split('\u{c}')
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .collect();
            let page_count = lopdf::Document::load(path)
                .map(|document| document.get_pages().len())
                .unwrap_or_else(|_| parts.len().max(1));
            let pages = if parts.len() > 1 {
                parts
                    .into_iter()
                    .enumerate()
                    .map(|(index, text)| ExtractedPage {
                        number: index + 1,
                        text,
                    })
                    .collect()
            } else {
                let mut values = vec![ExtractedPage {
                    number: 1,
                    text: text.clone(),
                }];
                values.extend((1..page_count).map(|index| ExtractedPage {
                    number: index + 1,
                    text: String::new(),
                }));
                values
            };
            Ok(ExtractedDocument { text, pages })
        }
        "html" | "htm" => {
            let bytes = fs::read(path).map_err(error)?;
            let source = String::from_utf8_lossy(&bytes);
            let parsed = scraper::Html::parse_document(&source);
            let text = parsed.root_element().text().collect::<Vec<_>>().join(" ");
            Ok(ExtractedDocument {
                text: normalize_whitespace(&text),
                pages: vec![],
            })
        }
        "docx" => extract_docx(path),
        "doc" => Ok(ExtractedDocument {
            text: "该 DOC 原件已保留；当前平台未能提取可检索正文。".into(),
            pages: vec![],
        }),
        _ => Ok(ExtractedDocument {
            text: fs::read_to_string(path).map_err(error)?,
            pages: vec![],
        }),
    }
}

fn extract_docx(path: &Path) -> Result<ExtractedDocument, String> {
    let file = fs::File::open(path).map_err(error)?;
    let mut archive = zip::ZipArchive::new(file).map_err(error)?;
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(error)?
        .read_to_string(&mut xml)
        .map_err(error)?;
    let paragraph = Regex::new(r"</w:p>").unwrap().replace_all(&xml, "\n");
    let stripped = Regex::new(r"<[^>]+>").unwrap().replace_all(&paragraph, "");
    let text = stripped
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"");
    Ok(ExtractedDocument {
        text,
        pages: vec![],
    })
}

pub fn read_extracted(root: &Path, id: Uuid) -> ExtractedDocument {
    let path = index_dir(root).join(format!("{id}.json"));
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn import_paths(inner: &mut Inner, paths: &[String]) -> Vec<String> {
    let mut files = vec![];
    for raw in paths {
        let path = PathBuf::from(raw);
        if path.is_dir() {
            files.extend(
                WalkDir::new(path)
                    .follow_links(false)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_type().is_file())
                    .map(|entry| entry.into_path())
                    .filter(|path| SUPPORTED_EXTENSIONS.contains(&extension(path).as_str())),
            );
        } else {
            files.push(path);
        }
    }
    let mut messages = vec![];
    for path in files {
        match import_one(inner, &path, None) {
            Ok(message) => messages.push(message),
            Err(message) => messages.push(format!("导入失败：{}（{message}）", file_name(&path))),
        }
    }
    if messages.is_empty() {
        messages.push("拖入的内容中没有支持的文件".into());
    }
    messages
}

pub fn import_one(
    inner: &mut Inner,
    path: &Path,
    source_url: Option<String>,
) -> Result<String, String> {
    let extension = extension(path);
    if !SUPPORTED_EXTENSIONS.contains(&extension.as_str()) {
        return Ok(format!("不支持：{}", file_name(path)));
    }
    let name = file_name(path);
    if inner
        .data
        .documents
        .iter()
        .any(|document| document.name.eq_ignore_ascii_case(&name))
    {
        return Ok(format!("同名丢弃：{name}"));
    }
    let bytes = fs::read(path).map_err(error)?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    if inner
        .data
        .documents
        .iter()
        .any(|document| document.sha256 == digest)
    {
        return Ok(format!("内容重复：{name}"));
    }
    let id = Uuid::new_v4();
    let stored_name = flat_stored_filename(id, &name);
    let relative = format!("source/documents/{stored_name}");
    let destination = inner.root.join(&relative);
    fs::copy(path, &destination).map_err(error)?;
    let extracted = match extract_path(&destination) {
        Ok(value) => value,
        Err(value) => {
            let _ = fs::remove_file(&destination);
            return Err(value);
        }
    };
    fs::write(
        index_dir(&inner.root).join(format!("{id}.json")),
        serde_json::to_vec_pretty(&extracted).map_err(error)?,
    )
    .map_err(error)?;
    let size = bytes.len() as i64;
    let display_name = if extension == "pdf" {
        paper_display_name(&extracted)
    } else if matches!(extension.as_str(), "html" | "htm") {
        html_title(&String::from_utf8_lossy(&bytes))
    } else {
        None
    };
    inner.data.documents.push(KnowledgeDocument {
        id,
        name: name.clone(),
        display_name,
        extension_name: format!(".{extension}"),
        size,
        sha256: digest,
        stored_path: Some(relative),
        imported_at: now(),
        status: "ready".into(),
        page_count: (!extracted.pages.is_empty()).then_some(extracted.pages.len()),
        error: None,
        source_url,
    });
    save_data(&inner.root, &inner.data)?;
    Ok(format!("已导入：{name}"))
}

pub fn delete_document(inner: &mut Inner, id: Uuid) -> Result<(), String> {
    if let Some(document) = inner
        .data
        .documents
        .iter()
        .find(|document| document.id == id)
    {
        let _ = fs::remove_file(stored_path(&inner.root, document)?);
    }
    let _ = fs::remove_file(index_dir(&inner.root).join(format!("{id}.json")));
    inner.data.documents.retain(|document| document.id != id);
    inner
        .data
        .document_topics
        .retain(|item| item.document_id != id);
    inner.data.bookmarks.retain(|item| item.document_id != id);
    let removed: HashSet<Uuid> = inner
        .data
        .annotations
        .iter()
        .filter(|annotation| annotation.document_id == id)
        .map(|annotation| annotation.id)
        .collect();
    inner
        .data
        .annotations
        .retain(|annotation| annotation.document_id != id);
    for note in &mut inner.data.summary_notes {
        note.annotation_ids
            .retain(|annotation_id| !removed.contains(annotation_id));
    }
    for conversation in &mut inner.data.conversations {
        conversation
            .document_ids
            .retain(|document_id| *document_id != id);
        if conversation.current_document_id == Some(id) {
            conversation.current_document_id = None;
        }
    }
    save_data(&inner.root, &inner.data)
}

pub fn create_topic(inner: &mut Inner, name: &str, parent_id: Option<Uuid>) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("主题名称不能为空".into());
    }
    if parent_id.is_some()
        && !inner
            .data
            .topics
            .iter()
            .any(|topic| Some(topic.id) == parent_id)
    {
        return Err("父主题不存在".into());
    }
    inner.data.topics.push(Topic {
        id: Uuid::new_v4(),
        name: name.into(),
        parent_id,
        created_at: now(),
    });
    save_data(&inner.root, &inner.data)
}

pub fn delete_topic(inner: &mut Inner, id: Uuid) -> Result<(), String> {
    let mut removed = HashSet::from([id]);
    loop {
        let before = removed.len();
        for topic in &inner.data.topics {
            if topic
                .parent_id
                .is_some_and(|parent| removed.contains(&parent))
            {
                removed.insert(topic.id);
            }
        }
        if removed.len() == before {
            break;
        }
    }
    inner
        .data
        .topics
        .retain(|topic| !removed.contains(&topic.id));
    inner
        .data
        .document_topics
        .retain(|item| !removed.contains(&item.topic_id));
    save_data(&inner.root, &inner.data)
}

pub fn move_document(
    inner: &mut Inner,
    document_id: Uuid,
    source_topic_id: Option<Uuid>,
    target_topic_id: Option<Uuid>,
) -> Result<(), String> {
    if source_topic_id == target_topic_id {
        return Ok(());
    }
    if let Some(target) = target_topic_id {
        if !inner
            .data
            .document_topics
            .iter()
            .any(|item| item.document_id == document_id && item.topic_id == target)
        {
            inner.data.document_topics.push(DocumentTopic {
                document_id,
                topic_id: target,
                created_at: now(),
            });
        }
    }
    if let Some(source) = source_topic_id {
        inner
            .data
            .document_topics
            .retain(|item| !(item.document_id == document_id && item.topic_id == source));
    }
    if target_topic_id.is_none() {
        inner
            .data
            .document_topics
            .retain(|item| item.document_id != document_id);
    }
    save_data(&inner.root, &inner.data)
}

pub fn unlink_document(inner: &mut Inner, document_id: Uuid, topic_id: Uuid) -> Result<(), String> {
    inner
        .data
        .document_topics
        .retain(|item| !(item.document_id == document_id && item.topic_id == topic_id));
    save_data(&inner.root, &inner.data)
}

pub fn search_documents(inner: &Inner, query: &str) -> Vec<Uuid> {
    let terms = query_terms(query);
    inner
        .data
        .documents
        .iter()
        .filter(|document| {
            let extracted = read_extracted(&inner.root, document.id).text.to_lowercase();
            let name = format!("{}\n{}", document.name, document.title()).to_lowercase();
            terms
                .iter()
                .any(|term| name.contains(term) || extracted.contains(term))
        })
        .map(|document| document.id)
        .collect()
}

pub fn recommend_topics(inner: &Inner, id: Uuid) -> Vec<TopicRecommendation> {
    let Some(document) = inner
        .data
        .documents
        .iter()
        .find(|document| document.id == id)
    else {
        return vec![];
    };
    let extracted = read_extracted(&inner.root, id);
    let material = format!(
        "{}\n{}",
        document.title(),
        extracted.text.chars().take(3000).collect::<String>()
    )
    .to_lowercase();
    let rules = [
        (
            "RAG与知识库",
            ["rag", "知识库", "检索增强", "rerank"].as_slice(),
        ),
        ("Agent", ["agent", "智能体", "工具调用"].as_slice()),
        (
            "大模型",
            ["大模型", "llm", "transformer", "prompt"].as_slice(),
        ),
        (
            "向量数据库",
            ["向量数据库", "embedding", "milvus", "pgvector"].as_slice(),
        ),
        (
            "存储系统",
            ["存储系统", "文件系统", "对象存储", "nvme"].as_slice(),
        ),
        (
            "AI Infra",
            ["ai infra", "gpu", "推理集群", "模型服务"].as_slice(),
        ),
        (
            "软件开发",
            ["软件开发", "编程", "api", "架构设计"].as_slice(),
        ),
    ];
    let mut scored: Vec<_> = inner
        .data
        .topics
        .iter()
        .filter_map(|topic| {
            let topic_name = topic.name.to_lowercase();
            let mut matched: Vec<String> = vec![];
            let mut score = 0;
            if material.contains(&topic_name) {
                matched.push(topic.name.clone());
                score += 6;
            }
            for (concept, keywords) in &rules {
                let belongs = topic_name.contains(&concept.to_lowercase())
                    || keywords.iter().any(|keyword| topic_name.contains(keyword));
                if !belongs {
                    continue;
                }
                for keyword in keywords
                    .iter()
                    .filter(|keyword| material.contains(**keyword))
                    .take(3)
                {
                    if !matched.iter().any(|matched| matched == keyword) {
                        matched.push((*keyword).to_string());
                        score += 2;
                    }
                }
            }
            (score > 0).then(|| {
                (
                    score,
                    TopicRecommendation {
                        topic_id: topic.id,
                        name: topic.name.clone(),
                        reason: format!("本地匹配：{}", matched.join("、")),
                        source: "local".into(),
                    },
                )
            })
        })
        .collect();
    scored.sort_by(|left, right| right.0.cmp(&left.0));
    scored
        .into_iter()
        .take(3)
        .map(|(_, recommendation)| recommendation)
        .collect()
}

pub fn apply_recommendations(
    inner: &mut Inner,
    document_id: Uuid,
    topic_ids: &[Uuid],
) -> Result<(), String> {
    if !inner
        .data
        .documents
        .iter()
        .any(|document| document.id == document_id)
    {
        return Err("文档不存在".into());
    }
    let valid_topics: HashSet<_> = inner.data.topics.iter().map(|topic| topic.id).collect();
    for topic_id in topic_ids
        .iter()
        .copied()
        .filter(|topic_id| valid_topics.contains(topic_id))
    {
        if !inner
            .data
            .document_topics
            .iter()
            .any(|item| item.document_id == document_id && item.topic_id == topic_id)
        {
            inner.data.document_topics.push(DocumentTopic {
                document_id,
                topic_id,
                created_at: now(),
            });
        }
    }
    save_data(&inner.root, &inner.data)
}

pub fn reader_payload(inner: &Inner, id: Uuid) -> Result<ReaderDocumentPayload, String> {
    let document = inner
        .data
        .documents
        .iter()
        .find(|document| document.id == id)
        .ok_or("文档不存在")?;
    let path = stored_path(&inner.root, document)?;
    let extracted = read_extracted(&inner.root, id);
    let extension = document.extension_name.as_str();
    let (kind, content) = if extension == ".pdf" {
        (
            "pdf".into(),
            STANDARD.encode(fs::read(path).map_err(error)?),
        )
    } else if matches!(extension, ".html" | ".htm") {
        ("html".into(), fs::read_to_string(path).map_err(error)?)
    } else if matches!(extension, ".md" | ".markdown") {
        ("markdown".into(), fs::read_to_string(path).map_err(error)?)
    } else {
        ("text".into(), extracted.text.clone())
    };
    Ok(ReaderDocumentPayload {
        kind,
        content,
        extracted_text: extracted.text,
        pages: extracted.pages,
    })
}

pub fn save_summary_note(inner: &mut Inner, input: SummaryNoteInput) -> Result<(), String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("标题不能为空".into());
    }
    let valid: HashSet<Uuid> = inner
        .data
        .annotations
        .iter()
        .map(|annotation| annotation.id)
        .collect();
    let annotation_ids = input
        .annotation_ids
        .into_iter()
        .filter(|id| valid.contains(id))
        .collect();
    let timestamp = now();
    let id = input.id.unwrap_or_else(Uuid::new_v4);
    let path = format!("source/notes/{id}.md");
    fs::write(
        inner.root.join(&path),
        format!("# {}\n\n{}\n", title, input.content.trim()),
    )
    .map_err(error)?;
    if let Some(note) = inner
        .data
        .summary_notes
        .iter_mut()
        .find(|note| note.id == id)
    {
        note.title = title.into();
        note.content = input.content;
        note.annotation_ids = annotation_ids;
        note.stored_path = Some(path);
        note.updated_at = timestamp;
    } else {
        inner.data.summary_notes.insert(
            0,
            SummaryNote {
                id,
                title: title.into(),
                content: input.content,
                stored_path: Some(path),
                annotation_ids,
                created_at: timestamp.clone(),
                updated_at: timestamp,
            },
        );
    }
    save_data(&inner.root, &inner.data)
}

pub fn migrate_notes(root: &Path, data: &mut KnowledgeData) -> Result<(), String> {
    for note in &mut data.summary_notes {
        let relative = note
            .stored_path
            .clone()
            .unwrap_or_else(|| format!("source/notes/{}.md", note.id));
        note.stored_path = Some(relative.clone());
        let path = root.join(relative);
        if path.exists() {
            let markdown = fs::read_to_string(path).map_err(error)?;
            let mut lines = markdown.lines();
            if let Some(first) = lines.next().and_then(|line| line.strip_prefix("# ")) {
                note.title = first.trim().to_string();
                note.content = lines.collect::<Vec<_>>().join("\n").trim().to_string();
            }
        } else {
            fs::write(
                path,
                format!("# {}\n\n{}\n", note.title, note.content.trim()),
            )
            .map_err(error)?;
        }
    }
    Ok(())
}

pub fn selected_document_ids(
    data: &KnowledgeData,
    document_ids: &[Uuid],
    topic_ids: &[Uuid],
) -> HashSet<Uuid> {
    let mut selected: HashSet<Uuid> = document_ids.iter().copied().collect();
    selected.extend(
        data.document_topics
            .iter()
            .filter(|item| topic_ids.contains(&item.topic_id))
            .map(|item| item.document_id),
    );
    selected
}

pub fn context_chunks(
    inner: &Inner,
    query: &str,
    document_ids: &[Uuid],
    topic_ids: &[Uuid],
) -> Vec<ContextChunk> {
    let selected = selected_document_ids(&inner.data, document_ids, topic_ids);
    let documents: Vec<_> = inner
        .data
        .documents
        .iter()
        .filter(|document| selected.contains(&document.id))
        .collect();
    let mut ranked: Vec<(i32, &KnowledgeDocument, Option<usize>, String)> = vec![];
    for document in &documents {
        let extracted = read_extracted(&inner.root, document.id);
        if extracted.pages.is_empty() {
            for chunk in chunks(&extracted.text, 1400, 180) {
                ranked.push((
                    score(query, &chunk, document.title()),
                    document,
                    None,
                    chunk,
                ));
            }
        } else {
            for page in extracted.pages {
                for chunk in chunks(&page.text, 1400, 180) {
                    ranked.push((
                        score(query, &chunk, document.title()),
                        document,
                        Some(page.number),
                        chunk,
                    ));
                }
            }
        }
    }
    ranked.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.name.cmp(&right.1.name))
    });
    let mut chosen = vec![];
    let mut used = HashSet::new();
    for document in documents.iter().take(10) {
        if let Some(best) = ranked.iter().find(|item| item.1.id == document.id) {
            let key = format!("{}:{:?}:{}", best.1.id, best.2, best.3);
            if used.insert(key) {
                chosen.push((best.0, best.1, best.2, best.3.clone()));
            }
        }
    }
    for item in &ranked {
        if chosen.len() >= 10 {
            break;
        }
        let key = format!("{}:{:?}:{}", item.1.id, item.2, item.3);
        if used.insert(key) {
            chosen.push((item.0, item.1, item.2, item.3.clone()));
        }
    }
    chosen
        .into_iter()
        .take(10)
        .enumerate()
        .map(|(index, (_, document, page, text))| ContextChunk {
            id: Uuid::new_v4(),
            label: format!("资料{}", index + 1),
            document_id: document.id,
            document_name: document.title().into(),
            page,
            text,
        })
        .collect()
}

pub fn annotation_context(
    inner: &Inner,
    query: &str,
    document_ids: &[Uuid],
    topic_ids: &[Uuid],
) -> Vec<KnowledgeAnnotation> {
    let selected = selected_document_ids(&inner.data, document_ids, topic_ids);
    let mut values: Vec<_> = inner
        .data
        .annotations
        .iter()
        .filter(|annotation| selected.contains(&annotation.document_id))
        .cloned()
        .collect();
    values.sort_by_key(|annotation| {
        -score(
            query,
            &format!("{}\n{}", annotation.quote, annotation.note),
            "",
        )
    });
    values.truncate(30);
    values
}

pub fn query_terms(query: &str) -> Vec<String> {
    query
        .split(|character: char| {
            character.is_whitespace()
                || character.is_ascii_punctuation()
                || "，。！？；：、（）【】《》".contains(character)
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
        .collect()
}

pub fn score(query: &str, text: &str, title: &str) -> i32 {
    let body = text.to_lowercase();
    let title = title.to_lowercase();
    query_terms(query)
        .into_iter()
        .map(|term| if title.contains(&term) { 8 } else { 0 } + if body.contains(&term) { 2 } else { 0 })
        .sum()
}

pub fn chunks(text: &str, size: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        return vec![];
    }
    let mut values = vec![];
    let mut start = 0;
    while start < chars.len() {
        let end = (start + size).min(chars.len());
        values.push(chars[start..end].iter().collect());
        if end == chars.len() {
            break;
        }
        start = end.saturating_sub(overlap.min(end - start));
    }
    values
}

fn paper_display_name(extracted: &ExtractedDocument) -> Option<String> {
    let source = extracted
        .pages
        .first()
        .map(|page| page.text.as_str())
        .unwrap_or(&extracted.text);
    let lines: Vec<_> = source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(12)
        .collect();
    if !source.to_lowercase().contains("abstract") && !source.contains("摘要") {
        return None;
    }
    let title = lines.iter().find(|line| {
        line.len() >= 12 && line.len() <= 300 && !line.to_lowercase().contains("arxiv")
    })?;
    let title_index = lines.iter().position(|line| line == title).unwrap_or(0);
    let author = lines.get(title_index + 1).copied().unwrap_or("");
    let surname = author
        .split([',', ';'])
        .next()
        .unwrap_or("")
        .split_whitespace()
        .last()
        .unwrap_or("")
        .trim_matches(|character: char| character.is_ascii_punctuation());
    if surname.is_empty() {
        Some((*title).to_string())
    } else if author.contains(',')
        || author.contains(';')
        || author.to_lowercase().contains(" and ")
    {
        Some(format!("{surname} et al., {title}"))
    } else {
        Some(format!("{surname}, {title}"))
    }
}

fn html_title(source: &str) -> Option<String> {
    let regex = Regex::new(r"(?is)<title\b[^>]*>(.*?)</title>").unwrap();
    let value = regex.captures(source)?.get(1)?.as_str();
    let text = Regex::new(r"<[^>]+>").unwrap().replace_all(value, "");
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn normalize_whitespace(value: &str) -> String {
    Regex::new(r"\s+")
        .unwrap()
        .replace_all(value, " ")
        .trim()
        .to_string()
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .to_string()
}

fn flat_stored_filename(id: Uuid, name: &str) -> String {
    format!("{id}--{}", name.replace(['/', '\\', ':'], "_"))
}

fn absolute_clean(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("目录不能为空".into());
    }
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        std::env::current_dir()
            .map_err(error)
            .map(|current| current.join(path))
    }
}

pub fn ensure_inside(root: &Path, candidate: &Path) -> Result<(), String> {
    let root = absolute_clean(root)?;
    let candidate = absolute_clean(candidate)?;
    if !candidate.starts_with(&root) {
        return Err("路径越过知识库边界".into());
    }
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry.map_err(error)?;
        let relative = entry.path().strip_prefix(source).map_err(error)?;
        let target = destination.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(target).map_err(error)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(error)?;
            }
            fs::copy(entry.path(), target).map_err(error)?;
        }
    }
    Ok(())
}

pub fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunking_and_score_match_native_semantics() {
        let values = chunks(&"a".repeat(3000), 1400, 180);
        assert_eq!(values.len(), 3);
        assert!(score("rag", "RAG retrieval", "paper") > 0);
        assert!(score("rag", "body", "RAG title") > score("rag", "RAG body", "title"));
    }

    #[test]
    fn query_terms_support_chinese_punctuation() {
        assert_eq!(query_terms("RAG，Agent。"), vec!["rag", "agent"]);
    }

    #[test]
    fn flat_filename_is_cross_platform_safe() {
        let value = flat_stored_filename(Uuid::nil(), "a:b/c\\d.pdf");
        assert!(!value.contains(':'));
        assert!(!value.contains('/'));
        assert!(!value.contains('\\'));
    }

    #[test]
    fn selecting_source_directory_resolves_to_its_library_root() {
        let root = std::env::temp_dir()
            .join("KnowledgeMaster-tests")
            .join("Knowledges");
        let selected = root.join("source");
        assert_eq!(library_root_from_selection(&selected).unwrap(), root);
        assert_eq!(library_root_from_selection(&root).unwrap(), root);
    }

    #[test]
    fn unlinking_document_keeps_other_virtual_topic_links() {
        let root = std::env::temp_dir()
            .join("KnowledgeMaster-tests")
            .join(Uuid::new_v4().to_string());
        let document_id = Uuid::new_v4();
        let removed_topic = Uuid::new_v4();
        let retained_topic = Uuid::new_v4();
        let mut inner = Inner {
            root: root.clone(),
            data: KnowledgeData::default(),
            settings: AppSettings::default(),
        };
        inner.data.document_topics = vec![
            DocumentTopic {
                document_id,
                topic_id: removed_topic,
                created_at: now(),
            },
            DocumentTopic {
                document_id,
                topic_id: retained_topic,
                created_at: now(),
            },
        ];

        unlink_document(&mut inner, document_id, removed_topic).unwrap();

        assert_eq!(inner.data.document_topics.len(), 1);
        assert_eq!(inner.data.document_topics[0].topic_id, retained_topic);
        let _ = fs::remove_dir_all(root);
    }
}

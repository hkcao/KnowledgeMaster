use crate::models::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;
use walkdir::WalkDir;

pub const SUPPORTED_EXTENSIONS: &[&str] =
    &["pdf", "html", "htm", "md", "markdown", "txt", "doc", "docx"];
const CHUNK_CACHE_VERSION: usize = 1;
const DEFAULT_CHUNK_TOKENS: usize = 256;
const DEFAULT_CHUNK_OVERLAP: usize = 48;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkCache {
    version: usize,
    document_id: Uuid,
    source_sha256: String,
    target_tokens: usize,
    overlap_tokens: usize,
    chunks: Vec<CachedChunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedChunk {
    index: usize,
    page: Option<usize>,
    start: usize,
    end: usize,
    approximate_tokens: usize,
    text: String,
}

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
        migrate_document_authors(&root, &mut data);
        migrate_document_filenames(&root, &mut data)?;
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
pub fn chunks_dir(root: &Path) -> PathBuf {
    source_dir(root).join("generated").join("chunks")
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
        chunks_dir(root),
    ] {
        fs::create_dir_all(path).map_err(error)?;
    }
    Ok(())
}

pub fn load_data(root: &Path) -> Result<KnowledgeData, String> {
    let mut data = crate::database::load_or_migrate(root)?;
    data.version = 8;
    for conversation in &mut data.conversations {
        conversation.summary_message_count = conversation
            .summary_message_count
            .min(conversation.messages.len());
    }
    Ok(data)
}

pub fn save_data(root: &Path, data: &KnowledgeData) -> Result<(), String> {
    prepare_directories(root)?;
    crate::database::save(root, data)
}

pub fn switch_root(
    inner: &mut Inner,
    target: PathBuf,
    migrate: bool,
) -> Result<Vec<String>, String> {
    let target = library_root_from_selection(&target)?;
    if migrate && target != inner.root {
        fs::create_dir_all(&target).map_err(error)?;
        for name in [
            "knowledge.db",
            "knowledge.json",
            "knowledge.json.bak",
            "knowledge.json.migrated-v8.bak",
            "source",
        ] {
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
    let mut warnings = vec![];
    migrate_document_indexes(
        &inner.root,
        &mut inner.data,
        inner.settings.local_ocr_enabled,
        &mut warnings,
    )?;
    migrate_document_authors(&inner.root, &mut inner.data);
    migrate_document_filenames(&inner.root, &mut inner.data)?;
    sync_source_documents(inner, &mut warnings)?;
    save_root_preference(&inner.root)?;
    save_data(&inner.root, &inner.data)?;
    Ok(warnings)
}

pub fn stored_path(root: &Path, document: &KnowledgeDocument) -> Result<PathBuf, String> {
    let legacy_path;
    let relative = if let Some(relative) = document.stored_path.as_deref() {
        relative
    } else {
        // Swift and early Tauri releases omitted storedPath for nested originals.
        if Path::new(&document.name)
            .file_name()
            .and_then(|name| name.to_str())
            != Some(document.name.as_str())
        {
            return Err("旧版原件名称不是有效文件名".into());
        }
        legacy_path = [
            document.id.to_string(),
            document.id.to_string().to_uppercase(),
        ]
        .into_iter()
        .map(|id| format!("source/documents/{id}/{}", document.name))
        .find(|relative| root.join(relative).is_file())
        .ok_or_else(|| format!("找不到旧版原件：{}", document.name))?;
        &legacy_path
    };
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
            let pdf_path = path.to_path_buf();
            // pdf-extract can panic on unsupported fonts. Keep that unwind away
            // from the WebView callback and the library mutex guard. Use the same
            // parser stack budget on Windows and macOS.
            std::thread::Builder::new()
                .name("pdf-extraction".into())
                .stack_size(8 * 1024 * 1024)
                .spawn(move || extract_pdf(&pdf_path))
                .map_err(error)?
                .join()
                .unwrap_or_else(|payload| {
                    let detail = payload
                        .downcast_ref::<String>()
                        .map(String::as_str)
                        .or_else(|| payload.downcast_ref::<&str>().copied())
                        .unwrap_or("未知内部错误");
                    Err(format!("文本解析器内部异常：{detail}；原件已保留"))
                })
                .map_err(|message| format!("PDF 解析失败：{}（{message}）", file_name(path)))
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

fn extract_pdf(path: &Path) -> Result<ExtractedDocument, String> {
    let texts = pdf_extract::extract_text_by_pages(path).map_err(error)?;
    let text = texts.join("\n\n");
    let pages = texts
        .into_iter()
        .enumerate()
        .map(|(index, text)| ExtractedPage {
            number: index + 1,
            text,
        })
        .collect();
    Ok(ExtractedDocument { text, pages })
}

fn extract_for_import(path: &Path, ocr_enabled: bool) -> Result<ExtractedDocument, String> {
    let extracted = extract_path(path);
    if extension(path) != "pdf" || !ocr_enabled {
        return extracted;
    }
    pdf_ocr_fallback(extracted, |pages| {
        crate::ocr::runtime().extract(path, pages)
    })
}

fn pdf_ocr_fallback(
    native: Result<ExtractedDocument, String>,
    mut ocr: impl FnMut(&str) -> Result<ExtractedDocument, String>,
) -> Result<ExtractedDocument, String> {
    match native {
        Err(message) => {
            let extracted = ocr("all").map_err(|ocr_error| format!("{message}；{ocr_error}"))?;
            if extracted.text.trim().is_empty() {
                return Err("OCR 未识别到文字，原件已保留".into());
            }
            Ok(extracted)
        }
        Ok(mut extracted) => {
            let missing: Vec<_> = extracted
                .pages
                .iter()
                .filter(|page| page.text.chars().filter(|c| c.is_alphanumeric()).count() < 16)
                .map(|page| page.number.to_string())
                .collect();
            if missing.is_empty() && !extracted.text.trim().is_empty() {
                return Ok(extracted);
            }
            let range = if missing.is_empty() {
                "all".into()
            } else {
                missing.join(",")
            };
            match ocr(&range) {
                Ok(recovered) => {
                    for page in recovered.pages {
                        if let Some(existing) = extracted
                            .pages
                            .iter_mut()
                            .find(|existing| existing.number == page.number)
                        {
                            if !page.text.trim().is_empty() {
                                *existing = page;
                            }
                        } else {
                            extracted.pages.push(page);
                        }
                    }
                    extracted.pages.sort_by_key(|page| page.number);
                    extracted.text = extracted
                        .pages
                        .iter()
                        .map(|page| page.text.as_str())
                        .collect::<Vec<_>>()
                        .join("\n\n");
                    if extracted.text.trim().is_empty() {
                        return Err("OCR 未识别到文字，原件已保留".into());
                    }
                    Ok(extracted)
                }
                // Keep useful native text when a sparse/blank page cannot be OCRed.
                Err(_) if !extracted.text.trim().is_empty() => Ok(extracted),
                Err(message) => Err(message),
            }
        }
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

fn extraction_index_path(root: &Path, id: Uuid) -> PathBuf {
    let path = index_dir(root).join(format!("{id}.json"));
    let legacy = index_dir(root).join(format!("{}.json", id.to_string().to_uppercase()));
    if !path.exists() && legacy.exists() {
        legacy
    } else {
        path
    }
}

fn parse_extracted(bytes: &[u8]) -> Option<ExtractedDocument> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    // Defaults support older records, but an unrelated JSON object is not an index.
    if value.get("text").is_none() && value.get("pages").is_none() {
        return None;
    }
    serde_json::from_value(value).ok()
}

pub fn read_extracted(root: &Path, id: Uuid) -> ExtractedDocument {
    fs::read(extraction_index_path(root, id))
        .ok()
        .and_then(|bytes| parse_extracted(&bytes))
        .unwrap_or_default()
}

pub fn migrate_document_indexes(
    root: &Path,
    data: &mut KnowledgeData,
    ocr_enabled: bool,
    warnings: &mut Vec<String>,
) -> Result<bool, String> {
    prepare_directories(root)?;
    let mut changed = false;
    for document in &mut data.documents {
        // Only update metadata after this document's repair succeeds.
        let mut candidate = document.clone();
        match migrate_document_index(root, &mut candidate, ocr_enabled) {
            Ok(updated) => {
                *document = candidate;
                changed |= updated;
            }
            Err(message) => {
                warnings.push(format!("索引修复已跳过：{}（{message}）", document.name))
            }
        }
    }
    Ok(changed)
}

fn migrate_document_index(
    root: &Path,
    document: &mut KnowledgeDocument,
    ocr_enabled: bool,
) -> Result<bool, String> {
    let mut changed = false;
    if document.stored_path.is_none() {
        let path = stored_path(root, document)?;
        document.stored_path = Some(
            path.strip_prefix(root)
                .map_err(error)?
                .to_string_lossy()
                .replace('\\', "/"),
        );
        changed = true;
    }
    let path = extraction_index_path(root, document.id);
    let bytes = match fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(value) if value.kind() == std::io::ErrorKind::NotFound => None,
        Err(value) => return Err(format!("索引读取失败：{value}")),
    };
    if let Some(extracted) = bytes
        .as_deref()
        .and_then(parse_extracted)
        .filter(|extracted| {
            !(ocr_enabled
                && document.extension_name.eq_ignore_ascii_case(".pdf")
                && extracted.text.trim().is_empty()
                && crate::ocr::runtime().status().ready)
        })
    {
        // The text/pages schema is shared by Swift and all Tauri releases.
        read_or_build_chunk_cache(root, document, &extracted);
        return Ok(changed);
    }
    let source = stored_path(root, document)?;
    let extracted = extract_for_import(&source, ocr_enabled)?;
    if bytes.is_some() {
        let backup = path.with_extension("json.pre-rebuild.bak");
        if !backup.exists() {
            fs::copy(&path, backup).map_err(error)?;
        }
    }
    // Rebuild chunks even if their old source hash still matches. They may
    // have been produced from the previously unreadable extraction index.
    write_chunk_cache(root, document, &extracted)?;
    let mut temporary = tempfile::NamedTempFile::new_in(index_dir(root)).map_err(error)?;
    temporary
        .write_all(&serde_json::to_vec_pretty(&extracted).map_err(error)?)
        .map_err(error)?;
    temporary.persist(&path).map_err(error)?;
    Ok(true)
}

fn chunk_cache_path(root: &Path, id: Uuid) -> PathBuf {
    chunks_dir(root).join(format!("{id}.json"))
}

fn approximate_token_units(character: char) -> usize {
    if character.is_ascii() {
        1
    } else {
        4
    }
}

fn approximate_tokens(text: &str) -> usize {
    text.chars()
        .map(approximate_token_units)
        .sum::<usize>()
        .div_ceil(4)
}

fn chunk_ranges(text: &str, target_tokens: usize, overlap_tokens: usize) -> Vec<(usize, usize)> {
    let characters: Vec<char> = text.chars().collect();
    if characters.is_empty() {
        return vec![];
    }
    let target_units = target_tokens.max(1) * 4;
    let overlap_units = overlap_tokens.min(target_tokens.saturating_sub(1)) * 4;
    let mut ranges = vec![];
    let mut start = 0;
    while start < characters.len() {
        let mut end = start;
        let mut units = 0;
        while end < characters.len() && units < target_units {
            units += approximate_token_units(characters[end]);
            end += 1;
        }
        if end < characters.len() {
            let minimum = start + (end - start) * 3 / 4;
            if let Some(boundary) = (minimum..end).rev().find(|index| {
                matches!(
                    characters[*index],
                    '\n' | '。' | '！' | '？' | '.' | '!' | '?' | ';' | '；'
                )
            }) {
                end = boundary + 1;
            }
        }
        if end <= start {
            end = (start + 1).min(characters.len());
        }
        ranges.push((start, end));
        if end == characters.len() {
            break;
        }
        let mut next = end;
        let mut overlap = 0;
        while next > start && overlap < overlap_units {
            next -= 1;
            overlap += approximate_token_units(characters[next]);
        }
        start = next.max(start + 1);
    }
    ranges
}

fn build_chunk_cache(document: &KnowledgeDocument, extracted: &ExtractedDocument) -> ChunkCache {
    let sources: Vec<(Option<usize>, &str)> = if extracted.pages.is_empty() {
        vec![(None, extracted.text.as_str())]
    } else {
        extracted
            .pages
            .iter()
            .map(|page| (Some(page.number), page.text.as_str()))
            .collect()
    };
    let mut chunks = vec![];
    for (page, text) in sources {
        let characters: Vec<char> = text.chars().collect();
        for (start, end) in chunk_ranges(text, DEFAULT_CHUNK_TOKENS, DEFAULT_CHUNK_OVERLAP) {
            let value: String = characters[start..end].iter().collect();
            chunks.push(CachedChunk {
                index: chunks.len(),
                page,
                start,
                end,
                approximate_tokens: approximate_tokens(&value),
                text: value,
            });
        }
    }
    ChunkCache {
        version: CHUNK_CACHE_VERSION,
        document_id: document.id,
        source_sha256: document.sha256.clone(),
        target_tokens: DEFAULT_CHUNK_TOKENS,
        overlap_tokens: DEFAULT_CHUNK_OVERLAP,
        chunks,
    }
}

fn write_chunk_cache(
    root: &Path,
    document: &KnowledgeDocument,
    extracted: &ExtractedDocument,
) -> Result<(), String> {
    fs::create_dir_all(chunks_dir(root)).map_err(error)?;
    let cache = build_chunk_cache(document, extracted);
    fs::write(
        chunk_cache_path(root, document.id),
        serde_json::to_vec_pretty(&cache).map_err(error)?,
    )
    .map_err(error)
}

fn read_or_build_chunk_cache(
    root: &Path,
    document: &KnowledgeDocument,
    extracted: &ExtractedDocument,
) -> ChunkCache {
    let path = chunk_cache_path(root, document.id);
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(cache) = serde_json::from_slice::<ChunkCache>(&bytes) {
            if cache.version == CHUNK_CACHE_VERSION
                && cache.document_id == document.id
                && cache.source_sha256 == document.sha256
                && cache.target_tokens == DEFAULT_CHUNK_TOKENS
                && cache.overlap_tokens == DEFAULT_CHUNK_OVERLAP
            {
                return cache;
            }
        }
    }
    let cache = build_chunk_cache(document, extracted);
    if fs::create_dir_all(chunks_dir(root)).is_ok() {
        if let Ok(bytes) = serde_json::to_vec_pretty(&cache) {
            let _ = fs::write(path, bytes);
        }
    }
    cache
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
    import_one_with_storage(inner, path, source_url, false)
}

fn import_one_with_storage(
    inner: &mut Inner,
    path: &Path,
    source_url: Option<String>,
    adopt_source: bool,
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
    let extracted = extract_for_import(path, inner.settings.local_ocr_enabled)?;
    let display_name = if extension == "pdf" {
        paper_display_name(&extracted)
    } else if matches!(extension.as_str(), "html" | "htm") {
        html_title(&String::from_utf8_lossy(&bytes))
    } else {
        None
    };
    let authors = extract_authors(&extension, &bytes, &extracted);
    let recognizable_name = recognizable_document_name(&name, display_name.as_deref(), &extension);
    let stored_name = flat_stored_filename(id, &recognizable_name);
    let relative = format!("source/documents/{stored_name}");
    let destination = inner.root.join(&relative);
    let index_path = index_dir(&inner.root).join(format!("{id}.json"));
    if let Err(value) = fs::write(
        &index_path,
        serde_json::to_vec_pretty(&extracted).map_err(error)?,
    ) {
        return Err(error(value));
    }
    let document = KnowledgeDocument {
        id,
        name: name.clone(),
        display_name,
        authors,
        extension_name: format!(".{extension}"),
        size: bytes.len() as i64,
        sha256: digest,
        stored_path: Some(relative),
        imported_at: now(),
        status: "ready".into(),
        page_count: (!extracted.pages.is_empty()).then_some(extracted.pages.len()),
        error: None,
        source_url,
    };
    if let Err(value) = write_chunk_cache(&inner.root, &document, &extracted) {
        let _ = fs::remove_file(&index_path);
        return Err(value);
    }
    let stored = if adopt_source {
        fs::rename(path, &destination)
    } else {
        fs::copy(path, &destination).map(|_| ())
    };
    if let Err(value) = stored {
        let _ = fs::remove_file(&index_path);
        let _ = fs::remove_file(chunk_cache_path(&inner.root, id));
        return Err(error(value));
    }
    inner.data.documents.push(document);
    if let Err(value) = save_data(&inner.root, &inner.data) {
        inner.data.documents.pop();
        if adopt_source {
            let _ = fs::rename(&destination, path);
        } else {
            let _ = fs::remove_file(&destination);
        }
        let _ = fs::remove_file(&index_path);
        let _ = fs::remove_file(chunk_cache_path(&inner.root, id));
        return Err(value);
    }
    Ok(format!("已导入：{name}"))
}

pub fn sync_source_documents(
    inner: &mut Inner,
    warnings: &mut Vec<String>,
) -> Result<usize, String> {
    prepare_directories(&inner.root)?;
    let mut known_paths = inner
        .data
        .documents
        .iter()
        .filter_map(|document| stored_path(&inner.root, document).ok())
        .filter_map(|path| absolute_clean(&path).ok())
        .collect::<HashSet<_>>();
    let mut candidates = vec![];
    for directory in [source_dir(&inner.root), documents_dir(&inner.root)] {
        for entry in fs::read_dir(directory).map_err(error)? {
            let entry = entry.map_err(error)?;
            if entry.file_type().map_err(error)?.is_file()
                && SUPPORTED_EXTENSIONS.contains(&extension(&entry.path()).as_str())
            {
                candidates.push(entry.path());
            }
        }
    }
    candidates.sort();
    candidates.dedup();

    let mut imported = 0;
    for path in candidates {
        let clean = absolute_clean(&path)?;
        if known_paths.contains(&clean) {
            continue;
        }
        let before = inner.data.documents.len();
        if let Err(message) = import_one_with_storage(inner, &path, None, true) {
            warnings.push(format!("已跳过：{}（{message}）", file_name(&path)));
            continue;
        }
        if inner.data.documents.len() > before {
            imported += 1;
            if let Some(document) = inner.data.documents.last() {
                if let Ok(stored) = stored_path(&inner.root, document) {
                    known_paths.insert(absolute_clean(&stored)?);
                }
            }
        }
    }
    Ok(imported)
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
    let _ = fs::remove_file(chunk_cache_path(&inner.root, id));
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
    inner
        .data
        .topic_summaries
        .retain(|summary| !removed.contains(&summary.topic_id));
    for conversation in &mut inner.data.conversations {
        conversation
            .topic_ids
            .retain(|topic_id| !removed.contains(topic_id));
    }
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
            let metadata = format!(
                "{}\n{}\n{}",
                document.name,
                document.title(),
                document.authors.join("\n")
            )
            .to_lowercase();
            terms
                .iter()
                .any(|term| metadata.contains(term) || extracted.contains(term))
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
    quote: Option<&str>,
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
    let normalized_quote = quote
        .map(normalize_whitespace)
        .map(|value| value.to_lowercase())
        .filter(|value| !value.is_empty());
    let mut ranked: Vec<(i32, bool, &KnowledgeDocument, CachedChunk)> = vec![];
    for document in &documents {
        let extracted = read_extracted(&inner.root, document.id);
        let cache = read_or_build_chunk_cache(&inner.root, document, &extracted);
        for chunk in cache.chunks {
            let exact = normalized_quote.as_ref().is_some_and(|quote| {
                normalize_whitespace(&chunk.text)
                    .to_lowercase()
                    .contains(quote)
            });
            ranked.push((
                score(query, &chunk.text, document.title()) + if exact { 1000 } else { 0 },
                exact,
                document,
                chunk,
            ));
        }
        if normalized_quote.is_some()
            && !ranked.iter().any(|item| item.1 && item.2.id == document.id)
        {
            if let Some((page, text)) =
                full_parsed_quote_context(&extracted, quote.unwrap_or_default())
            {
                ranked.push((
                    score(query, &text, document.title()) + 1000,
                    true,
                    document,
                    CachedChunk {
                        index: usize::MAX,
                        page,
                        start: 0,
                        end: text.chars().count(),
                        approximate_tokens: approximate_tokens(&text),
                        text,
                    },
                ));
            }
        }
    }
    ranked.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.2.name.cmp(&right.2.name))
    });
    let mut chosen: Vec<usize> = vec![];
    let mut used = HashSet::new();
    if let Some(exact_index) = ranked.iter().position(|item| item.1) {
        select_ranked_index(&ranked, &mut chosen, &mut used, exact_index);
        let document_id = ranked[exact_index].2.id;
        let chunk_index = ranked[exact_index].3.index;
        if chunk_index != usize::MAX {
            for neighbor in [chunk_index.checked_sub(1), chunk_index.checked_add(1)]
                .into_iter()
                .flatten()
            {
                if let Some(index) = ranked
                    .iter()
                    .position(|item| item.2.id == document_id && item.3.index == neighbor)
                {
                    select_ranked_index(&ranked, &mut chosen, &mut used, index);
                }
            }
        }
    }
    for document in documents.iter().take(6) {
        if let Some(index) = ranked.iter().position(|item| item.2.id == document.id) {
            select_ranked_index(&ranked, &mut chosen, &mut used, index);
        }
    }
    for index in 0..ranked.len() {
        if chosen.len() >= 8 {
            break;
        }
        if ranked[index].0 > 0 {
            select_ranked_index(&ranked, &mut chosen, &mut used, index);
        }
    }
    chosen
        .into_iter()
        .take(8)
        .enumerate()
        .map(|(label_index, ranked_index)| {
            let (_, _, document, chunk) = &ranked[ranked_index];
            ContextChunk {
                id: Uuid::new_v4(),
                label: format!("资料{}", label_index + 1),
                document_id: document.id,
                document_name: document.title().into(),
                page: chunk.page,
                text: chunk.text.clone(),
            }
        })
        .collect()
}

fn select_ranked_index(
    ranked: &[(i32, bool, &KnowledgeDocument, CachedChunk)],
    chosen: &mut Vec<usize>,
    used: &mut HashSet<(Uuid, usize)>,
    index: usize,
) {
    let item = &ranked[index];
    if used.insert((item.2.id, item.3.index)) {
        chosen.push(index);
    }
}

fn full_parsed_quote_context(
    extracted: &ExtractedDocument,
    quote: &str,
) -> Option<(Option<usize>, String)> {
    if quote.trim().is_empty() {
        return None;
    }
    let sources: Vec<(Option<usize>, &str)> = if extracted.pages.is_empty() {
        vec![(None, extracted.text.as_str())]
    } else {
        extracted
            .pages
            .iter()
            .map(|page| (Some(page.number), page.text.as_str()))
            .collect()
    };
    let normalized_quote = normalize_whitespace(quote).to_lowercase();
    for (page, text) in sources {
        if let Some(value) = chunks(text, 1400, 240).into_iter().find(|value| {
            normalize_whitespace(value)
                .to_lowercase()
                .contains(&normalized_quote)
        }) {
            return Some((page, value));
        }
    }
    None
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

fn is_front_matter_noise(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("arxiv:")
        || lower.starts_with("published as ")
        || lower.contains("technical report")
        || lower.starts_with("http://")
        || lower.starts_with("https://")
        || line.starts_with('(')
        || Regex::new(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}$")
            .unwrap()
            .is_match(line)
}

fn is_affiliation_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    line.contains('@')
        || [
            "university",
            "institute",
            "department",
            "laboratory",
            "school of",
            "research lab",
            "csail",
        ]
        .iter()
        .any(|marker| lower.contains(marker))
        || matches!(line, "NVIDIA" | "MIT" | "Google" | "Microsoft Research")
}

fn is_cjk(character: char) -> bool {
    matches!(character, '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}')
}

fn looks_like_name_fragment(value: &str) -> bool {
    let words: Vec<_> = value
        .split_whitespace()
        .map(|word| word.trim_matches(|character: char| !character.is_alphanumeric()))
        .filter(|word| !word.is_empty() && !matches!(*word, "and" | "&"))
        .collect();
    if words.is_empty() || words.len() > 5 {
        return false;
    }
    words.iter().all(|word| {
        !word.chars().any(|character| character.is_ascii_digit())
            && word.chars().any(char::is_alphabetic)
            && word
                .chars()
                .find(|character| character.is_alphabetic())
                .is_some_and(|character| character.is_uppercase() || is_cjk(character))
    })
}

fn looks_like_author_line(line: &str) -> bool {
    if is_front_matter_noise(line) || is_affiliation_line(line) || line.contains(':') {
        return false;
    }
    let lower = line.to_lowercase();
    if lower.ends_with(" team") {
        return true;
    }
    let letters: Vec<_> = line
        .chars()
        .filter(|character| character.is_alphabetic())
        .collect();
    if !letters.is_empty() && letters.iter().all(|character| character.is_uppercase()) {
        return false;
    }
    if line.contains(',') || line.contains(';') {
        return line
            .split([',', ';'])
            .filter(|part| looks_like_name_fragment(part.trim()))
            .take(2)
            .count()
            >= 2;
    }
    if lower.contains(" and ") {
        return line
            .split(" and ")
            .all(|part| looks_like_name_fragment(part.trim()));
    }
    looks_like_name_fragment(line) && line.split_whitespace().count() >= 2
}

fn clean_author_line(line: &str) -> String {
    line.replace(
        [
            '∗', '⋆', '†', '‡', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹',
        ],
        "",
    )
    .trim()
    .to_string()
}

fn paper_title_and_authors(extracted: &ExtractedDocument) -> Option<(String, Vec<String>)> {
    let source = extracted
        .pages
        .first()
        .map(|page| page.text.as_str())
        .unwrap_or(&extracted.text);
    let lines: Vec<_> = source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(40)
        .collect();
    if !source.to_lowercase().contains("abstract") && !source.contains("摘要") {
        return None;
    }
    let abstract_index = lines
        .iter()
        .position(|line| {
            let lower = line.to_lowercase();
            lower.starts_with("abstract") || line.starts_with("摘要")
        })
        .unwrap_or(lines.len());
    let front = &lines[..abstract_index];
    let title_start = front
        .iter()
        .position(|line| !is_front_matter_noise(line) && !is_affiliation_line(line))?;
    let mut title_lines = vec![front[title_start].to_string()];
    let mut authors = vec![];
    for line in &front[title_start + 1..] {
        if is_front_matter_noise(line) || is_affiliation_line(line) {
            continue;
        }
        if looks_like_author_line(line) {
            authors.push(clean_author_line(line));
        } else if authors.is_empty() && title_lines.len() < 3 {
            title_lines.push((*line).to_string());
        }
    }
    Some((title_lines.join(" "), authors))
}

fn paper_display_name(extracted: &ExtractedDocument) -> Option<String> {
    let (title, authors) = paper_title_and_authors(extracted)?;
    let author = authors.first().map(String::as_str).unwrap_or("");
    if author.to_lowercase().ends_with(" team") {
        return Some(format!("{author}, {title}"));
    }
    let surname = author
        .split([',', ';'])
        .next()
        .unwrap_or("")
        .split_whitespace()
        .last()
        .unwrap_or("")
        .trim_matches(|character: char| !character.is_alphanumeric());
    if surname.is_empty() {
        Some(title)
    } else if authors.len() > 1
        || author.contains(',')
        || author.contains(';')
        || author.to_lowercase().contains(" and ")
    {
        Some(format!("{surname} et al., {title}"))
    } else {
        Some(format!("{surname}, {title}"))
    }
}

fn legacy_paper_display_name(extracted: &ExtractedDocument) -> Option<String> {
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

fn html_authors(source: &str) -> Vec<String> {
    let parsed = scraper::Html::parse_document(source);
    let selector = scraper::Selector::parse("meta[name], meta[property]").unwrap();
    let mut authors = vec![];
    for element in parsed.select(&selector) {
        let key = element
            .value()
            .attr("name")
            .or_else(|| element.value().attr("property"))
            .unwrap_or("")
            .to_lowercase();
        if matches!(
            key.as_str(),
            "author" | "article:author" | "citation_author" | "dc.creator"
        ) {
            if let Some(value) = element.value().attr("content").map(str::trim) {
                if !value.is_empty() && !authors.iter().any(|author| author == value) {
                    authors.push(value.to_string());
                }
            }
        }
    }
    authors
}

fn declared_authors(source: &str) -> Vec<String> {
    source
        .lines()
        .take(30)
        .find_map(|line| {
            let trimmed = line.trim();
            let lower = trimmed.to_lowercase();
            ["author:", "authors:"].iter().find_map(|prefix| {
                lower
                    .strip_prefix(prefix)
                    .map(|_| trimmed[prefix.len()..].trim())
            })
        })
        .map(|value| {
            value
                .trim_matches(|character| matches!(character, '[' | ']' | '\'' | '"'))
                .split([',', ';'])
                .map(str::trim)
                .filter(|author| !author.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn extract_authors(extension: &str, bytes: &[u8], extracted: &ExtractedDocument) -> Vec<String> {
    match extension {
        "pdf" => paper_title_and_authors(extracted)
            .map(|(_, authors)| authors)
            .unwrap_or_default(),
        "html" | "htm" => html_authors(&String::from_utf8_lossy(bytes)),
        "md" | "markdown" | "txt" => declared_authors(&extracted.text),
        _ => vec![],
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

fn safe_filename_part(value: &str, byte_limit: usize) -> String {
    let mut result = String::new();
    for character in value.trim().trim_matches(['.', ' ']).chars() {
        let safe = if character.is_control() || "<>:\"/\\|?*".contains(character) {
            '_'
        } else {
            character
        };
        if result.len() + safe.len_utf8() > byte_limit {
            break;
        }
        result.push(safe);
    }
    let result = result.trim_end_matches(['.', ' ']).trim();
    if result.is_empty() {
        "document".into()
    } else {
        result.into()
    }
}

fn recognizable_document_name(
    original: &str,
    display_name: Option<&str>,
    extension: &str,
) -> String {
    let extension = safe_filename_part(extension.trim_start_matches('.'), 16);
    let suffix = format!(".{extension}");
    let preferred = display_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            Path::new(original)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or(original)
        });
    let preferred = if preferred.to_lowercase().ends_with(&suffix.to_lowercase()) {
        &preferred[..preferred.len() - suffix.len()]
    } else {
        preferred
    };
    let stem = safe_filename_part(preferred, 170);
    if extension.is_empty() {
        stem
    } else {
        format!("{stem}.{extension}")
    }
}

fn flat_stored_filename(id: Uuid, name: &str) -> String {
    format!("{id}--{}", safe_filename_part(name, 205))
}

pub fn migrate_document_filenames(root: &Path, data: &mut KnowledgeData) -> Result<bool, String> {
    let mut changed = false;
    for document in &mut data.documents {
        let Some(display_name) = document.display_name.as_deref() else {
            continue;
        };
        if document.stored_path.is_none() {
            continue;
        }
        let extension = document.extension_name.trim_start_matches('.');
        let recognizable =
            recognizable_document_name(&document.name, Some(display_name), extension);
        let relative = format!(
            "source/documents/{}",
            flat_stored_filename(document.id, &recognizable)
        );
        if document.stored_path.as_deref() == Some(&relative) {
            continue;
        }
        let current = stored_path(root, document)?;
        let destination = root.join(&relative);
        if current != destination {
            match (current.exists(), destination.exists()) {
                (true, false) => {
                    if fs::rename(&current, &destination).is_err() {
                        continue;
                    }
                }
                (false, true) => {}
                _ => continue,
            }
        }
        document.stored_path = Some(relative);
        changed = true;
    }
    Ok(changed)
}

pub fn migrate_document_authors(root: &Path, data: &mut KnowledgeData) -> bool {
    let mut changed = false;
    for document in &mut data.documents {
        // An unavailable index must not erase previously saved author metadata.
        let Some(extracted) = fs::read(extraction_index_path(root, document.id))
            .ok()
            .and_then(|bytes| parse_extracted(&bytes))
        else {
            continue;
        };
        let extension = document.extension_name.trim_start_matches('.');
        let bytes = if matches!(extension, "html" | "htm") {
            stored_path(root, document)
                .ok()
                .and_then(|path| fs::read(path).ok())
                .unwrap_or_default()
        } else {
            vec![]
        };
        let authors = extract_authors(extension, &bytes, &extracted);
        if document.authors != authors {
            document.authors = authors;
            changed = true;
        }
        if extension == "pdf" {
            let legacy_name = legacy_paper_display_name(&extracted);
            let detected_name = paper_display_name(&extracted);
            let current = document.display_name.as_deref();
            let team_misnamed = current.is_some_and(|value| {
                value.to_lowercase().starts_with("team et al.,")
                    && document
                        .authors
                        .first()
                        .is_some_and(|author| author.to_lowercase().ends_with(" team"))
            });
            if detected_name.is_some()
                && (current.is_none() || current == legacy_name.as_deref() || team_misnamed)
                && document.display_name != detected_name
            {
                document.display_name = detected_name;
                changed = true;
            }
        }
    }
    changed
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
    fn ocr_fallback_preserves_native_pages_and_original_page_numbers() {
        let native = ExtractedDocument {
            text: "native searchable first page text".into(),
            pages: vec![
                ExtractedPage {
                    number: 1,
                    text: "native searchable first page text".into(),
                },
                ExtractedPage {
                    number: 2,
                    text: "".into(),
                },
                ExtractedPage {
                    number: 3,
                    text: "native searchable third page text".into(),
                },
            ],
        };
        let extracted = pdf_ocr_fallback(Ok(native), |pages| {
            assert_eq!(pages, "2");
            Ok(ExtractedDocument {
                text: "recovered second page".into(),
                pages: vec![ExtractedPage {
                    number: 2,
                    text: "recovered second page".into(),
                }],
            })
        })
        .unwrap();
        assert_eq!(extracted.pages.len(), 3);
        assert!(extracted.pages[0].text.starts_with("native"));
        assert_eq!(extracted.pages[1].text, "recovered second page");
        assert_eq!(extracted.pages[2].number, 3);
        assert!(extracted.text.contains("recovered second page"));
    }

    #[test]
    fn ocr_fallback_handles_parser_errors_and_never_accepts_empty_recognition() {
        let extracted = pdf_ocr_fallback(Err("parser panic".into()), |pages| {
            assert_eq!(pages, "all");
            Ok(ExtractedDocument {
                text: "recognized scan".into(),
                pages: vec![ExtractedPage {
                    number: 1,
                    text: "recognized scan".into(),
                }],
            })
        })
        .unwrap();
        assert_eq!(extracted.text, "recognized scan");
        let failed = pdf_ocr_fallback(Err("parser panic".into()), |_| Err("models missing".into()))
            .unwrap_err();
        assert!(failed.contains("parser panic") && failed.contains("models missing"));
        assert!(pdf_ocr_fallback(Ok(ExtractedDocument::default()), |_| Ok(
            ExtractedDocument::default()
        ))
        .is_err());
        let text_only = ExtractedDocument {
            text: "existing text".into(),
            pages: vec![],
        };
        assert_eq!(
            pdf_ocr_fallback(Ok(text_only), |_| Err("OCR unavailable".into()))
                .unwrap()
                .text,
            "existing text"
        );
    }

    #[test]
    fn ocr_is_enabled_for_legacy_settings_but_good_native_pdf_bypasses_it() {
        let settings: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(settings.local_ocr_enabled);
        let extracted = ExtractedDocument {
            text: "already searchable native PDF text".into(),
            pages: vec![ExtractedPage {
                number: 1,
                text: "already searchable native PDF text".into(),
            }],
        };
        assert!(pdf_ocr_fallback(Ok(extracted), |_| panic!("must not run OCR")).is_ok());
    }

    #[test]
    fn native_pdf_extraction_keeps_blank_pages_in_place() {
        use lopdf::{dictionary, Document, Object, Stream};
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("blank-first.pdf");
        write_test_pdf(&path, false);
        let mut pdf = Document::load(&path).unwrap();
        let original = pdf.get_pages()[&1];
        let parent = pdf
            .get_object(original)
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"Parent")
            .unwrap()
            .as_reference()
            .unwrap();
        let content = pdf.add_object(Stream::new(dictionary! {}, vec![]));
        let blank = pdf.add_object(
            dictionary! { "Type" => "Page", "Parent" => parent, "Contents" => content },
        );
        let pages = pdf.get_object_mut(parent).unwrap().as_dict_mut().unwrap();
        pages.set(
            "Kids",
            vec![Object::Reference(blank), Object::Reference(original)],
        );
        pages.set("Count", 2);
        pdf.save(&path).unwrap();
        let extracted = extract_path(&path).unwrap();
        assert_eq!(extracted.pages.len(), 2);
        assert!(extracted.pages[0].text.trim().is_empty());
        assert!(extracted.pages[1].text.contains("Manual PDF import"));
        assert_eq!(extracted.pages[1].number, 2);
    }

    fn write_test_pdf(path: &Path, unsupported_encoding: bool) {
        use lopdf::{
            content::{Content, Operation},
            dictionary, Document, Object, Stream,
        };

        let mut pdf = Document::with_version("1.5");
        let pages_id = pdf.new_object_id();
        let mut font = dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        };
        if unsupported_encoding {
            font.set("Encoding", "UnsupportedEncoding");
        }
        let font_id = pdf.add_object(font);
        let resources_id =
            pdf.add_object(dictionary! { "Font" => dictionary! { "F1" => font_id } });
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 12.into()]),
                Operation::new("Td", vec![50.into(), 750.into()]),
                Operation::new("Tj", vec![Object::string_literal("Manual PDF import")]),
                Operation::new("ET", vec![]),
            ],
        }
        .encode()
        .unwrap();
        let content_id = pdf.add_object(Stream::new(dictionary! {}, content));
        let page_id = pdf.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "Contents" => content_id,
        });
        pdf.objects.insert(pages_id, dictionary! {
            "Type" => "Pages", "Kids" => vec![Object::Reference(page_id)], "Count" => 1,
            "Resources" => resources_id, "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        }.into());
        let catalog_id = pdf.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        pdf.trailer.set("Root", catalog_id);
        pdf.save(path).unwrap();
    }

    fn pdf_test_state(root: &Path) -> AppState {
        AppState {
            inner: Mutex::new(Inner {
                root: root.to_path_buf(),
                data: KnowledgeData::default(),
                settings: AppSettings {
                    local_ocr_enabled: false,
                    ..AppSettings::default()
                },
            }),
            processes: Mutex::new(HashMap::new()),
            cancelled_runs: Mutex::new(HashSet::new()),
            api_key_cache: Mutex::new(None),
        }
    }

    #[test]
    fn refresh_continues_after_bad_pdf_and_persists_good_files() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        prepare_directories(root).unwrap();
        let bad = source_dir(root).join("00-unsupported.pdf");
        write_test_pdf(&bad, true);
        fs::write(source_dir(root).join("01-invalid.pdf"), b"not a PDF").unwrap();
        write_test_pdf(&source_dir(root).join("02-good.pdf"), false);
        fs::write(
            documents_dir(root).join("03-good.txt"),
            "searchable healthy text",
        )
        .unwrap();
        let state = pdf_test_state(root);

        let result = crate::reload_library_data(&state).unwrap();
        assert_eq!(result.warnings.len(), 2);
        assert!(result
            .warnings
            .iter()
            .any(|message| message.contains("00-unsupported.pdf")));
        assert!(result
            .warnings
            .iter()
            .any(|message| message.contains("01-invalid.pdf")));
        assert_eq!(result.data.documents.len(), 2);
        assert_eq!(load_data(root).unwrap().documents.len(), 2);
        assert!(bad.exists());
        let next = crate::reload_library_data(&state).unwrap();
        assert_eq!(next.warnings.len(), 2);
        assert_eq!(next.data.documents.len(), 2);
        assert_eq!(
            search_documents(&state.inner.lock().unwrap(), "healthy").len(),
            1
        );
    }

    #[test]
    fn refresh_continues_after_failed_old_index_and_imports_new_file() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        prepare_directories(root).unwrap();
        fs::write(source_dir(root).join("old.txt"), "old text").unwrap();
        fs::write(source_dir(root).join("repairable.txt"), "repairable text").unwrap();
        let state = pdf_test_state(root);
        let initial = crate::reload_library_data(&state).unwrap().data;
        let document = &initial.documents[0];
        let index = extraction_index_path(root, document.id);
        fs::write(&index, b"broken index").unwrap();
        fs::remove_file(stored_path(root, document).unwrap()).unwrap();
        let repairable = &initial.documents[1];
        let repairable_index = extraction_index_path(root, repairable.id);
        fs::remove_file(&repairable_index).unwrap();
        write_test_pdf(&source_dir(root).join("new.pdf"), false);

        let result = crate::reload_library_data(&state).unwrap();
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("old.txt"));
        assert_eq!(result.data.documents.len(), 3);
        assert_eq!(load_data(root).unwrap().documents.len(), 3);
        assert!(repairable_index.exists());
        assert_eq!(read_extracted(root, repairable.id).text, "repairable text");
        assert_eq!(fs::read(index).unwrap(), b"broken index");
    }

    #[test]
    fn refresh_imports_manual_pdf_and_reuses_persisted_index() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("中文资料库");
        prepare_directories(&root).unwrap();
        let source = source_dir(&root).join("手动论文.pdf");
        write_test_pdf(&source, false);
        let state = pdf_test_state(&root);
        let data = crate::reload_library_data(&state).unwrap().data;
        assert_eq!(data.documents.len(), 1);
        assert!(!source.exists());
        let document = &data.documents[0];
        assert!(stored_path(&root, document).unwrap().exists());
        assert_eq!(document.page_count, Some(1));
        assert!(read_extracted(&root, document.id)
            .text
            .contains("Manual PDF import"));
        assert_eq!(load_data(&root).unwrap().documents.len(), 1);
        let next = crate::reload_library_data(&state).unwrap().data;
        assert_eq!(next.documents.len(), 1);
        assert_eq!(next.documents[0].id, document.id);
    }

    #[test]
    fn pdf_parser_panic_returns_error_and_preserves_source_and_state() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        prepare_directories(root).unwrap();
        let source = source_dir(root).join("unsupported-font.pdf");
        write_test_pdf(&source, true);
        let state = pdf_test_state(root);
        let result = crate::reload_library_data(&state).unwrap();
        assert_eq!(result.warnings.len(), 1);
        let message = &result.warnings[0];
        assert!(message.contains("unsupported-font.pdf"), "{message}");
        assert!(message.contains("unexpected encoding"), "{message}");
        {
            let inner = state.inner.lock().unwrap();
            assert!(source.exists());
            assert!(inner.data.documents.is_empty());
            assert_eq!(fs::read_dir(index_dir(root)).unwrap().count(), 0);
            assert_eq!(fs::read_dir(chunks_dir(root)).unwrap().count(), 0);
        }
        write_test_pdf(&source, false);
        assert_eq!(
            crate::reload_library_data(&state)
                .unwrap()
                .data
                .documents
                .len(),
            1
        );
        assert_eq!(load_data(root).unwrap().documents.len(), 1);
    }

    #[test]
    fn invalid_pdf_returns_named_error_without_moving_original() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        prepare_directories(root).unwrap();
        let source = source_dir(root).join("invalid.pdf");
        fs::write(&source, b"not a PDF").unwrap();
        let state = pdf_test_state(root);
        let result = crate::reload_library_data(&state).unwrap();
        assert_eq!(result.warnings.len(), 1);
        let message = &result.warnings[0];
        assert!(message.contains("invalid.pdf"), "{message}");
        assert!(source.exists());
        assert!(state.inner.lock().unwrap().data.documents.is_empty());
    }

    #[test]
    fn refresh_repairs_missing_or_invalid_pdf_indexes_and_keeps_document_id() {
        for contents in [None, Some("broken JSON"), Some("{}")] {
            let directory = tempfile::tempdir().unwrap();
            let root = directory.path();
            prepare_directories(root).unwrap();
            write_test_pdf(&source_dir(root).join("paper.pdf"), false);
            let state = pdf_test_state(root);
            let initial = crate::reload_library_data(&state).unwrap().data;
            let document = &initial.documents[0];
            let index = index_dir(root).join(format!("{}.json", document.id));
            if let Some(contents) = contents {
                fs::write(&index, contents).unwrap();
            } else {
                fs::remove_file(&index).unwrap();
            }
            let mut stale: ChunkCache =
                serde_json::from_slice(&fs::read(chunk_cache_path(root, document.id)).unwrap())
                    .unwrap();
            stale.chunks[0].text = "stale text".into();
            fs::write(
                chunk_cache_path(root, document.id),
                serde_json::to_vec(&stale).unwrap(),
            )
            .unwrap();

            let next = crate::reload_library_data(&state).unwrap().data;
            assert_eq!(next.documents[0].id, document.id);
            assert_eq!(next.documents.len(), 1);
            assert!(read_extracted(root, document.id)
                .text
                .contains("Manual PDF import"));
            let cache: ChunkCache =
                serde_json::from_slice(&fs::read(chunk_cache_path(root, document.id)).unwrap())
                    .unwrap();
            assert!(cache.chunks[0].text.contains("Manual PDF import"));
            if let Some(contents) = contents {
                assert_eq!(
                    fs::read_to_string(index.with_extension("json.pre-rebuild.bak")).unwrap(),
                    contents
                );
            }
            let persisted = fs::read(&index).unwrap();
            crate::reload_library_data(&state).unwrap();
            assert_eq!(fs::read(&index).unwrap(), persisted);
        }
    }

    #[test]
    fn legacy_pdf_index_and_nested_original_are_reused_without_reparsing() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        prepare_directories(root).unwrap();
        write_test_pdf(&source_dir(root).join("paper.pdf"), false);
        let state = pdf_test_state(root);
        let mut initial = crate::reload_library_data(&state).unwrap().data;
        let document = &mut initial.documents[0];
        let index = index_dir(root).join(format!("{}.json", document.id));
        let legacy_index =
            index_dir(root).join(format!("{}.json", document.id.to_string().to_uppercase()));
        let legacy_bytes = br#"{"text":"legacy searchable text","pages":[{"number":1,"text":"legacy searchable text"}]}"#;
        fs::rename(&index, &legacy_index).unwrap();
        fs::write(&legacy_index, legacy_bytes).unwrap();
        let nested = documents_dir(root).join(document.id.to_string().to_uppercase());
        fs::create_dir_all(&nested).unwrap();
        let original = nested.join(&document.name);
        fs::rename(stored_path(root, document).unwrap(), &original).unwrap();
        // A compatible legacy index must be reused even if extraction is unavailable.
        fs::write(&original, b"cannot reparse this PDF").unwrap();
        document.stored_path = None;
        let id = document.id;
        save_data(root, &initial).unwrap();
        assert!(read_extracted(root, id)
            .text
            .contains("legacy searchable text"));
        let next = crate::reload_library_data(&state).unwrap().data;
        assert_eq!(next.documents[0].id, initial.documents[0].id);
        assert_eq!(
            stored_path(root, &next.documents[0])
                .unwrap()
                .canonicalize()
                .unwrap(),
            original.canonicalize().unwrap()
        );
        assert!(next.documents[0].stored_path.is_some());
        assert_eq!(fs::read(legacy_index).unwrap(), legacy_bytes);
        assert_eq!(
            search_documents(&state.inner.lock().unwrap(), "searchable").len(),
            1
        );
    }

    #[test]
    fn failed_pdf_index_rebuild_keeps_existing_files_and_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        prepare_directories(root).unwrap();
        write_test_pdf(&source_dir(root).join("paper.pdf"), false);
        let state = pdf_test_state(root);
        let mut initial = crate::reload_library_data(&state).unwrap().data;
        initial.documents[0].authors = vec!["Previously saved author".into()];
        save_data(root, &initial).unwrap();
        let document = &initial.documents[0];
        let index = index_dir(root).join(format!("{}.json", document.id));
        fs::write(&index, b"old incompatible index").unwrap();
        let mut startup_data = initial.clone();
        assert!(!migrate_document_authors(root, &mut startup_data));
        assert_eq!(startup_data.documents[0].authors, document.authors);
        let chunks = fs::read(chunk_cache_path(root, document.id)).unwrap();
        write_test_pdf(&stored_path(root, document).unwrap(), true);
        let result = crate::reload_library_data(&state).unwrap();
        assert_eq!(result.warnings.len(), 1);
        let message = &result.warnings[0];
        assert!(message.contains("paper.pdf"), "{message}");
        assert_eq!(fs::read(&index).unwrap(), b"old incompatible index");
        assert_eq!(
            fs::read(chunk_cache_path(root, document.id)).unwrap(),
            chunks
        );
        assert_eq!(load_data(root).unwrap().documents[0].id, document.id);
        assert_eq!(
            serde_json::to_value(load_data(root).unwrap()).unwrap(),
            serde_json::to_value(initial).unwrap()
        );
        assert!(state.inner.lock().is_ok());
    }

    #[test]
    fn chunking_and_score_match_native_semantics() {
        let values = chunks(&"a".repeat(3000), 1400, 180);
        assert_eq!(values.len(), 3);
        assert!(score("rag", "RAG retrieval", "paper") > 0);
        assert!(score("rag", "body", "RAG title") > score("rag", "RAG body", "title"));
    }

    #[test]
    fn cached_chunks_target_256_tokens_and_keep_page_offsets() {
        let document = KnowledgeDocument {
            id: Uuid::new_v4(),
            name: "paper.pdf".into(),
            display_name: None,
            authors: vec![],
            extension_name: ".pdf".into(),
            size: 1,
            sha256: "digest".into(),
            stored_path: None,
            imported_at: now(),
            status: "ready".into(),
            page_count: Some(1),
            error: None,
            source_url: None,
        };
        let extracted = ExtractedDocument {
            text: "研究".repeat(800),
            pages: vec![ExtractedPage {
                number: 3,
                text: "研究".repeat(800),
            }],
        };
        let cache = build_chunk_cache(&document, &extracted);
        assert_eq!(cache.target_tokens, 256);
        assert_eq!(cache.overlap_tokens, 48);
        assert!(cache.chunks.len() > 3);
        assert!(cache.chunks.iter().all(|chunk| chunk.page == Some(3)));
        assert!(cache.chunks.iter().all(|chunk| chunk.start < chunk.end));
        assert!(cache
            .chunks
            .iter()
            .all(|chunk| chunk.approximate_tokens <= 256));
        assert!(cache.chunks[1].start < cache.chunks[0].end);
    }

    #[test]
    fn chunk_cache_reuses_valid_data_and_rebuilds_stale_or_corrupt_data() {
        let root = tempfile::tempdir().unwrap();
        prepare_directories(root.path()).unwrap();
        let mut document = KnowledgeDocument {
            id: Uuid::new_v4(),
            name: "paper.txt".into(),
            display_name: None,
            authors: vec![],
            extension_name: ".txt".into(),
            size: 1,
            sha256: "digest-v1".into(),
            stored_path: None,
            imported_at: now(),
            status: "ready".into(),
            page_count: None,
            error: None,
            source_url: None,
        };
        let original = ExtractedDocument {
            text: "original cached text".into(),
            pages: vec![],
        };
        let changed = ExtractedDocument {
            text: "changed extracted text".into(),
            pages: vec![],
        };

        let first = read_or_build_chunk_cache(root.path(), &document, &original);
        let reused = read_or_build_chunk_cache(root.path(), &document, &changed);
        assert_eq!(reused.chunks[0].text, first.chunks[0].text);

        document.sha256 = "digest-v2".into();
        let rebuilt = read_or_build_chunk_cache(root.path(), &document, &changed);
        assert_eq!(rebuilt.source_sha256, "digest-v2");
        assert_eq!(rebuilt.chunks[0].text, "changed extracted text");

        fs::write(chunk_cache_path(root.path(), document.id), b"not-json").unwrap();
        let recovered = read_or_build_chunk_cache(root.path(), &document, &original);
        assert_eq!(recovered.chunks[0].text, "original cached text");
        let repaired: ChunkCache =
            serde_json::from_slice(&fs::read(chunk_cache_path(root.path(), document.id)).unwrap())
                .unwrap();
        assert_eq!(repaired.chunks[0].text, "original cached text");

        let mut legacy_cache = repaired;
        legacy_cache.version = 0;
        legacy_cache.chunks[0].text = "legacy chunk format".into();
        fs::write(
            chunk_cache_path(root.path(), document.id),
            serde_json::to_vec(&legacy_cache).unwrap(),
        )
        .unwrap();
        let upgraded = read_or_build_chunk_cache(root.path(), &document, &original);
        assert_eq!(upgraded.version, CHUNK_CACHE_VERSION);
        assert_eq!(upgraded.chunks[0].text, "original cached text");
    }

    #[test]
    fn selected_quote_recalls_its_chunk_and_builds_cache_lazily() {
        let root = std::env::temp_dir()
            .join("KnowledgeMaster-tests")
            .join(Uuid::new_v4().to_string());
        prepare_directories(&root).unwrap();
        let id = Uuid::new_v4();
        let document = KnowledgeDocument {
            id,
            name: "paper.pdf".into(),
            display_name: Some("Readable paper".into()),
            authors: vec![],
            extension_name: ".pdf".into(),
            size: 1,
            sha256: "digest".into(),
            stored_path: None,
            imported_at: now(),
            status: "ready".into(),
            page_count: Some(1),
            error: None,
            source_url: None,
        };
        let extracted = ExtractedDocument {
            text: format!(
                "{} selected evidence {}",
                "before ".repeat(180),
                "after ".repeat(180)
            ),
            pages: vec![],
        };
        fs::write(
            index_dir(&root).join(format!("{id}.json")),
            serde_json::to_vec(&extracted).unwrap(),
        )
        .unwrap();
        let mut data = KnowledgeData::default();
        data.documents.push(document);
        let inner = Inner {
            root: root.clone(),
            data,
            settings: AppSettings::default(),
        };
        let values = context_chunks(
            &inner,
            "explain this evidence",
            Some("selected evidence"),
            &[id],
            &[],
        );
        assert!(values.first().unwrap().text.contains("selected evidence"));
        assert!(values.len() <= 8);
        assert!(chunk_cache_path(&root, id).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn query_terms_support_chinese_punctuation() {
        assert_eq!(query_terms("RAG，Agent。"), vec!["rag", "agent"]);
    }

    #[test]
    fn paper_metadata_handles_multiline_titles_headers_and_team_authors() {
        let cases = [
            (
                "arXiv:2602.15763v2 [cs.LG] 24 Feb 2026\nGLM-5: from Vibe Coding to Agentic Engineering\nGLM-5 Team\nZhipu AI & Tsinghua University\n(For the complete list of authors, please refer to the Contribution section)\nAbstract\nBody",
                "GLM-5 Team, GLM-5: from Vibe Coding to Agentic Engineering",
                "GLM-5 Team",
            ),
            (
                "2026-1-27\nLatentMoE: Toward Optimal Accuracy per FLOP\nand Parameter in Mixture of Experts\nVenmugil Elango, Nidhi Bhatia, Roger Waleffe, Rasoul Shafipour, Tomer\nAsida, Abhinav Khattar, Nave Assaf, Maximilian Golub, Joey Guman\narXiv:2601.18089v1 [cs.LG] 26 Jan 2026\nAbstract. Body",
                "Elango et al., LatentMoE: Toward Optimal Accuracy per FLOP and Parameter in Mixture of Experts",
                "Venmugil Elango",
            ),
            (
                "arXiv:2412.06464v3 [cs.CL] 6 Mar 2025\nPublished as a conference paper at ICLR 2025\nGATED DELTA NETWORKS:\nIMPROVING MAMBA2 WITH DELTA RULE\nSonglin Yang∗\nMIT CSAIL\nyangsl66@mit.edu\nJan Kautz\nNVIDIA\nABSTRACT\nBody",
                "Yang et al., GATED DELTA NETWORKS: IMPROVING MAMBA2 WITH DELTA RULE",
                "Songlin Yang",
            ),
            (
                "KIMI K3: OPEN FRONTIER INTELLIGENCE\nTECHNICAL REPORT OF KIMI K3\nKimi Team\nAbstract\nBody",
                "Kimi Team, KIMI K3: OPEN FRONTIER INTELLIGENCE",
                "Kimi Team",
            ),
        ];
        for (source, expected_name, expected_author) in cases {
            let extracted = ExtractedDocument {
                text: source.into(),
                pages: vec![ExtractedPage {
                    number: 1,
                    text: source.into(),
                }],
            };
            let (_, authors) = paper_title_and_authors(&extracted).unwrap();
            assert!(authors.first().unwrap().contains(expected_author));
            assert_eq!(
                paper_display_name(&extracted).as_deref(),
                Some(expected_name)
            );
        }
    }

    #[test]
    fn metadata_migration_repairs_legacy_kimi_author_name() {
        let root = std::env::temp_dir()
            .join("KnowledgeMaster-tests")
            .join(Uuid::new_v4().to_string());
        prepare_directories(&root).unwrap();
        let id = Uuid::new_v4();
        let extracted = ExtractedDocument {
            text: "KIMI K3: OPEN FRONTIER INTELLIGENCE\nTECHNICAL REPORT OF KIMI K3\nKimi Team\nAbstract\nBody".into(),
            pages: vec![],
        };
        fs::write(
            index_dir(&root).join(format!("{id}.json")),
            serde_json::to_vec(&extracted).unwrap(),
        )
        .unwrap();
        let mut data = KnowledgeData::default();
        data.documents.push(KnowledgeDocument {
            id,
            name: "2607.24653.pdf".into(),
            display_name: Some("K3, KIMI K3: OPEN FRONTIER INTELLIGENCE".into()),
            authors: vec!["TECHNICAL REPORT OF KIMI K3".into()],
            extension_name: ".pdf".into(),
            size: 1,
            sha256: "digest".into(),
            stored_path: None,
            imported_at: now(),
            status: "ready".into(),
            page_count: Some(1),
            error: None,
            source_url: None,
        });

        assert!(migrate_document_authors(&root, &mut data));
        assert_eq!(data.documents[0].authors, vec!["Kimi Team"]);
        assert_eq!(
            data.documents[0].display_name.as_deref(),
            Some("Kimi Team, KIMI K3: OPEN FRONTIER INTELLIGENCE")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refresh_imports_manual_files_and_author_search_finds_them() {
        let root = std::env::temp_dir()
            .join("KnowledgeMaster-tests")
            .join(Uuid::new_v4().to_string());
        prepare_directories(&root).unwrap();
        let root_file = source_dir(&root).join("manual-paper.md");
        let documents_file = documents_dir(&root).join("notes.txt");
        fs::write(
            &root_file,
            "---\nauthor: Ada Lovelace, Alan Turing\n---\nkeyword body",
        )
        .unwrap();
        fs::write(&documents_file, "second document").unwrap();
        let mut inner = Inner {
            root: root.clone(),
            data: KnowledgeData::default(),
            settings: AppSettings::default(),
        };

        assert_eq!(sync_source_documents(&mut inner, &mut vec![]).unwrap(), 2);
        assert!(!root_file.exists());
        assert!(!documents_file.exists());
        assert!(inner
            .data
            .documents
            .iter()
            .all(|document| stored_path(&root, document).unwrap().exists()));
        assert_eq!(search_documents(&inner, "Lovelace").len(), 1);
        assert_eq!(search_documents(&inner, "keyword body").len(), 1);
        assert_eq!(sync_source_documents(&mut inner, &mut vec![]).unwrap(), 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn flat_filename_is_cross_platform_safe() {
        let value = flat_stored_filename(Uuid::nil(), "a:b/c\\d?e*.pdf");
        assert!(!value.contains(':'));
        assert!(!value.contains('/'));
        assert!(!value.contains('\\'));
        assert!(!value.contains('?'));
        assert!(!value.contains('*'));
    }

    #[test]
    fn parsed_title_becomes_the_recognizable_original_filename() {
        assert_eq!(
            recognizable_document_name(
                "2607.24653.pdf",
                Some("Zhao et al., Retrieval: A Study?"),
                "pdf"
            ),
            "Zhao et al., Retrieval_ A Study_.pdf"
        );
    }

    #[test]
    fn existing_original_is_renamed_when_a_display_title_exists() {
        let root = std::env::temp_dir()
            .join("KnowledgeMaster-tests")
            .join(Uuid::new_v4().to_string());
        prepare_directories(&root).unwrap();
        let id = Uuid::new_v4();
        let old_relative = format!("source/documents/{id}--2607.24653.pdf");
        fs::write(root.join(&old_relative), b"pdf").unwrap();
        let mut data = KnowledgeData::default();
        data.documents.push(KnowledgeDocument {
            id,
            name: "2607.24653.pdf".into(),
            display_name: Some("Zhao et al., Retrieval: A Study?".into()),
            authors: vec![],
            extension_name: ".pdf".into(),
            size: 3,
            sha256: "digest".into(),
            stored_path: Some(old_relative),
            imported_at: now(),
            status: "ready".into(),
            page_count: Some(1),
            error: None,
            source_url: None,
        });
        assert!(migrate_document_filenames(&root, &mut data).unwrap());
        let document = &data.documents[0];
        assert_eq!(document.name, "2607.24653.pdf");
        let stored = stored_path(&root, document).unwrap();
        assert!(stored.exists());
        let expected = format!("{id}--Zhao et al., Retrieval_ A Study_.pdf");
        assert_eq!(
            stored.file_name().and_then(|value| value.to_str()),
            Some(expected.as_str())
        );
        let _ = fs::remove_dir_all(root);
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
        inner.data.documents.push(KnowledgeDocument {
            id: document_id,
            name: "paper.pdf".into(),
            display_name: None,
            authors: vec![],
            extension_name: ".pdf".into(),
            size: 1,
            sha256: "hash".into(),
            stored_path: None,
            imported_at: now(),
            status: "ready".into(),
            page_count: None,
            error: None,
            source_url: None,
        });
        inner.data.topics = vec![
            Topic {
                id: removed_topic,
                name: "移出".into(),
                parent_id: None,
                created_at: now(),
            },
            Topic {
                id: retained_topic,
                name: "保留".into(),
                parent_id: None,
                created_at: now(),
            },
        ];
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

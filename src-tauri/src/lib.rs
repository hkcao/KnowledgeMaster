mod agent;
mod ai;
mod export;
mod models;
mod store;

use crate::{
    models::*,
    store::{error, import_one, save_data, AppState},
};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

fn snapshot(state: &AppState) -> Result<store::Inner, String> {
    state.inner.lock().map_err(error).map(|inner| inner.clone())
}

fn bootstrap_value(state: &AppState) -> Result<BootstrapState, String> {
    let inner = snapshot(state)?;
    Ok(BootstrapState {
        root_path: inner.root.to_string_lossy().into_owned(),
        data: inner.data,
        settings: inner.settings,
        agent_availability: agent::availability(),
    })
}

#[tauri::command]
fn bootstrap(state: State<'_, AppState>) -> Result<BootstrapState, String> {
    bootstrap_value(&state)
}

#[tauri::command]
fn reload_library(state: State<'_, AppState>) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    inner.data = store::load_data(&inner.root)?;
    let root = inner.root.clone();
    store::migrate_notes(&root, &mut inner.data)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn update_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    store::save_local_settings(&settings)?;
    state.inner.lock().map_err(error)?.settings = settings;
    Ok(())
}

#[tauri::command]
fn set_library_root(
    state: State<'_, AppState>,
    path: String,
    migrate: bool,
) -> Result<BootstrapState, String> {
    {
        let mut inner = state.inner.lock().map_err(error)?;
        store::switch_root(&mut inner, PathBuf::from(path), migrate)?;
    }
    bootstrap_value(&state)
}

#[tauri::command]
fn reveal_path(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let target = state
        .inner
        .lock()
        .map_err(error)?
        .root
        .to_string_lossy()
        .into_owned();
    app.opener().open_path(target, None::<&str>).map_err(error)
}

#[tauri::command]
fn import_files(state: State<'_, AppState>, paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    Ok(store::import_paths(&mut inner, &paths))
}

#[tauri::command]
async fn import_web_page(state: State<'_, AppState>, url: String) -> Result<Vec<String>, String> {
    let normalized = normalize_web_url(&url)?;
    let response = reqwest::Client::new()
        .get(&normalized)
        .header(reqwest::header::USER_AGENT, "KnowledgeMaster/0.1")
        .send()
        .await
        .map_err(error)?;
    if !response.status().is_success() {
        return Err(format!("网页返回 {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(error)?;
    let host = reqwest::Url::parse(&normalized)
        .map_err(error)?
        .host_str()
        .unwrap_or("web")
        .replace(
            |character: char| !(character.is_ascii_alphanumeric() || ".-".contains(character)),
            "-",
        );
    let digest = {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(normalized.as_bytes()))
    };
    let temporary = std::env::temp_dir().join(format!("web-{}-{}.html", host, &digest[..10]));
    fs::write(&temporary, bytes).map_err(error)?;
    let result = {
        let mut inner = state.inner.lock().map_err(error)?;
        vec![import_one(&mut inner, &temporary, Some(normalized.clone()))
            .unwrap_or_else(|value| format!("导入失败：{value}"))]
    };
    let _ = fs::remove_file(temporary);
    Ok(result)
}

fn normalize_web_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    let candidate = if value.contains("://") {
        value.to_string()
    } else {
        format!("https://{value}")
    };
    let parsed = reqwest::Url::parse(&candidate).map_err(error)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("只支持 HTTP 或 HTTPS 网址".into());
    }
    Ok(parsed.into())
}

#[tauri::command]
fn delete_document(state: State<'_, AppState>, id: Uuid) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    store::delete_document(&mut inner, id)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn create_topic(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<Uuid>,
) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    store::create_topic(&mut inner, &name, parent_id)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn rename_topic(
    state: State<'_, AppState>,
    id: Uuid,
    name: String,
) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    let topic = inner
        .data
        .topics
        .iter_mut()
        .find(|topic| topic.id == id)
        .ok_or("主题不存在")?;
    if name.trim().is_empty() {
        return Err("主题名称不能为空".into());
    }
    topic.name = name.trim().into();
    save_data(&inner.root, &inner.data)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn delete_topic(state: State<'_, AppState>, id: Uuid) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    store::delete_topic(&mut inner, id)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn link_document(
    state: State<'_, AppState>,
    document_id: Uuid,
    topic_id: Uuid,
) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
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
        save_data(&inner.root, &inner.data)?;
    }
    Ok(inner.data.clone())
}

#[tauri::command]
fn move_document(
    state: State<'_, AppState>,
    document_id: Uuid,
    source_topic_id: Option<Uuid>,
    target_topic_id: Option<Uuid>,
) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    store::move_document(&mut inner, document_id, source_topic_id, target_topic_id)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn update_document_name(
    state: State<'_, AppState>,
    id: Uuid,
    display_name: String,
) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    let document = inner
        .data
        .documents
        .iter_mut()
        .find(|document| document.id == id)
        .ok_or("文档不存在")?;
    document.display_name =
        (!display_name.trim().is_empty()).then(|| display_name.trim().to_string());
    save_data(&inner.root, &inner.data)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn search_documents(state: State<'_, AppState>, query: String) -> Result<Vec<Uuid>, String> {
    let inner = state.inner.lock().map_err(error)?;
    Ok(store::search_documents(&inner, &query))
}

#[tauri::command]
fn recommend_topics(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<Vec<TopicRecommendation>, String> {
    let inner = state.inner.lock().map_err(error)?;
    Ok(store::recommend_topics(&inner, id))
}

#[tauri::command]
fn apply_recommendations(
    state: State<'_, AppState>,
    document_id: Uuid,
    names: Vec<String>,
) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    store::apply_recommendations(&mut inner, document_id, &names)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn document_payload(state: State<'_, AppState>, id: Uuid) -> Result<ReaderDocumentPayload, String> {
    let inner = state.inner.lock().map_err(error)?;
    store::reader_payload(&inner, id)
}

#[tauri::command]
fn add_annotation(
    state: State<'_, AppState>,
    document_id: Uuid,
    quote: String,
    page: Option<usize>,
    kind: String,
    note: String,
    rects: Vec<AnnotationRect>,
) -> Result<KnowledgeData, String> {
    if !matches!(kind.as_str(), "highlight" | "underline" | "note") {
        return Err("批注类型无效".into());
    }
    let mut inner = state.inner.lock().map_err(error)?;
    let timestamp = now();
    inner.data.annotations.push(KnowledgeAnnotation {
        id: Uuid::new_v4(),
        document_id,
        page,
        quote,
        kind,
        note,
        rects,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    });
    save_data(&inner.root, &inner.data)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn update_annotation(
    state: State<'_, AppState>,
    id: Uuid,
    note: String,
) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    let annotation = inner
        .data
        .annotations
        .iter_mut()
        .find(|annotation| annotation.id == id)
        .ok_or("批注不存在")?;
    annotation.note = note;
    annotation.updated_at = now();
    save_data(&inner.root, &inner.data)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn delete_annotation(state: State<'_, AppState>, id: Uuid) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    inner
        .data
        .annotations
        .retain(|annotation| annotation.id != id);
    for note in &mut inner.data.summary_notes {
        note.annotation_ids
            .retain(|annotation_id| *annotation_id != id);
    }
    save_data(&inner.root, &inner.data)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn toggle_bookmark(
    state: State<'_, AppState>,
    document_id: Uuid,
    page_index: usize,
) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    if let Some(index) = inner
        .data
        .bookmarks
        .iter()
        .position(|item| item.document_id == document_id)
    {
        if inner.data.bookmarks[index].page_index == page_index {
            inner.data.bookmarks.remove(index);
        } else {
            inner.data.bookmarks[index].page_index = page_index;
            inner.data.bookmarks[index].updated_at = now();
        }
    } else {
        inner.data.bookmarks.push(DocumentBookmark {
            document_id,
            page_index,
            updated_at: now(),
        });
    }
    save_data(&inner.root, &inner.data)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn save_summary_note(
    state: State<'_, AppState>,
    note: SummaryNoteInput,
) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    store::save_summary_note(&mut inner, note)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn delete_summary_note(state: State<'_, AppState>, id: Uuid) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    if let Some(note) = inner.data.summary_notes.iter().find(|note| note.id == id) {
        if let Some(path) = &note.stored_path {
            let candidate = inner.root.join(path);
            if candidate.starts_with(store::notes_dir(&inner.root)) {
                let _ = fs::remove_file(candidate);
            }
        }
    }
    inner.data.summary_notes.retain(|note| note.id != id);
    save_data(&inner.root, &inner.data)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn save_conversation(
    state: State<'_, AppState>,
    conversation: Conversation,
) -> Result<KnowledgeData, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    if let Some(index) = inner
        .data
        .conversations
        .iter()
        .position(|value| value.id == conversation.id)
    {
        inner.data.conversations[index] = conversation;
    } else {
        inner.data.conversations.insert(0, conversation);
    }
    save_data(&inner.root, &inner.data)?;
    Ok(inner.data.clone())
}

#[tauri::command]
fn save_api_key(state: State<'_, AppState>, key: String) -> Result<(), String> {
    ai::save_api_key(&state, &key)
}

#[tauri::command]
fn clear_api_key(state: State<'_, AppState>) -> Result<(), String> {
    ai::clear_api_key(&state)
}

#[tauri::command]
async fn test_api(state: State<'_, AppState>) -> Result<String, String> {
    let settings = snapshot(&state)?.settings;
    ai::test_connection(&state, &settings).await
}

#[tauri::command]
async fn chat_direct(
    state: State<'_, AppState>,
    conversation: Conversation,
    question: String,
    quote: Option<ReaderQuote>,
    document_ids: Vec<Uuid>,
    topic_ids: Vec<Uuid>,
    include_annotations: bool,
) -> Result<DirectChatResult, String> {
    let inner = snapshot(&state)?;
    ai::direct_chat(
        &state,
        &inner,
        &conversation,
        &question,
        quote.as_ref(),
        &document_ids,
        &topic_ids,
        include_annotations,
    )
    .await
}

#[tauri::command]
async fn summarize_conversation(
    state: State<'_, AppState>,
    conversation: Conversation,
) -> Result<String, String> {
    let inner = snapshot(&state)?;
    ai::summarize(&state, &inner, &conversation).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn run_agent(
    app: AppHandle,
    state: State<'_, AppState>,
    backend: String,
    run_id: Uuid,
    conversation_id: Uuid,
    question: String,
    quote: Option<ReaderQuote>,
    document_ids: Vec<Uuid>,
    topic_ids: Vec<Uuid>,
    include_annotations: bool,
    session_id: Option<String>,
) -> Result<AgentRunResult, String> {
    let inner = snapshot(&state)?;
    agent::run_agent(
        &app,
        &state,
        &inner,
        &backend,
        &run_id.to_string(),
        conversation_id,
        &question,
        quote.as_ref(),
        &document_ids,
        &topic_ids,
        include_annotations,
        session_id.as_deref(),
    )
    .await
}

#[tauri::command]
fn stop_agent(state: State<'_, AppState>, run_id: Uuid) -> Result<(), String> {
    agent::stop_agent(&state, &run_id.to_string())
}

#[tauri::command]
async fn test_agent(
    app: AppHandle,
    state: State<'_, AppState>,
    backend: String,
    run_id: Uuid,
) -> Result<String, String> {
    let inner = snapshot(&state)?;
    agent::test_agent(&app, &state, &inner, &backend, &run_id.to_string()).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportPendingResult {
    data: KnowledgeData,
    document_ids: Vec<Uuid>,
}

#[tauri::command]
fn import_pending(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<ImportPendingResult, String> {
    let mut inner = state.inner.lock().map_err(error)?;
    let pending_root = store::pending_dir(&inner.root);
    let before: std::collections::HashSet<_> = inner
        .data
        .documents
        .iter()
        .map(|document| document.id)
        .collect();
    for relative in paths {
        let path = inner.root.join(&relative);
        if !path.starts_with(&pending_root) || !path.is_file() {
            continue;
        }
        if import_one(&mut inner, &path, None).is_ok() {
            let _ = fs::remove_file(path);
        }
    }
    let document_ids = inner
        .data
        .documents
        .iter()
        .filter(|document| !before.contains(&document.id))
        .map(|document| document.id)
        .collect();
    Ok(ImportPendingResult {
        data: inner.data.clone(),
        document_ids,
    })
}

#[tauri::command]
fn discard_pending(state: State<'_, AppState>, paths: Vec<String>) -> Result<(), String> {
    let inner = state.inner.lock().map_err(error)?;
    let pending_root = store::pending_dir(&inner.root);
    for relative in paths {
        let path = inner.root.join(relative);
        if path.starts_with(&pending_root) && path.is_file() {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

#[tauri::command]
fn export_document(
    state: State<'_, AppState>,
    document_id: Uuid,
    destination: String,
    annotated: bool,
) -> Result<(), String> {
    let inner = state.inner.lock().map_err(error)?;
    export::export_document(&inner, document_id, Path::new(&destination), annotated)
}

pub fn run() {
    let state = AppState::load().expect("failed to initialize KnowledgeMaster state");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            reload_library,
            update_settings,
            set_library_root,
            reveal_path,
            import_files,
            import_web_page,
            delete_document,
            create_topic,
            rename_topic,
            delete_topic,
            link_document,
            move_document,
            update_document_name,
            search_documents,
            recommend_topics,
            apply_recommendations,
            document_payload,
            add_annotation,
            update_annotation,
            delete_annotation,
            toggle_bookmark,
            save_summary_note,
            delete_summary_note,
            save_conversation,
            save_api_key,
            clear_api_key,
            test_api,
            chat_direct,
            summarize_conversation,
            run_agent,
            stop_agent,
            test_agent,
            import_pending,
            discard_pending,
            export_document
        ])
        .build(tauri::generate_context!())
        .expect("error while building KnowledgeMaster");
    app.run(|handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            agent::stop_all(&handle.state::<AppState>());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_urls_accept_host_and_reject_non_web_schemes() {
        assert_eq!(
            normalize_web_url("example.com").unwrap(),
            "https://example.com/"
        );
        assert!(normalize_web_url("file:///tmp/a").is_err());
    }
}

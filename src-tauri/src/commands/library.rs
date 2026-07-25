use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;
use crate::store::KnowledgeStore;
use crate::models::*;
use crate::web_import;

pub struct AppState(pub Mutex<KnowledgeStore>);

// Helper: lock and read
fn read_store<T>(state: &State<'_, AppState>, f: impl FnOnce(&KnowledgeStore) -> T) -> Result<T, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(f(&guard))
}

// Helper: lock and mutate
fn write_store<T>(state: &State<'_, AppState>, f: impl FnOnce(&mut KnowledgeStore) -> T) -> Result<T, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(f(&mut guard))
}

#[tauri::command]
pub async fn load_full_state(state: State<'_, AppState>) -> Result<KnowledgeData, String> {
    read_store(&state, |s| s.data.clone())
}

#[tauri::command]
pub async fn import_files(paths: Vec<String>, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let paths: Vec<std::path::PathBuf> = paths.iter().map(std::path::PathBuf::from).collect();
    write_store(&state, |s| s.import_files(&paths).map_err(|e| e.to_string())).flatten()
}

#[tauri::command]
pub async fn import_web_page(url: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let (content, source_url) = web_import::fetch_page(&url).await.map_err(|e| e.to_string())?;
    let title = web_import::html_title(&content);
    let source_url = url::Url::parse(&source_url).map_err(|e| e.to_string())?;

    write_store(&state, move |s| {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(source_url.as_str().as_bytes());
        let digest = hex::encode(hasher.finalize());
        let host = source_url.host_str().unwrap_or("web")
            .replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '-', "-");
        let filename = format!("web-{}-{}.html", host, &digest[..10]);
        let temp_dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
        let temp_file = temp_dir.join(&filename);
        std::fs::write(&temp_file, &content).map_err(|e| e.to_string())?;
        let imported = s.import_files(&[temp_file]).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_dir_all(&temp_dir);
        if let Some(doc) = s.data.documents.iter_mut().rev().next() {
            if let Some(t) = title { doc.display_name = Some(t); }
            doc.source_url = Some(source_url.to_string());
            let _ = s.save();
        }
        Ok::<_, String>(imported)
    }).flatten()
}

#[tauri::command]
pub async fn delete_document(id: Uuid, state: State<'_, AppState>) -> Result<(), String> {
    write_store(&state, |s| s.delete_document(id).map_err(|e| e.to_string())).flatten()
}

#[tauri::command]
pub async fn update_display_name(id: Uuid, name: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    write_store(&state, |s| s.update_display_name(id, name).map_err(|e| e.to_string())).flatten()
}

#[tauri::command]
pub async fn create_topic(name: String, parent_id: Option<Uuid>, state: State<'_, AppState>) -> Result<Option<Topic>, String> {
    write_store(&state, |s| s.create_topic(&name, parent_id).map_err(|e| e.to_string())).flatten()
}

#[tauri::command]
pub async fn rename_topic(id: Uuid, name: String, state: State<'_, AppState>) -> Result<(), String> {
    write_store(&state, |s| s.rename_topic(id, &name).map_err(|e| e.to_string())).flatten()
}

#[tauri::command]
pub async fn delete_topic(id: Uuid, state: State<'_, AppState>) -> Result<(), String> {
    write_store(&state, |s| s.delete_topic(id).map_err(|e| e.to_string())).flatten()
}

#[tauri::command]
pub async fn link_document(document_id: Uuid, topic_id: Uuid, state: State<'_, AppState>) -> Result<(), String> {
    write_store(&state, |s| s.link_document(document_id, topic_id).map_err(|e| e.to_string())).flatten()
}

#[tauri::command]
pub async fn unlink_document(document_id: Uuid, topic_id: Uuid, state: State<'_, AppState>) -> Result<(), String> {
    write_store(&state, |s| s.unlink_document(document_id, topic_id).map_err(|e| e.to_string())).flatten()
}

#[tauri::command]
pub async fn move_document(
    document_id: Uuid, from_topic: Option<Uuid>, to_topic: Option<Uuid>, state: State<'_, AppState>,
) -> Result<bool, String> {
    write_store(&state, |s| s.move_document(document_id, from_topic, to_topic).map_err(|e| e.to_string())).flatten()
}

#[tauri::command]
pub async fn search(query: String, topic_id: Option<Uuid>, state: State<'_, AppState>) -> Result<Vec<KnowledgeDocument>, String> {
    read_store(&state, |s| s.search(&query, topic_id))
}

#[tauri::command]
pub async fn recommend_topics(document_id: Uuid, state: State<'_, AppState>) -> Result<Vec<TopicRecommendation>, String> {
    read_store(&state, |s| {
        match s.data.documents.iter().find(|d| d.id == document_id) {
            Some(doc) => Ok(s.recommend_topics_for(doc)),
            None => Err("Document not found".to_string()),
        }
    }).flatten()
}

#[tauri::command]
pub async fn apply_recommendations(
    recommendations: Vec<TopicRecommendation>, document_id: Uuid, state: State<'_, AppState>,
) -> Result<(), String> {
    write_store(&state, |s| s.apply_recommendations(&recommendations, document_id).map_err(|e| e.to_string())).flatten()
}

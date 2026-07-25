use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;
use crate::store::KnowledgeStore;
use crate::commands::library::AppState;

#[tauri::command]
pub async fn export_original_document(document_id: Uuid, destination: String, state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let doc = guard.data.documents.iter().find(|d| d.id == document_id)
        .cloned().ok_or("Document not found".to_string())?;
    let source = guard.stored_path_for(&doc);
    crate::export::export_original(&source, &std::path::PathBuf::from(&destination)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_annotated_document(document_id: Uuid, destination: String, state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let doc = guard.data.documents.iter().find(|d| d.id == document_id)
        .cloned().ok_or("Document not found".to_string())?;
    let source = guard.stored_path_for(&doc);
    let annotations = guard.annotations_for(document_id);
    crate::export::export_annotated(&doc, &source, &annotations, &std::path::PathBuf::from(&destination)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_annotated_filename(document_id: Uuid, state: State<'_, AppState>) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let doc = guard.data.documents.iter().find(|d| d.id == document_id)
        .cloned().ok_or("Document not found".to_string())?;
    Ok(crate::export::annotated_filename(&doc))
}

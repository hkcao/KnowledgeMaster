use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;
use crate::store::KnowledgeStore;
use crate::models::*;
use crate::commands::library::AppState;

fn read_store<T>(state: &State<'_, AppState>, f: impl FnOnce(&KnowledgeStore) -> Result<T, String>) -> Result<T, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    f(&guard)
}

fn write_store<T>(state: &State<'_, AppState>, f: impl FnOnce(&mut KnowledgeStore) -> Result<T, String>) -> Result<T, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    f(&mut guard)
}

#[tauri::command]
pub async fn get_extracted_content(document_id: Uuid, state: State<'_, AppState>) -> Result<ExtractedDocument, String> {
    read_store(&state, |s| s.extracted_content_for(document_id).map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn get_document_outline(document_id: Uuid, state: State<'_, AppState>) -> Result<Vec<DocumentOutlineEntry>, String> {
    read_store(&state, |s| {
        let doc = s.data.documents.iter().find(|d| d.id == document_id)
            .cloned().ok_or("Document not found".to_string())?;
        let extracted = s.extracted_content_for(document_id).map_err(|e| e.to_string())?;
        let source_path = s.stored_path_for(&doc);
        Ok(crate::outline::build_outline(&doc, &source_path, &extracted))
    })
}

#[tauri::command]
pub async fn read_document_bytes(document_id: Uuid, state: State<'_, AppState>) -> Result<tauri::ipc::Response, String> {
    let bytes = read_store(&state, |s| {
        let doc = s.data.documents.iter().find(|d| d.id == document_id)
            .cloned().ok_or("Document not found".to_string())?;
        let path = s.stored_path_for(&doc);
        std::fs::read(&path).map_err(|e| e.to_string())
    })?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn add_annotation(
    document_id: Uuid, selection: ReaderSelection, kind: String, note: String, state: State<'_, AppState>,
) -> Result<KnowledgeAnnotation, String> {
    write_store(&state, |s| s.add_annotation(document_id, &selection, &kind, &note).map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn update_annotation(id: Uuid, note: String, state: State<'_, AppState>) -> Result<(), String> {
    write_store(&state, |s| s.update_annotation(id, &note).map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn delete_annotation(id: Uuid, state: State<'_, AppState>) -> Result<(), String> {
    write_store(&state, |s| s.delete_annotation(id).map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn get_annotations(document_id: Uuid, state: State<'_, AppState>) -> Result<Vec<KnowledgeAnnotation>, String> {
    read_store(&state, |s| Ok(s.annotations_for(document_id)))
}

#[tauri::command]
pub async fn toggle_bookmark(document_id: Uuid, page_index: i32, state: State<'_, AppState>) -> Result<bool, String> {
    write_store(&state, |s| s.toggle_bookmark(document_id, page_index).map_err(|e| e.to_string()))
}

#[tauri::command]
pub async fn get_bookmark(document_id: Uuid, state: State<'_, AppState>) -> Result<Option<i32>, String> {
    read_store(&state, |s| Ok(s.bookmark_page_for(document_id)))
}

#[tauri::command]
pub async fn get_library_root(state: State<'_, AppState>) -> Result<String, String> {
    read_store(&state, |s| Ok(s.root_path.to_string_lossy().to_string()))
}

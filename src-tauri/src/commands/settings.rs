use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;
use crate::store::KnowledgeStore;
use crate::models::AppSettings;
use crate::commands::library::AppState;

#[tauri::command]
pub async fn get_settings(_state: State<'_, AppState>) -> Result<AppSettings, String> {
    Ok(AppSettings::default())
}

#[tauri::command]
pub async fn save_settings(_settings: AppSettings, _state: State<'_, AppState>) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn switch_library_root(new_root: String, migrate: bool, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.switch_root(std::path::PathBuf::from(&new_root), migrate).map_err(|e| e.to_string())?;
    KnowledgeStore::save_library_root(&std::path::PathBuf::from(&new_root));
    Ok(())
}

#[tauri::command]
pub async fn test_api_connection(
    model: String, base_url: String, _state: State<'_, AppState>,
) -> Result<String, String> {
    let settings = AppSettings { model, base_url, ..Default::default() };
    let messages = vec![
        crate::ai_client::ChatMsg { role: "user".into(), content: "只回复：连接成功".into() },
    ];
    crate::ai_client::completion(&settings, &messages, None).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_agent(run_id: String) -> Result<(), String> {
    let uid = Uuid::parse_str(&run_id).map_err(|e| e.to_string())?;
    crate::agent_runner::terminate_process_sync(uid);
    Ok(())
}

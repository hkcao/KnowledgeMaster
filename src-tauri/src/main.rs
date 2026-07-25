#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;
use knowledge_master_lib::store::KnowledgeStore;
use knowledge_master_lib::commands::library::AppState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let store = KnowledgeStore::new(None)
                .expect("Failed to initialize knowledge store");
            app.manage(AppState(Mutex::new(store)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            knowledge_master_lib::commands::library::load_full_state,
            knowledge_master_lib::commands::library::import_files,
            knowledge_master_lib::commands::library::import_web_page,
            knowledge_master_lib::commands::library::delete_document,
            knowledge_master_lib::commands::library::update_display_name,
            knowledge_master_lib::commands::library::create_topic,
            knowledge_master_lib::commands::library::rename_topic,
            knowledge_master_lib::commands::library::delete_topic,
            knowledge_master_lib::commands::library::link_document,
            knowledge_master_lib::commands::library::unlink_document,
            knowledge_master_lib::commands::library::move_document,
            knowledge_master_lib::commands::library::search,
            knowledge_master_lib::commands::library::recommend_topics,
            knowledge_master_lib::commands::library::apply_recommendations,
            knowledge_master_lib::commands::reader::get_extracted_content,
            knowledge_master_lib::commands::reader::get_document_outline,
            knowledge_master_lib::commands::reader::read_document_bytes,
            knowledge_master_lib::commands::reader::add_annotation,
            knowledge_master_lib::commands::reader::update_annotation,
            knowledge_master_lib::commands::reader::delete_annotation,
            knowledge_master_lib::commands::reader::get_annotations,
            knowledge_master_lib::commands::reader::toggle_bookmark,
            knowledge_master_lib::commands::reader::get_bookmark,
            knowledge_master_lib::commands::reader::get_library_root,
            knowledge_master_lib::commands::chat::send_chat_message,
            knowledge_master_lib::commands::chat::get_conversations,
            knowledge_master_lib::commands::chat::delete_conversation,
            knowledge_master_lib::commands::chat::refine_paper_names,
            knowledge_master_lib::commands::chat::create_summary_note,
            knowledge_master_lib::commands::chat::update_summary_note,
            knowledge_master_lib::commands::chat::delete_summary_note,
            knowledge_master_lib::commands::chat::get_summary_note_markdown,
            knowledge_master_lib::commands::settings::get_settings,
            knowledge_master_lib::commands::settings::save_settings,
            knowledge_master_lib::commands::settings::switch_library_root,
            knowledge_master_lib::commands::settings::test_api_connection,
            knowledge_master_lib::commands::settings::stop_agent,
            knowledge_master_lib::commands::export_cmds::export_original_document,
            knowledge_master_lib::commands::export_cmds::export_annotated_document,
            knowledge_master_lib::commands::export_cmds::get_annotated_filename,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use crate::store::KnowledgeStore;
use crate::models::*;
use crate::commands::library::AppState;
use crate::{ai_client, agent_runner, agent_stream, file_tools};
use crate::paper_naming;
use chrono::Utc;
use uuid::Uuid;

#[tauri::command]
pub async fn send_chat_message(
    app: AppHandle,
    question: String,
    quote: Option<ReaderQuote>,
    document_ids: Vec<Uuid>,
    topic_ids: Vec<Uuid>,
    include_current: bool,
    include_annotations: bool,
    conversation_id: Option<Uuid>,
    backend: String,
    model: String,
    base_url: String,
    api_context_mode: String,
    vision_enabled: bool,
    state: State<'_, AppState>,
) -> Result<ChatMessage, String> {
    let settings = AppSettings {
        model: model.clone(),
        base_url: base_url.clone(),
        chat_backend: backend.clone(),
        provider: String::new(),
        chat_placement: String::new(),
        library_visible: true,
        api_context_mode: api_context_mode.clone(),
        vision_enabled,
    };

    // Phase 1: Extract all needed data from store (synchronous)
    let (mut conversation, context_chunks, annotations, generated_dir, agent_docs, agent_sources, download_dir) = {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        let store = &mut *guard;

        let conv = conversation_id
            .and_then(|id| store.data.conversations.iter().find(|c| c.id == id).cloned())
            .unwrap_or_else(|| Conversation {
                id: Uuid::new_v4(),
                title: if question.len() > 26 { format!("{}…", &question[..26]) } else { question.clone() },
                document_ids: Vec::new(),
                topic_ids: Vec::new(),
                include_current_page: false,
                include_annotations: true,
                current_document_id: None,
                messages: Vec::new(),
                summary: String::new(),
                summary_message_count: 0,
                agent_sessions: std::collections::HashMap::new(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
            });

        let user_msg = ChatMessage {
            id: Uuid::new_v4(),
            role: "user".into(),
            content: question.clone(),
            prompt_content: None,
            quote: quote.clone(),
            sources: None,
            backend: None,
            generated_files: None,
            pending_imports: None,
            trace_events: None,
            created_at: Utc::now(),
        };

        let mut conv = conv.clone();
        conv.messages.push(user_msg);

        let has_local_scope = !document_ids.is_empty() || !topic_ids.is_empty() || quote.is_some();
        let ctx = if backend == "direct" && api_context_mode == "relevant_fragments" && has_local_scope {
            store.context_chunks(&question, &document_ids, &topic_ids)
        } else {
            Vec::new()
        };
        let anns = if include_annotations {
            store.annotation_context(&question, &document_ids, &topic_ids)
        } else {
            Vec::new()
        };
        let gendir = store.generated_dir(conv.id);
        let adocs = store.agent_documents(&document_ids, &topic_ids);
        let asrc = store.agent_source_documents(&document_ids, &topic_ids);
        let run_id = Uuid::new_v4();
        let dldir = store.pending_agent_downloads_dir(run_id);

        (conv, ctx, anns, gendir, adocs, asrc, dldir)
    };

    // Phase 2: Do async work without holding the lock
    let has_local_scope = !document_ids.is_empty() || !topic_ids.is_empty() || quote.is_some();
    let answer = if backend == "direct" {
        let messages = if api_context_mode == "autonomous" && has_local_scope {
            let mut workspace = file_tools::KnowledgeFileTools::new(agent_docs, generated_dir)
                .map_err(|e| e.to_string())?;
            let manifest = workspace.manifest();
            let notes_str = annotations.iter().enumerate()
                .map(|(i, a)| format!("{}. {}", i + 1, a.quote))
                .collect::<Vec<_>>().join("\n");
            let prompt = format!("本轮授权的虚拟文件：\n{}\n\n用户批注：\n{}\n\n用户问题：\n{}",
                manifest,
                if notes_str.is_empty() { "（无）" } else { &notes_str },
                question);
            vec![
                ai_client::ChatMsg { role: "system".into(), content: "你是个人知识库助手。".into() },
                ai_client::ChatMsg { role: "user".into(), content: prompt },
            ]
        } else {
            let material = context_chunks.iter()
                .map(|c| format!("[{}：{}，第 {} 页]\n{}", c.label, c.document_name, c.page.unwrap_or(1), c.text))
                .collect::<Vec<_>>().join("\n\n");
            let notes_str = annotations.iter().enumerate()
                .map(|(i, a)| format!("[批注{}]\n{}", i + 1, a.quote))
                .collect::<Vec<_>>().join("\n\n");
            let system = if has_local_scope {
                "你是个人知识库助手。仅依据资料回答。".to_string()
            } else {
                "你是知屿的通用 AI 助手。本轮用户没有选择任何本地文档，请进行普通对话。".to_string()
            };
            let question_with_quote = quote.as_ref().map(|q| {
                format!("引用自「{}」：\n{}\n\n用户问题：\n{}", q.document_name, q.text, question)
            }).unwrap_or_else(|| question.clone());
            let prompt = if has_local_scope {
                format!("<knowledge_context>\n{}\n</knowledge_context>\n\n<user_annotations>\n{}\n</user_annotations>\n\n{}",
                    if material.is_empty() { "（无相关片段）" } else { &material },
                    if notes_str.is_empty() { "（无）" } else { &notes_str },
                    question_with_quote)
            } else {
                question_with_quote
            };
            vec![
                ai_client::ChatMsg { role: "system".into(), content: system },
                ai_client::ChatMsg { role: "user".into(), content: prompt },
            ]
        };
        ai_client::completion(&settings, &messages, None).await.map_err(|e| e.to_string())?
    } else {
        let run_id = Uuid::new_v4();
        let request = AgentRunRequest {
            question: question.clone(),
            quote: quote.clone(),
            history: Vec::new(),
            documents: agent_sources.clone(),
            annotations: annotations.clone(),
            download_directory: Some(download_dir.clone()),
        };

        let (mut child, _stdout_file, answer_file) = agent_runner::run_agent(&backend, &request, run_id)
            .map_err(|e| e.to_string())?;

        // Wait for process
        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("Agent exited with status: {:?}", status.code()));
        }

        std::fs::read_to_string(&answer_file)
            .unwrap_or_else(|_| "Agent 未返回回答".to_string())
            .trim()
            .to_string()
    };

    // Phase 3: Acquire lock again to save state
    let assistant_msg = {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        let store = &mut *guard;

        let msg = ChatMessage {
            id: Uuid::new_v4(),
            role: "assistant".into(),
            content: answer,
            prompt_content: None,
            quote: None,
            sources: if context_chunks.is_empty() { None } else {
                Some(context_chunks.into_iter().map(|c| ContextChunk { id: Uuid::new_v4(), ..c }).collect())
            },
            backend: Some(backend),
            generated_files: None,
            pending_imports: None,
            trace_events: None,
            created_at: Utc::now(),
        };

        conversation.messages.push(msg.clone());
        conversation.document_ids = document_ids;
        conversation.topic_ids = topic_ids;
        conversation.include_current_page = include_current;
        conversation.include_annotations = include_annotations;
        conversation.updated_at = Utc::now();

        store.save_conversation(&conversation).map_err(|e| e.to_string())?;
        msg
    };

    Ok(assistant_msg)
}

#[tauri::command]
pub async fn get_conversations(state: State<'_, AppState>) -> Result<Vec<Conversation>, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.data.conversations.clone())
}

#[tauri::command]
pub async fn delete_conversation(id: Uuid, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.data.conversations.retain(|c| c.id != id);
    guard.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refine_paper_names(document_ids: Vec<Uuid>, state: State<'_, AppState>) -> Result<String, String> {
    let (docs_info, settings) = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let docs: Vec<_> = document_ids.iter()
            .filter_map(|&id| {
                let doc = guard.data.documents.iter().find(|d| d.id == id)?.clone();
                let source = guard.stored_path_for(&doc);
                let extracted = guard.extracted_content_for(id).ok()?;
                Some((doc, source, extracted))
            })
            .collect();
        (docs, AppSettings::default())
    };

    let mut updated = 0;
    let mut unresolved = 0;

    for (doc, source, extracted) in docs_info {
        if paper_naming::needs_refinement(&doc) {
            match paper_naming::suggest_name(&doc, &source, &extracted, &settings).await {
                Ok(Some(name)) => {
                    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
                    if Some(&name) != doc.display_name.as_ref() {
                        guard.update_display_name(doc.id, Some(name)).map_err(|e| e.to_string())?;
                        updated += 1;
                    } else {
                        unresolved += 1;
                    }
                }
                Ok(None) => { unresolved += 1; }
                Err(_) => { unresolved += 1; }
            }
        }
    }
    Ok(format!("已更新 {} 篇论文名称，{} 篇未能可靠识别", updated, unresolved))
}

#[tauri::command]
pub async fn create_summary_note(
    title: String, content: String, annotation_ids: Vec<Uuid>, state: State<'_, AppState>,
) -> Result<Option<SummaryNote>, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.create_summary_note(&title, &content, &annotation_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_summary_note(
    id: Uuid, title: String, content: String, annotation_ids: Vec<Uuid>, state: State<'_, AppState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.update_summary_note(id, &title, &content, &annotation_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_summary_note(id: Uuid, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.delete_summary_note(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_summary_note_markdown(id: Uuid, state: State<'_, AppState>) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let note = guard.data.summary_notes.iter().find(|n| n.id == id)
        .cloned()
        .ok_or_else(|| "Note not found".to_string())?;
    guard.summary_note_markdown_for(&note).map_err(|e| e.to_string())
}

impl serde::Serialize for crate::models::TopicRecommendation {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("TopicRecommendation", 2)?;
        s.serialize_field("name", &self.name)?;
        s.serialize_field("reason", &self.reason)?;
        s.end()
    }
}

impl<'de> serde::Deserialize<'de> for crate::models::TopicRecommendation {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        struct Helper { name: String, reason: String }
        let h = Helper::deserialize(deserializer)?;
        Ok(crate::models::TopicRecommendation { name: h.name, reason: h.reason })
    }
}

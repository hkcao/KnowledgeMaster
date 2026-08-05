use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDocument {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(rename = "extension")]
    pub extension_name: String,
    pub size: i64,
    pub sha256: String,
    #[serde(default)]
    pub stored_path: Option<String>,
    pub imported_at: String,
    #[serde(default = "ready")]
    pub status: String,
    #[serde(default)]
    pub page_count: Option<usize>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
}

impl KnowledgeDocument {
    pub fn title(&self) -> &str {
        self.display_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&self.name)
    }
}

fn ready() -> String {
    "ready".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Topic {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<Uuid>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTopic {
    pub document_id: Uuid,
    pub topic_id: Uuid,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBookmark {
    pub document_id: Uuid,
    pub page_index: usize,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationRect {
    pub page: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeAnnotation {
    pub id: Uuid,
    pub document_id: Uuid,
    #[serde(default)]
    pub page: Option<usize>,
    pub quote: String,
    pub kind: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub rects: Vec<AnnotationRect>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderQuote {
    pub text: String,
    #[serde(default)]
    pub document_id: Option<Uuid>,
    pub document_name: String,
    #[serde(default)]
    pub page: Option<usize>,
    #[serde(default, skip_serializing)]
    pub image_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextChunk {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub label: String,
    pub document_id: Uuid,
    pub document_name: String,
    #[serde(default)]
    pub page: Option<usize>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTraceEvent {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default = "now")]
    pub created_at: String,
}

impl AgentTraceEvent {
    pub fn new(kind: &str, title: impl Into<String>, detail: Option<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            kind: kind.to_string(),
            title: title.into(),
            detail,
            created_at: now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: Uuid,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub prompt_content: Option<String>,
    #[serde(default)]
    pub quote: Option<ReaderQuote>,
    #[serde(default)]
    pub sources: Option<Vec<ContextChunk>>,
    #[serde(default)]
    pub backend: Option<String>,
    #[serde(default)]
    pub generated_files: Option<Vec<String>>,
    #[serde(default)]
    pub pending_imports: Option<Vec<String>>,
    #[serde(default)]
    pub trace_events: Option<Vec<AgentTraceEvent>>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionState {
    pub id: String,
    pub scope_signature: String,
    pub message_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: Uuid,
    #[serde(default = "new_chat")]
    pub title: String,
    #[serde(default)]
    pub document_ids: Vec<Uuid>,
    #[serde(default)]
    pub topic_ids: Vec<Uuid>,
    #[serde(default)]
    pub include_current_page: bool,
    #[serde(default = "default_true")]
    pub include_annotations: bool,
    #[serde(default)]
    pub current_document_id: Option<Uuid>,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub summary_message_count: usize,
    #[serde(default)]
    pub agent_sessions: HashMap<String, AgentSessionState>,
    pub created_at: String,
    pub updated_at: String,
}

fn new_chat() -> String {
    "新对话".to_string()
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicSummary {
    pub topic_id: Uuid,
    pub summary: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryNote {
    pub id: Uuid,
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub stored_path: Option<String>,
    #[serde(default, rename = "annotationIDs")]
    pub annotation_ids: Vec<Uuid>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryNoteInput {
    #[serde(default)]
    pub id: Option<Uuid>,
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default, rename = "annotationIDs")]
    pub annotation_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedPage {
    pub number: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedDocument {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub pages: Vec<ExtractedPage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeData {
    #[serde(default = "version")]
    pub version: usize,
    #[serde(default)]
    pub documents: Vec<KnowledgeDocument>,
    #[serde(default)]
    pub topics: Vec<Topic>,
    #[serde(default)]
    pub document_topics: Vec<DocumentTopic>,
    #[serde(default)]
    pub bookmarks: Vec<DocumentBookmark>,
    #[serde(default)]
    pub annotations: Vec<KnowledgeAnnotation>,
    #[serde(default)]
    pub conversations: Vec<Conversation>,
    #[serde(default)]
    pub topic_summaries: Vec<TopicSummary>,
    #[serde(default)]
    pub summary_notes: Vec<SummaryNote>,
}

impl Default for KnowledgeData {
    fn default() -> Self {
        Self {
            version: version(),
            documents: vec![],
            topics: vec![],
            document_topics: vec![],
            bookmarks: vec![],
            annotations: vec![],
            conversations: vec![],
            topic_summaries: vec![],
            summary_notes: vec![],
        }
    }
}

fn version() -> usize {
    6
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "provider")]
    pub provider: String,
    #[serde(default = "base_url")]
    pub base_url: String,
    #[serde(default = "model")]
    pub model: String,
    #[serde(default = "direct")]
    pub chat_backend: String,
    #[serde(default = "right")]
    pub chat_placement: String,
    #[serde(default = "default_true")]
    pub library_visible: bool,
    #[serde(default = "fragments")]
    pub api_context_mode: String,
    #[serde(default)]
    pub vision_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            provider: provider(),
            base_url: base_url(),
            model: model(),
            chat_backend: direct(),
            chat_placement: right(),
            library_visible: true,
            api_context_mode: fragments(),
            vision_enabled: false,
        }
    }
}

fn provider() -> String {
    "deepseek".into()
}
fn base_url() -> String {
    "https://api.deepseek.com".into()
}
fn model() -> String {
    "deepseek-chat".into()
}
fn direct() -> String {
    "direct".into()
}
fn right() -> String {
    "right".into()
}
fn fragments() -> String {
    "relevantFragments".into()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapState {
    pub root_path: String,
    pub data: KnowledgeData,
    pub settings: AppSettings,
    pub agent_availability: HashMap<String, Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderDocumentPayload {
    pub kind: String,
    pub content: String,
    pub extracted_text: String,
    pub pages: Vec<ExtractedPage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicRecommendation {
    pub topic_id: Uuid,
    pub name: String,
    pub reason: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectChatResult {
    pub answer: String,
    pub sources: Vec<ContextChunk>,
    pub generated_files: Vec<String>,
    pub prompt_content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub answer: String,
    pub generated_files: Vec<String>,
    pub pending_imports: Vec<String>,
    pub trace_events: Vec<AgentTraceEvent>,
    pub session_id: Option<String>,
}

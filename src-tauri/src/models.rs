use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeData {
    #[serde(default = "default_version")]
    pub version: i32,
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

fn default_version() -> i32 { 5 }

impl KnowledgeData {
    pub fn new() -> Self {
        Self {
            version: 5,
            documents: Vec::new(),
            topics: Vec::new(),
            document_topics: Vec::new(),
            bookmarks: Vec::new(),
            annotations: Vec::new(),
            conversations: Vec::new(),
            topic_summaries: Vec::new(),
            summary_notes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KnowledgeDocument {
    pub id: Uuid,
    pub name: String,
    pub display_name: Option<String>,
    #[serde(rename = "extension")]
    pub extension_name: String,
    pub size: i64,
    pub sha256: String,
    #[serde(default)]
    pub stored_path: Option<String>,
    pub imported_at: DateTime<Utc>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub page_count: Option<i32>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
}

impl KnowledgeDocument {
    pub fn display_title(&self) -> String {
        match &self.display_name {
            Some(name) if !name.trim().is_empty() => name.clone(),
            _ => self.name.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Topic {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentTopic {
    pub document_id: Uuid,
    pub topic_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentBookmark {
    pub document_id: Uuid,
    pub page_index: i32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnnotationRect {
    pub page: i32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KnowledgeAnnotation {
    pub id: Uuid,
    pub document_id: Uuid,
    #[serde(default)]
    pub page: Option<i32>,
    pub quote: String,
    pub kind: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub rects: Vec<AnnotationRect>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentTraceEvent {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub detail: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentSessionState {
    pub id: String,
    pub scope_signature: String,
    pub message_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Conversation {
    pub id: Uuid,
    #[serde(default = "default_title")]
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
    pub summary_message_count: i32,
    #[serde(default)]
    pub agent_sessions: std::collections::HashMap<String, AgentSessionState>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn default_title() -> String { "新对话".to_string() }
fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TopicSummary {
    pub topic_id: Uuid,
    pub summary: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SummaryNote {
    pub id: Uuid,
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub stored_path: Option<String>,
    #[serde(default)]
    pub annotation_ids: Vec<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReaderQuote {
    pub text: String,
    #[serde(default)]
    pub document_id: Option<Uuid>,
    pub document_name: String,
    #[serde(default)]
    pub page: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContextChunk {
    pub id: Uuid,
    pub label: String,
    pub document_id: Uuid,
    pub document_name: String,
    #[serde(default)]
    pub page: Option<i32>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExtractedPage {
    pub number: i32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExtractedDocument {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub pages: Vec<ExtractedPage>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentDocument {
    pub id: Uuid,
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentSourceDocument {
    pub id: Uuid,
    pub name: String,
    pub display_name: Option<String>,
    pub source_url: std::path::PathBuf,
    pub cache_url: std::path::PathBuf,
    pub baseline_extraction_url: Option<std::path::PathBuf>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentRunRequest {
    pub question: String,
    pub quote: Option<ReaderQuote>,
    pub history: Vec<ChatMessage>,
    pub documents: Vec<AgentSourceDocument>,
    pub annotations: Vec<KnowledgeAnnotation>,
    pub download_directory: Option<std::path::PathBuf>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentRunResult {
    pub answer: String,
    pub generated_files: Vec<String>,
    pub trace_events: Vec<AgentTraceEvent>,
    pub downloaded_files: Vec<std::path::PathBuf>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReaderSelection {
    pub text: String,
    #[serde(default)]
    pub page: Option<i32>,
    #[serde(default)]
    pub rects: Vec<AnnotationRect>,
    #[serde(default)]
    pub anchor_x: Option<f64>,
    #[serde(default)]
    pub anchor_y: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TopicRecommendation {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentOutlineEntry {
    pub id: String,
    pub title: String,
    pub level: i32,
    pub target: DocumentNavigationTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "value")]
pub enum DocumentNavigationTarget {
    #[serde(rename = "pdf")]
    Pdf { page_index: i32, point: Option<(f64, f64)> },
    #[serde(rename = "text")]
    Text { location: usize },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppSettings {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub chat_backend: String,
    pub chat_placement: String,
    pub library_visible: bool,
    pub api_context_mode: String,
    pub vision_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            provider: "deepseek".into(),
            base_url: "https://api.deepseek.com".into(),
            model: "deepseek-chat".into(),
            chat_backend: "direct".into(),
            chat_placement: "right".into(),
            library_visible: true,
            api_context_mode: "relevant_fragments".into(),
            vision_enabled: false,
        }
    }
}

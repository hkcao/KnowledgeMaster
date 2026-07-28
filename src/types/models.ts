export interface KnowledgeData {
  version: number;
  documents: KnowledgeDocument[];
  topics: Topic[];
  document_topics: DocumentTopic[];
  bookmarks: DocumentBookmark[];
  annotations: KnowledgeAnnotation[];
  conversations: Conversation[];
  topic_summaries: TopicSummary[];
  summary_notes: SummaryNote[];
}

export interface KnowledgeDocument {
  id: string;
  name: string;
  display_name: string | null;
  extension: string;
  size: number;
  sha256: string;
  stored_path: string | null;
  imported_at: string;
  status: string;
  page_count: number | null;
  error: string | null;
  source_url: string | null;
  display_title: string;
}

export interface Topic {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface DocumentTopic {
  document_id: string;
  topic_id: string;
  created_at: string;
}

export interface DocumentBookmark {
  document_id: string;
  page_index: number;
  updated_at: string;
}

export interface AnnotationRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KnowledgeAnnotation {
  id: string;
  document_id: string;
  page: number | null;
  quote: string;
  kind: string;
  note: string;
  rects: AnnotationRect[];
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  prompt_content?: string;
  quote?: ReaderQuote;
  sources?: ContextChunk[];
  backend?: string;
  generated_files?: string[];
  pending_imports?: string[];
  trace_events?: AgentTraceEvent[];
  created_at: string;
}

export interface AgentTraceEvent {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  document_ids: string[];
  topic_ids: string[];
  include_current_page: boolean;
  include_annotations: boolean;
  current_document_id: string | null;
  messages: ChatMessage[];
  summary: string;
  summary_message_count: number;
  agent_sessions: Record<string, AgentSessionState>;
  created_at: string;
  updated_at: string;
}

export interface AgentSessionState {
  id: string;
  scope_signature: string;
  message_count: number;
}

export interface TopicSummary {
  topic_id: string;
  summary: string;
  updated_at: string;
}

export interface SummaryNote {
  id: string;
  title: string;
  content: string;
  stored_path: string | null;
  annotation_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ReaderQuote {
  text: string;
  document_id?: string;
  document_name: string;
  page?: number;
}

export interface ContextChunk {
  id: string;
  label: string;
  document_id: string;
  document_name: string;
  page?: number;
  text: string;
}

export interface ReaderSelection {
  text: string;
  page?: number;
  rects: AnnotationRect[];
  anchor_x?: number;
  anchor_y?: number;
}

export interface ExtractedDocument {
  text: string;
  pages: ExtractedPage[];
}

export interface ExtractedPage {
  number: number;
  text: string;
}

export interface DocumentOutlineEntry {
  id: string;
  title: string;
  level: number;
  target: DocumentNavigationTarget;
}

export type DocumentNavigationTarget =
  | { type: "pdf"; value: { page_index: number; point: [number, number] | null } }
  | { type: "text"; value: { location: number } };

export interface TopicRecommendation {
  name: string;
  reason: string;
}

export interface AppSettings {
  provider: string;
  base_url: string;
  model: string;
  chat_backend: string;
  chat_placement: string;
  library_visible: boolean;
  api_context_mode: string;
  vision_enabled: boolean;
  api_key?: string;
}

export type ChatPlacement = "right" | "bottom" | "sidebar" | "hidden";

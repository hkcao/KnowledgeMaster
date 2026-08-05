export type UUID = string;
export type ChatBackend = "direct" | "claudeCode" | "codex";
export type ChatPlacement = "right" | "bottom" | "sidebar" | "hidden";
export type APIContextMode = "relevantFragments" | "autonomous";

export interface KnowledgeDocument {
  id: UUID;
  name: string;
  displayName?: string | null;
  extension: string;
  size: number;
  sha256: string;
  storedPath?: string | null;
  importedAt: string;
  status: string;
  pageCount?: number | null;
  error?: string | null;
  sourceURL?: string | null;
}

export interface Topic {
  id: UUID;
  name: string;
  parentId?: UUID | null;
  createdAt: string;
}

export interface DocumentTopic {
  documentId: UUID;
  topicId: UUID;
  createdAt: string;
}

export interface DocumentBookmark {
  documentId: UUID;
  pageIndex: number;
  updatedAt: string;
}

export interface AnnotationRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AnnotationKind = "highlight" | "underline" | "note";

export interface KnowledgeAnnotation {
  id: UUID;
  documentId: UUID;
  page?: number | null;
  quote: string;
  kind: AnnotationKind;
  note: string;
  rects: AnnotationRect[];
  createdAt: string;
  updatedAt: string;
}

export interface ReaderQuote {
  text: string;
  documentId?: UUID | null;
  documentName: string;
  page?: number | null;
  imageBase64?: string;
}

export interface ContextChunk {
  id: UUID;
  label: string;
  documentId: UUID;
  documentName: string;
  page?: number | null;
  text: string;
}

export type AgentTraceKind = "status" | "tool" | "file" | "warning" | "error" | "completed";

export interface AgentTraceEvent {
  id: UUID;
  kind: AgentTraceKind;
  title: string;
  detail?: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: UUID;
  role: "user" | "assistant";
  content: string;
  promptContent?: string | null;
  quote?: ReaderQuote | null;
  sources?: ContextChunk[] | null;
  backend?: string | null;
  generatedFiles?: string[] | null;
  pendingImports?: string[] | null;
  traceEvents?: AgentTraceEvent[] | null;
  createdAt: string;
}

export interface AgentSessionState {
  id: string;
  scopeSignature: string;
  messageCount: number;
}

export interface Conversation {
  id: UUID;
  title: string;
  documentIds: UUID[];
  topicIds: UUID[];
  includeCurrentPage: boolean;
  includeAnnotations: boolean;
  currentDocumentId?: UUID | null;
  messages: ChatMessage[];
  summary: string;
  summaryMessageCount: number;
  agentSessions: Record<string, AgentSessionState>;
  createdAt: string;
  updatedAt: string;
}

export interface SummaryNote {
  id: UUID;
  title: string;
  content: string;
  storedPath?: string | null;
  annotationIDs: UUID[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeData {
  version: number;
  documents: KnowledgeDocument[];
  topics: Topic[];
  documentTopics: DocumentTopic[];
  bookmarks: DocumentBookmark[];
  annotations: KnowledgeAnnotation[];
  conversations: Conversation[];
  topicSummaries: Array<{ topicId: UUID; summary: string; updatedAt: string }>;
  summaryNotes: SummaryNote[];
}

export interface AppSettings {
  provider: "deepseek" | "glm" | "custom";
  baseURL: string;
  model: string;
  chatBackend: ChatBackend;
  chatPlacement: ChatPlacement;
  libraryVisible: boolean;
  apiContextMode: APIContextMode;
  visionEnabled: boolean;
}

export interface BootstrapState {
  rootPath: string;
  data: KnowledgeData;
  settings: AppSettings;
  agentAvailability: Record<"claudeCode" | "codex", string | null>;
}

export interface ReaderDocumentPayload {
  kind: "pdf" | "html" | "markdown" | "text";
  content: string;
  extractedText: string;
  pages: Array<{ number: number; text: string }>;
}

export interface TopicRecommendation {
  topicId: UUID;
  name: string;
  reason: string;
  source: "ai" | "local";
}

export interface AgentRunResult {
  answer: string;
  generatedFiles: string[];
  pendingImports: string[];
  traceEvents: AgentTraceEvent[];
  sessionID?: string | null;
}

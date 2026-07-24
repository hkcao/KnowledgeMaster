export type UUID = string;

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

export interface KnowledgeAnnotation {
  id: UUID;
  documentId: UUID;
  page?: number | null;
  quote: string;
  kind: "highlight" | "underline" | "note" | string;
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
}

export interface ContextChunk {
  id: UUID;
  label: string;
  documentId: UUID;
  documentName: string;
  page?: number | null;
  text: string;
}

export interface AgentTraceEvent {
  id: UUID;
  kind: "status" | "tool" | "file" | "warning" | "error" | "completed";
  title: string;
  detail?: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: UUID;
  role: "user" | "assistant" | string;
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
  agentSessions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TopicSummary {
  topicId: UUID;
  summary: string;
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
  topicSummaries: TopicSummary[];
  summaryNotes: SummaryNote[];
}

export interface AppSettings {
  provider: string;
  baseURL: string;
  model: string;
  chatBackend: "direct" | "claudeCode" | "codex";
  chatPlacement: "right" | "bottom" | "hidden";
  libraryVisible: boolean;
  apiContextMode: "relevantFragments" | "autonomous";
  visionEnabled: boolean;
  libraryRoot: string;
  hasAPIKey: boolean;
}

export interface BootstrapData {
  data: KnowledgeData;
  settings: AppSettings;
}

export interface ImportResult {
  data: KnowledgeData;
  messages: string[];
  importedIds: string[];
}

export interface AgentResult {
  answer: string;
  traceEvents: AgentTraceEvent[];
  generatedFiles: string[];
}

export interface KnowledgeMasterAPI {
  bootstrap(): Promise<BootstrapData>;
  saveData(data: KnowledgeData): Promise<void>;
  chooseFiles(): Promise<string[]>;
  pathForFile(file: File): string;
  chooseFolder(): Promise<string | null>;
  importPaths(paths: string[]): Promise<ImportResult>;
  importUrl(url: string): Promise<ImportResult>;
  chooseLibrary(): Promise<string | null>;
  switchLibrary(path: string, migrate: boolean): Promise<BootstrapData>;
  readDocument(storedPath: string): Promise<{ text: string; fileUrl: string }>;
  writeNote(storedPath: string | null, title: string, content: string): Promise<string>;
  exportDocument(documentId: string, annotated: boolean): Promise<string | null>;
  openExternal(storedPath: string): Promise<void>;
  updateSettings(patch: Partial<AppSettings> & { apiKey?: string }): Promise<AppSettings>;
  complete(messages: Array<{ role: string; content: string }>): Promise<string>;
  runAgent(backend: "claudeCode" | "codex", prompt: string, documentIds: string[]): Promise<AgentResult>;
  platform: string;
}

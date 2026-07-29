import { invoke } from "@tauri-apps/api/core";
import type {
  AgentRunResult,
  AnnotationKind,
  AnnotationRect,
  AppSettings,
  BootstrapState,
  Conversation,
  KnowledgeAnnotation,
  KnowledgeData,
  ReaderDocumentPayload,
  ReaderQuote,
  SummaryNote,
  TopicRecommendation,
  UUID
} from "./types";

export const api = {
  bootstrap: () => invoke<BootstrapState>("bootstrap"),
  reload: () => invoke<KnowledgeData>("reload_library"),
  updateSettings: (settings: AppSettings) => invoke<void>("update_settings", { settings }),
  setLibraryRoot: (path: string, migrate: boolean) =>
    invoke<BootstrapState>("set_library_root", { path, migrate }),
  revealPath: () => invoke<void>("reveal_path"),
  importFiles: (paths: string[]) => invoke<string[]>("import_files", { paths }),
  importWebPage: (url: string) => invoke<string[]>("import_web_page", { url }),
  deleteDocument: (id: UUID) => invoke<KnowledgeData>("delete_document", { id }),
  createTopic: (name: string, parentId?: UUID | null) =>
    invoke<KnowledgeData>("create_topic", { name, parentId: parentId ?? null }),
  renameTopic: (id: UUID, name: string) => invoke<KnowledgeData>("rename_topic", { id, name }),
  deleteTopic: (id: UUID) => invoke<KnowledgeData>("delete_topic", { id }),
  linkDocument: (documentId: UUID, topicId: UUID) =>
    invoke<KnowledgeData>("link_document", { documentId, topicId }),
  moveDocument: (documentId: UUID, sourceTopicId?: UUID | null, targetTopicId?: UUID | null) =>
    invoke<KnowledgeData>("move_document", {
      documentId,
      sourceTopicId: sourceTopicId ?? null,
      targetTopicId: targetTopicId ?? null
    }),
  updateDocumentName: (id: UUID, displayName: string) =>
    invoke<KnowledgeData>("update_document_name", { id, displayName }),
  search: (query: string) => invoke<UUID[]>("search_documents", { query }),
  recommendations: (id: UUID) => invoke<TopicRecommendation[]>("recommend_topics", { id }),
  applyRecommendations: (documentId: UUID, names: string[]) =>
    invoke<KnowledgeData>("apply_recommendations", { documentId, names }),
  documentPayload: (id: UUID) => invoke<ReaderDocumentPayload>("document_payload", { id }),
  addAnnotation: (
    documentId: UUID,
    quote: string,
    page: number | null,
    kind: AnnotationKind,
    note: string,
    rects: AnnotationRect[]
  ) =>
    invoke<KnowledgeData>("add_annotation", {
      documentId,
      quote,
      page,
      kind,
      note,
      rects
    }),
  updateAnnotation: (id: UUID, note: string) =>
    invoke<KnowledgeData>("update_annotation", { id, note }),
  deleteAnnotation: (id: UUID) => invoke<KnowledgeData>("delete_annotation", { id }),
  toggleBookmark: (documentId: UUID, pageIndex: number) =>
    invoke<KnowledgeData>("toggle_bookmark", { documentId, pageIndex }),
  saveSummaryNote: (note: Partial<SummaryNote> & { title: string; content: string; annotationIDs: UUID[] }) =>
    invoke<KnowledgeData>("save_summary_note", { note }),
  deleteSummaryNote: (id: UUID) => invoke<KnowledgeData>("delete_summary_note", { id }),
  saveConversation: (conversation: Conversation) =>
    invoke<KnowledgeData>("save_conversation", { conversation }),
  saveApiKey: (key: string) => invoke<void>("save_api_key", { key }),
  clearApiKey: () => invoke<void>("clear_api_key"),
  testApi: () => invoke<string>("test_api"),
  chatDirect: (args: {
    conversation: Conversation;
    question: string;
    quote?: ReaderQuote | null;
    documentIds: UUID[];
    topicIds: UUID[];
    includeAnnotations: boolean;
  }) => invoke<{ answer: string; sources: unknown[]; generatedFiles: string[]; promptContent: string }>("chat_direct", args),
  summarizeConversation: (conversation: Conversation) =>
    invoke<string>("summarize_conversation", { conversation }),
  runAgent: (args: {
    backend: "claudeCode" | "codex";
    runId: UUID;
    conversationId: UUID;
    question: string;
    quote?: ReaderQuote | null;
    documentIds: UUID[];
    topicIds: UUID[];
    includeAnnotations: boolean;
    sessionId?: string | null;
  }) => invoke<AgentRunResult>("run_agent", args),
  stopAgent: (runId: UUID) => invoke<void>("stop_agent", { runId }),
  testAgent: (backend: "claudeCode" | "codex", runId: UUID) =>
    invoke<string>("test_agent", { backend, runId }),
  importPending: (paths: string[]) => invoke<{ data: KnowledgeData; documentIds: UUID[] }>("import_pending", { paths }),
  discardPending: (paths: string[]) => invoke<void>("discard_pending", { paths }),
  exportDocument: (documentId: UUID, destination: string, annotated: boolean) =>
    invoke<void>("export_document", { documentId, destination, annotated })
};

export function annotationsFor(data: KnowledgeData, documentId: UUID): KnowledgeAnnotation[] {
  return data.annotations.filter((annotation) => annotation.documentId === documentId);
}

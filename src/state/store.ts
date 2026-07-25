import { create } from "zustand";
import type {
  KnowledgeData, KnowledgeDocument, Topic, Conversation,
  ChatMessage, KnowledgeAnnotation, SummaryNote, ReaderQuote,
  AppSettings, ReaderSelection, DocumentOutlineEntry,
  ExtractedDocument, TopicRecommendation, ChatPlacement,
} from "../types/models";

interface KnowledgeStore {
  // Data
  data: KnowledgeData | null;
  loading: boolean;
  error: string | null;

  // Reader
  currentDocument: KnowledgeDocument | null;
  tabs: KnowledgeDocument[];
  readerSelection: ReaderSelection | null;
  focusedAnnotationId: string | null;
  outlineEntries: DocumentOutlineEntry[];
  extractedContent: ExtractedDocument | null;
  documentBytes: Uint8Array | null;

  // Chat
  conversation: Conversation;
  draft: string;
  quote: ReaderQuote | null;
  sending: boolean;
  chatError: string | null;
  traceEvents: any[];
  selectedDocumentIds: Set<string>;
  selectedTopicIds: Set<string>;
  includeCurrent: boolean;
  includeAnnotations: boolean;

  // Topics
  selectedTopicId: string | null;

  // Settings
  settings: AppSettings;
  libraryVisible: boolean;
  chatPlacement: ChatPlacement;
  showSettings: boolean;

  // Actions
  setData: (data: KnowledgeData) => void;
  loadData: () => Promise<void>;

  // Library
  importFiles: (paths: string[]) => Promise<string[]>;
  deleteDocument: (id: string) => Promise<void>;
  createTopic: (name: string, parentId?: string) => Promise<Topic | null>;
  renameTopic: (id: string, name: string) => Promise<void>;
  deleteTopic: (id: string) => Promise<void>;
  searchDocuments: (query: string, topicId?: string) => Promise<KnowledgeDocument[]>;

  // Reader
  openDocument: (doc: KnowledgeDocument) => void;
  closeDocument: (doc: KnowledgeDocument) => void;
  setReaderSelection: (sel: ReaderSelection | null) => void;
  loadDocumentContent: (docId: string) => Promise<void>;
  addAnnotation: (docId: string, sel: ReaderSelection, kind: string, note?: string) => Promise<KnowledgeAnnotation>;
  updateAnnotation: (id: string, note: string) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  toggleBookmark: (docId: string, pageIndex: number) => Promise<boolean>;

  // Chat
  sendMessage: () => Promise<void>;
  newChat: () => void;
  setDraft: (text: string) => void;
  setQuote: (quote: ReaderQuote | null) => void;
  toggleDocumentSelection: (id: string) => void;
  toggleTopicSelection: (id: string) => void;
  loadConversation: (conv: Conversation) => void;
}

// Helper: compute display title
function displayTitle(doc: KnowledgeDocument): string {
  return doc.display_name?.trim() || doc.name;
}

export const useStore = create<KnowledgeStore>((set, get) => ({
  // Initial state
  data: null,
  loading: true,
  error: null,
  currentDocument: null,
  tabs: [],
  readerSelection: null,
  focusedAnnotationId: null,
  outlineEntries: [],
  extractedContent: null,
  documentBytes: null,
  conversation: {
    id: crypto.randomUUID(),
    title: "新对话",
    document_ids: [],
    topic_ids: [],
    include_current_page: false,
    include_annotations: true,
    current_document_id: null,
    messages: [],
    summary: "",
    summary_message_count: 0,
    agent_sessions: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  draft: "",
  quote: null,
  sending: false,
  chatError: null,
  traceEvents: [],
  selectedDocumentIds: new Set<string>(),
  selectedTopicIds: new Set<string>(),
  includeCurrent: false,
  includeAnnotations: true,
  selectedTopicId: null,
  settings: {
    provider: "deepseek",
    base_url: "https://api.deepseek.com",
    model: "deepseek-chat",
    chat_backend: "direct",
    chat_placement: "right",
    library_visible: true,
    api_context_mode: "relevant_fragments",
    vision_enabled: false,
  },
  libraryVisible: true,
  chatPlacement: "right",
  showSettings: false,

  setData: (data) => set({ data, loading: false }),

  loadData: async () => {
    try {
      set({ loading: true });
      const { invoke } = await import("@tauri-apps/api/core");
      const data = await invoke<KnowledgeData>("load_full_state");
      set({ data, loading: false });
    } catch (e: any) {
      set({ error: e.toString(), loading: false });
    }
  },

  importFiles: async (paths) => {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<string[]>("import_files", { paths });
    await get().loadData();
    return result;
  },

  deleteDocument: async (id) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_document", { id });
    await get().loadData();
  },

  createTopic: async (name, parentId) => {
    const { invoke } = await import("@tauri-apps/api/core");
    const topic = await invoke<Topic | null>("create_topic", { name, parentId });
    await get().loadData();
    return topic;
  },

  renameTopic: async (id, name) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("rename_topic", { id, name });
    await get().loadData();
  },

  deleteTopic: async (id) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_topic", { id });
    set((s) => ({
      selectedTopicId: s.selectedTopicId === id ? null : s.selectedTopicId,
    }));
    await get().loadData();
  },

  searchDocuments: async (query, topicId) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<KnowledgeDocument[]>("search", { query, topicId });
  },

  openDocument: (doc) => {
    set((s) => {
      const tabs = s.tabs.some((t) => t.id === doc.id)
        ? s.tabs
        : [...s.tabs, doc];
      return {
        currentDocument: doc,
        tabs,
        focusedAnnotationId: null,
        outlineEntries: [],
        extractedContent: null,
        documentBytes: null,
      };
    });
    get().loadDocumentContent(doc.id);
  },

  closeDocument: (doc) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === doc.id);
      const tabs = s.tabs.filter((t) => t.id !== doc.id);
      const current = s.currentDocument?.id === doc.id
        ? (tabs[Math.min(idx, tabs.length - 1)] || null)
        : s.currentDocument;
      return { tabs, currentDocument: current };
    });
  },

  setReaderSelection: (sel) => set({ readerSelection: sel }),

  loadDocumentContent: async (docId) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [extracted, outline, bytes] = await Promise.all([
        invoke<ExtractedDocument>("get_extracted_content", { documentId: docId }),
        invoke<DocumentOutlineEntry[]>("get_document_outline", { documentId: docId }),
        invoke<number[]>("read_document_bytes", { documentId: docId }),
      ]);
      set({
        extractedContent: extracted,
        outlineEntries: outline,
        documentBytes: new Uint8Array(bytes),
      });
    } catch (e: any) {
      console.error("Failed to load document:", e);
    }
  },

  addAnnotation: async (docId, sel, kind, note = "") => {
    const { invoke } = await import("@tauri-apps/api/core");
    const ann = await invoke<KnowledgeAnnotation>("add_annotation", {
      documentId: docId, selection: sel, kind, note,
    });
    await get().loadData();
    return ann;
  },

  updateAnnotation: async (id, note) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("update_annotation", { id, note });
    await get().loadData();
  },

  deleteAnnotation: async (id) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_annotation", { id });
    await get().loadData();
  },

  toggleBookmark: async (docId, pageIndex) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("toggle_bookmark", { documentId: docId, pageIndex });
  },

  sendMessage: async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { draft, quote, selectedDocumentIds, selectedTopicIds, includeCurrent, includeAnnotations, conversation, currentDocument, settings } = get();
    if (!draft.trim() || get().sending) return;

    set({ sending: true, chatError: null, draft: "" });

    try {
      const result = await invoke<ChatMessage>("send_chat_message", {
        question: draft.trim(),
        quote: quote || null,
        documentIds: Array.from(selectedDocumentIds),
        topicIds: Array.from(selectedTopicIds),
        includeCurrent,
        includeAnnotations,
        conversationId: conversation.id,
        backend: settings.chat_backend,
        model: settings.model,
        baseUrl: settings.base_url,
        apiContextMode: settings.api_context_mode,
        visionEnabled: settings.vision_enabled,
      });

      set((s) => ({
        conversation: {
          ...s.conversation,
          messages: [...s.conversation.messages, result],
          updated_at: new Date().toISOString(),
        },
        sending: false,
        quote: null,
      }));

      await get().loadData();
    } catch (e: any) {
      set({ chatError: e.toString(), sending: false });
    }
  },

  newChat: () => set({
    conversation: {
      id: crypto.randomUUID(),
      title: "新对话",
      document_ids: [],
      topic_ids: [],
      include_current_page: false,
      include_annotations: true,
      current_document_id: null,
      messages: [],
      summary: "",
      summary_message_count: 0,
      agent_sessions: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    selectedDocumentIds: new Set(),
    selectedTopicIds: new Set(),
    draft: "",
    quote: null,
    chatError: null,
    traceEvents: [],
    includeCurrent: false,
  }),

  setDraft: (text) => set({ draft: text }),
  setQuote: (quote) => set({ quote }),

  toggleDocumentSelection: (id) => set((s) => {
    const next = new Set(s.selectedDocumentIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { selectedDocumentIds: next };
  }),

  toggleTopicSelection: (id) => set((s) => {
    const next = new Set(s.selectedTopicIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { selectedTopicIds: next };
  }),

  loadConversation: (conv) => set({
    conversation: conv,
    selectedDocumentIds: new Set(conv.document_ids),
    selectedTopicIds: new Set(conv.topic_ids),
    includeCurrent: conv.include_current_page,
    includeAnnotations: conv.include_annotations,
  }),
}));

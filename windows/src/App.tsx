import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  Archive,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Bot,
  ChevronRight,
  CircleAlert,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  Globe2,
  Highlighter,
  Library,
  Link2,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Underline,
  X
} from "lucide-react";
import type {
  AppSettings,
  ChatMessage,
  Conversation,
  KnowledgeAnnotation,
  KnowledgeData,
  KnowledgeDocument,
  SummaryNote,
  Topic
} from "./types";
import {
  buildContext,
  displayTitle,
  emptyKnowledgeData,
  filterDocuments,
  topicDepth
} from "./lib/core";
import "./styles.css";

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function Markdown({ value, className = "" }: { value: string; className?: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(value, { async: false }) as string),
    [value]
  );
  return <div className={`markdown ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function IconButton({
  title,
  onClick,
  children,
  active = false,
  disabled = false
}: {
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function SettingsDialog({
  value,
  onClose,
  onSave,
  onChooseLibrary
}: {
  value: AppSettings;
  onClose: () => void;
  onSave: (patch: Partial<AppSettings> & { apiKey?: string }) => Promise<void>;
  onChooseLibrary: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [apiKey, setAPIKey] = useState("");
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof AppSettings>(key: K, next: AppSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: next }));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">WINDOWS PREFERENCES</span>
            <h2>设置</h2>
          </div>
          <IconButton title="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>
        <div className="settings-grid">
          <label>
            <span>接入方式</span>
            <select
              value={draft.chatBackend}
              onChange={(event) => update("chatBackend", event.target.value as AppSettings["chatBackend"])}
            >
              <option value="direct">直接 API</option>
              <option value="claudeCode">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </label>
          <label>
            <span>服务商</span>
            <select
              value={draft.provider}
              onChange={(event) => {
                const provider = event.target.value;
                setDraft((current) => ({
                  ...current,
                  provider,
                  ...(provider === "deepseek"
                    ? { baseURL: "https://api.deepseek.com", model: "deepseek-chat" }
                    : provider === "glm"
                      ? { baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" }
                      : {})
                }));
              }}
            >
              <option value="deepseek">DeepSeek</option>
              <option value="glm">智谱 GLM</option>
              <option value="custom">OpenAI 兼容接口</option>
            </select>
          </label>
          <label className="wide">
            <span>Base URL</span>
            <input value={draft.baseURL} onChange={(event) => update("baseURL", event.target.value)} />
          </label>
          <label>
            <span>模型</span>
            <input value={draft.model} onChange={(event) => update("model", event.target.value)} />
          </label>
          <label>
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              placeholder={draft.hasAPIKey ? "已由 Windows DPAPI 安全保存" : "输入 API Key"}
              onChange={(event) => setAPIKey(event.target.value)}
            />
          </label>
          <label>
            <span>聊天位置</span>
            <select
              value={draft.chatPlacement}
              onChange={(event) => update("chatPlacement", event.target.value as AppSettings["chatPlacement"])}
            >
              <option value="right">右侧</option>
              <option value="bottom">底部</option>
              <option value="hidden">隐藏</option>
            </select>
          </label>
          <label>
            <span>API 上下文</span>
            <select
              value={draft.apiContextMode}
              onChange={(event) =>
                update("apiContextMode", event.target.value as AppSettings["apiContextMode"])
              }
            >
              <option value="relevantFragments">相关片段</option>
              <option value="autonomous">自主工具</option>
            </select>
          </label>
          <div className="library-location wide">
            <span>资料库位置</span>
            <code>{draft.libraryRoot}</code>
            <button className="secondary" onClick={onChooseLibrary}><FolderInput size={16} /> 更改位置</button>
          </div>
        </div>
        <footer>
          <button className="secondary" onClick={onClose}>取消</button>
          <button
            className="primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                const { libraryRoot: _root, hasAPIKey: _flag, ...patch } = draft;
                await onSave({ ...patch, ...(apiKey ? { apiKey } : {}) });
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <LoaderCircle className="spin" size={16} />} 保存设置
          </button>
        </footer>
      </section>
    </div>
  );
}

function Reader({
  document,
  content,
  fileUrl,
  bookmarkPage,
  annotations,
  onSelection,
  onBookmark,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onExport,
  onOpenExternal
}: {
  document: KnowledgeDocument;
  content: string;
  fileUrl: string;
  bookmarkPage: number | null;
  annotations: KnowledgeAnnotation[];
  onSelection: (text: string) => void;
  onBookmark: (page: number) => void;
  onAddAnnotation: (kind: "highlight" | "underline" | "note", quote: string) => void;
  onUpdateAnnotation: (id: string, note: string) => void;
  onDeleteAnnotation: (id: string) => void;
  onExport: () => void;
  onOpenExternal: () => void;
}) {
  const [page, setPage] = useState((bookmarkPage ?? 0) + 1);
  const [selection, setSelection] = useState("");
  const extension = document.extension.toLocaleLowerCase();

  useEffect(() => {
    setPage((bookmarkPage ?? 0) + 1);
    setSelection("");
  }, [document.id, bookmarkPage]);

  const captureSelection = () => {
    const value = window.getSelection()?.toString().trim() ?? "";
    if (value) {
      setSelection(value);
      onSelection(value);
    }
  };

  return (
    <div className="reader">
      <div className="reader-toolbar">
        <div className="document-heading">
          <span className={`file-badge ${extension}`}>{extension.toUpperCase()}</span>
          <div>
            <strong>{displayTitle(document)}</strong>
            <small>{(document.size / 1024 / 1024).toFixed(2)} MB</small>
          </div>
        </div>
        <div className="toolbar-actions">
          {extension === "pdf" && (
            <label className="page-control">
              第
              <input
                type="number"
                min={1}
                max={document.pageCount ?? undefined}
                value={page}
                onChange={(event) => setPage(Math.max(1, Number(event.target.value)))}
              />
              页
            </label>
          )}
          <IconButton title="保存阅读书签" onClick={() => onBookmark(page - 1)}>
            {bookmarkPage === page - 1 ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
          </IconButton>
          <IconButton title="使用系统应用打开" onClick={onOpenExternal}><ExternalLink size={18} /></IconButton>
          <IconButton title="导出原始文件" onClick={onExport}><Download size={18} /></IconButton>
        </div>
      </div>

      <div className="reader-content">
        <div className="document-surface" onMouseUp={captureSelection}>
          {extension === "pdf" ? (
            <embed key={`${fileUrl}-${page}`} src={`${fileUrl}#page=${page}&view=FitH`} type="application/pdf" />
          ) : extension === "md" || extension === "markdown" ? (
            <Markdown value={content || "该文档暂无可显示内容。"} className="paper-markdown" />
          ) : (
            <pre className="rich-text">{content || "暂未提取到文本。可使用右上角按钮通过系统应用打开。"}</pre>
          )}
          {selection && extension !== "pdf" && (
            <div className="selection-bar">
              <span>已选择 {selection.length} 字</span>
              <button onClick={() => onAddAnnotation("highlight", selection)}><Highlighter size={15} /> 高亮</button>
              <button onClick={() => onAddAnnotation("underline", selection)}><Underline size={15} /> 下划线</button>
              <button onClick={() => onAddAnnotation("note", selection)}><NotebookPen size={15} /> 批注</button>
              <button onClick={() => setSelection("")}><X size={14} /></button>
            </div>
          )}
        </div>
        <aside className="annotation-rail">
          <header>
            <span>批注</span>
            <small>{annotations.length}</small>
          </header>
          {annotations.length === 0 ? (
            <div className="empty-mini">选中文字即可高亮、划线或添加笔记。PDF 可复制原文后在聊天区提问。</div>
          ) : (
            annotations.map((annotation) => (
              <article className={`annotation ${annotation.kind}`} key={annotation.id}>
                <div className="annotation-kind">
                  {annotation.kind === "highlight" ? <Highlighter size={14} /> : annotation.kind === "underline" ? <Underline size={14} /> : <NotebookPen size={14} />}
                  <span>{annotation.kind === "highlight" ? "高亮" : annotation.kind === "underline" ? "下划线" : "批注"}</span>
                  <button onClick={() => onDeleteAnnotation(annotation.id)}><Trash2 size={13} /></button>
                </div>
                <blockquote>{annotation.quote}</blockquote>
                <textarea
                  placeholder="补充你的理解…"
                  value={annotation.note}
                  onChange={(event) => onUpdateAnnotation(annotation.id, event.target.value)}
                />
              </article>
            ))
          )}
        </aside>
      </div>
    </div>
  );
}

function NotesPanel({
  notes,
  selectedId,
  onSelect,
  onCreate,
  onSave,
  onDelete
}: {
  notes: SummaryNote[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onSave: (note: SummaryNote) => void;
  onDelete: (id: string) => void;
}) {
  const selected = notes.find((note) => note.id === selectedId) ?? null;
  const [editing, setEditing] = useState(true);

  return (
    <div className="notes-panel">
      <aside>
        <header>
          <strong>研究笔记</strong>
          <IconButton title="新建笔记" onClick={onCreate}><Plus size={16} /></IconButton>
        </header>
        {notes.map((note) => (
          <button
            key={note.id}
            className={note.id === selectedId ? "active" : ""}
            onClick={() => onSelect(note.id)}
          >
            <NotebookPen size={15} />
            <span>{note.title}</span>
          </button>
        ))}
      </aside>
      <section>
        {selected ? (
          <>
            <div className="notes-toolbar">
              <input
                value={selected.title}
                onChange={(event) => onSave({ ...selected, title: event.target.value, updatedAt: now() })}
              />
              <button className="segmented" onClick={() => setEditing((value) => !value)}>
                {editing ? "预览" : "编辑"}
              </button>
              <IconButton title="删除笔记" onClick={() => onDelete(selected.id)}><Trash2 size={16} /></IconButton>
            </div>
            {editing ? (
              <textarea
                className="note-editor"
                value={selected.content}
                placeholder="# 写下你的研究判断"
                onChange={(event) => onSave({ ...selected, content: event.target.value, updatedAt: now() })}
              />
            ) : (
              <Markdown value={selected.content} className="note-preview" />
            )}
          </>
        ) : (
          <div className="empty-state"><NotebookPen size={34} /><h3>沉淀研究笔记</h3><p>用 Markdown 组织跨论文的理解与判断。</p></div>
        )}
      </section>
    </div>
  );
}

function ChatPanel({
  settings,
  data,
  activeDocument,
  texts,
  quote,
  onData
}: {
  settings: AppSettings;
  data: KnowledgeData;
  activeDocument: KnowledgeDocument | null;
  texts: Record<string, string>;
  quote: string;
  onData: (next: KnowledgeData) => Promise<void>;
}) {
  const existing = data.conversations[0] ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>(existing?.messages ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, busy]);
  useEffect(() => setMessages(data.conversations[0]?.messages ?? []), [data.conversations]);

  const send = async () => {
    const question = input.trim();
    if (!question || busy) return;
    setBusy(true);
    setInput("");
    const selectedDocuments = activeDocument ? [activeDocument] : data.documents;
    const sources = buildContext(question, selectedDocuments, texts, 10);
    const user: ChatMessage = {
      id: uuid(),
      role: "user",
      content: question,
      promptContent: question,
      quote: quote && activeDocument
        ? { text: quote, documentId: activeDocument.id, documentName: displayTitle(activeDocument), page: null }
        : null,
      sources,
      backend: settings.chatBackend,
      createdAt: now()
    };
    const nextMessages = [...messages, user];
    setMessages(nextMessages);
    try {
      let answer: string;
      let traceEvents = undefined;
      let generatedFiles = undefined;
      if (settings.chatBackend === "direct") {
        const context = sources.length
          ? `\n\n以下是本地资料片段：\n${sources.map((source) => `【${source.label}】\n${source.text}`).join("\n\n")}`
          : "";
        const quotation = quote ? `\n\n用户当前选中的原文：\n${quote}` : "";
        answer = await window.km.complete([
          { role: "system", content: "你是科研阅读助手。仅根据用户提供的资料严谨回答；不确定时明确说明。" },
          ...nextMessages.slice(-12).map((message) => ({
            role: message.role,
            content: message.role === "user" && message.id === user.id
              ? `${message.content}${quotation}${context}`
              : message.content
          }))
        ]);
      } else {
        const result = await window.km.runAgent(
          settings.chatBackend,
          `${question}${quote ? `\n\n当前选区：\n${quote}` : ""}`,
          selectedDocuments.map((document) => document.id)
        );
        answer = result.answer;
        traceEvents = result.traceEvents;
        generatedFiles = result.generatedFiles;
      }
      const assistant: ChatMessage = {
        id: uuid(),
        role: "assistant",
        content: answer,
        backend: settings.chatBackend,
        sources,
        traceEvents,
        generatedFiles,
        createdAt: now()
      };
      const completed = [...nextMessages, assistant];
      setMessages(completed);
      const timestamp = now();
      const conversation: Conversation = existing
        ? { ...existing, messages: completed, updatedAt: timestamp }
        : {
            id: uuid(),
            title: question.slice(0, 32),
            documentIds: activeDocument ? [activeDocument.id] : [],
            topicIds: [],
            includeCurrentPage: false,
            includeAnnotations: true,
            currentDocumentId: activeDocument?.id ?? null,
            messages: completed,
            summary: "",
            summaryMessageCount: 0,
            agentSessions: {},
            createdAt: timestamp,
            updatedAt: timestamp
          };
      await onData({
        ...data,
        conversations: [conversation, ...data.conversations.filter((item) => item.id !== conversation.id)]
      });
    } catch (error) {
      const failed: ChatMessage = {
        id: uuid(),
        role: "assistant",
        content: `请求失败：${error instanceof Error ? error.message : String(error)}`,
        backend: settings.chatBackend,
        createdAt: now()
      };
      setMessages([...nextMessages, failed]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="chat-panel">
      <header>
        <div><Sparkles size={17} /><strong>研究助手</strong></div>
        <span className="backend-pill">{settings.chatBackend === "direct" ? settings.model : settings.chatBackend}</span>
      </header>
      <div className="messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="spark-orb"><Sparkles size={24} /></div>
            <h3>从资料出发，继续追问</h3>
            <p>选择原文、当前论文或整个主题，让 AI 帮你比较方法、提炼证据与识别局限。</p>
            {["总结这篇论文的核心贡献", "对比方法与已有工作的差异", "列出实验设计的潜在局限"].map((prompt) => (
              <button key={prompt} onClick={() => setInput(prompt)}>{prompt}<ChevronRight size={14} /></button>
            ))}
          </div>
        )}
        {messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <div className="avatar">{message.role === "user" ? "你" : <Bot size={16} />}</div>
            <div>
              {message.quote && <blockquote>{message.quote.text}</blockquote>}
              <Markdown value={message.content} />
              {!!message.sources?.length && message.role === "assistant" && (
                <details><summary>{message.sources.length} 个资料片段</summary>
                  {message.sources.map((source) => <p key={source.id}><strong>{source.label}</strong><br />{source.text.slice(0, 180)}…</p>)}
                </details>
              )}
              {!!message.generatedFiles?.length && (
                <div className="generated-files">{message.generatedFiles.map((file) => <code key={file}>{file}</code>)}</div>
              )}
            </div>
          </article>
        ))}
        {busy && <div className="thinking"><LoaderCircle className="spin" size={16} /> 正在阅读与组织答案…</div>}
        <div ref={endRef} />
      </div>
      {quote && <div className="quote-chip"><Highlighter size={14} /><span>{quote.slice(0, 84)}{quote.length > 84 ? "…" : ""}</span></div>}
      <div className="composer">
        <textarea
          value={input}
          placeholder="询问当前论文或选中的原文…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button className="send" disabled={busy || !input.trim()} onClick={() => void send()}><Send size={17} /></button>
      </div>
    </aside>
  );
}

export default function App() {
  const [data, setData] = useState<KnowledgeData>(emptyKnowledgeData());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [documentCache, setDocumentCache] = useState<Record<string, { text: string; fileUrl: string }>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [readerQuote, setReaderQuote] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    window.km.bootstrap()
      .then((bootstrap) => {
        setData(bootstrap.data);
        setSettings(bootstrap.settings);
      })
      .catch((value) => setError(String(value)))
      .finally(() => setLoading(false));
  }, []);

  const persist = async (next: KnowledgeData) => {
    setData(next);
    await window.km.saveData(next);
  };

  const importPaths = async (paths: string[]) => {
    if (!paths.length) return;
    setNotice("正在导入并建立全文索引…");
    try {
      const result = await window.km.importPaths(paths);
      setData(result.data);
      setNotice(
        result.importedIds.length
          ? `已导入 ${result.importedIds.length} 份资料${result.messages.length ? `；${result.messages[0]}` : ""}`
          : result.messages.join("；") || "没有可导入的文件"
      );
      if (result.importedIds[0]) void openDocument(result.importedIds[0], result.data);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      setNotice("");
    }
  };

  const openDocument = async (id: string, sourceData = data) => {
    const document = sourceData.documents.find((item) => item.id === id);
    if (!document?.storedPath) return;
    setTabs((values) => (values.includes(id) ? values : [...values, id]));
    setActiveId(id);
    setReaderQuote("");
    if (!documentCache[id]) {
      try {
        const loaded = await window.km.readDocument(document.storedPath);
        setDocumentCache((values) => ({ ...values, [id]: loaded }));
      } catch (value) {
        setError(value instanceof Error ? value.message : String(value));
      }
    }
  };

  const activeDocument = data.documents.find((item) => item.id === activeId) ?? null;
  const currentCache = activeId ? documentCache[activeId] : undefined;
  const visibleDocuments = useMemo(
    () =>
      filterDocuments(
        data,
        query,
        topicId,
        Object.fromEntries(Object.entries(documentCache).map(([id, value]) => [id, value.text]))
      ),
    [data, query, topicId, documentCache]
  );
  const sortedTopics = useMemo(
    () =>
      [...data.topics].sort(
        (a, b) => topicDepth(data.topics, a) - topicDepth(data.topics, b) || a.name.localeCompare(b.name, "zh-CN")
      ),
    [data.topics]
  );

  if (loading || !settings) {
    return <div className="splash"><div className="logo-mark"><Library size={28} /></div><h1>知屿</h1><LoaderCircle className="spin" /></div>;
  }

  const updateTopic = async (action: "create" | "rename" | "delete") => {
    if (action === "create") {
      const name = window.prompt("主题名称");
      if (!name?.trim()) return;
      await persist({
        ...data,
        topics: [...data.topics, { id: uuid(), name: name.trim(), parentId: topicId, createdAt: now() }]
      });
    } else if (topicId) {
      const topic = data.topics.find((item) => item.id === topicId);
      if (!topic) return;
      if (action === "rename") {
        const name = window.prompt("新的主题名称", topic.name);
        if (!name?.trim()) return;
        await persist({
          ...data,
          topics: data.topics.map((item) => item.id === topicId ? { ...item, name: name.trim() } : item)
        });
      } else if (window.confirm(`删除主题“${topic.name}”？原始资料不会被删除。`)) {
        const descendants = new Set<string>([topicId]);
        let changed = true;
        while (changed) {
          changed = false;
          data.topics.forEach((item) => {
            if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) {
              descendants.add(item.id);
              changed = true;
            }
          });
        }
        setTopicId(null);
        await persist({
          ...data,
          topics: data.topics.filter((item) => !descendants.has(item.id)),
          documentTopics: data.documentTopics.filter((link) => !descendants.has(link.topicId))
        });
      }
    }
  };

  const linkActiveToTopic = async () => {
    if (!activeId || !topicId) return;
    if (data.documentTopics.some((link) => link.documentId === activeId && link.topicId === topicId)) {
      setNotice("该资料已经属于当前主题");
      return;
    }
    await persist({
      ...data,
      documentTopics: [...data.documentTopics, { documentId: activeId, topicId, createdAt: now() }]
    });
    setNotice("已归入当前主题");
  };

  const addAnnotation = async (kind: "highlight" | "underline" | "note", quote: string) => {
    if (!activeId) return;
    const annotation: KnowledgeAnnotation = {
      id: uuid(),
      documentId: activeId,
      page: null,
      quote,
      kind,
      note: "",
      rects: [],
      createdAt: now(),
      updatedAt: now()
    };
    await persist({ ...data, annotations: [...data.annotations, annotation] });
  };

  const createNote = async () => {
    const note: SummaryNote = {
      id: uuid(),
      title: "未命名笔记",
      content: "",
      storedPath: null,
      annotationIDs: [],
      createdAt: now(),
      updatedAt: now()
    };
    setSelectedNoteId(note.id);
    await persist({ ...data, summaryNotes: [note, ...data.summaryNotes] });
  };

  return (
    <main
      className={`app-shell chat-${settings.chatPlacement}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => window.km.pathForFile(file))
          .filter(Boolean);
        void importPaths(paths);
      }}
    >
      <div className="titlebar">
        <div className="brand"><div className="brand-mark">知</div><span>知屿</span><small>KnowledgeMaster</small></div>
        <div className="titlebar-center">{activeDocument ? displayTitle(activeDocument) : "本地科研知识工作台"}</div>
      </div>

      <header className="app-toolbar">
        <IconButton
          title={settings.libraryVisible ? "收起资料库" : "展开资料库"}
          onClick={async () => {
            const next = !settings.libraryVisible;
            setSettings({ ...settings, libraryVisible: next });
            await window.km.updateSettings({ libraryVisible: next });
          }}
        >
          {settings.libraryVisible ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
        </IconButton>
        <div className="toolbar-divider" />
        <button className="toolbar-button" onClick={async () => importPaths(await window.km.chooseFiles())}>
          <FilePlus2 size={17} /> 导入文件
        </button>
        <button className="toolbar-button" onClick={async () => {
          const folder = await window.km.chooseFolder();
          if (folder) void importPaths([folder]);
        }}>
          <FolderInput size={17} /> 导入目录
        </button>
        <button className="toolbar-button" onClick={async () => {
          const url = window.prompt("输入要保存的网页地址");
          if (!url) return;
          setNotice("正在保存网页…");
          try {
            const result = await window.km.importUrl(url);
            setData(result.data);
            setNotice(result.importedIds.length ? "网页已保存到资料库" : result.messages.join("；"));
          } catch (value) {
            setError(value instanceof Error ? value.message : String(value));
          }
        }}>
          <Globe2 size={17} /> 保存网页
        </button>
        <div className="toolbar-spacer" />
        {topicId && activeId && (
          <button className="toolbar-button subtle" onClick={() => void linkActiveToTopic()}>
            <Link2 size={16} /> 归入当前主题
          </button>
        )}
        <IconButton title="研究笔记" active={notesOpen} onClick={() => setNotesOpen((value) => !value)}>
          <NotebookPen size={19} />
        </IconButton>
        <IconButton title="设置" onClick={() => setSettingsOpen(true)}><Settings size={19} /></IconButton>
      </header>

      <div className={`workspace ${settings.libraryVisible ? "" : "library-hidden"}`}>
        {settings.libraryVisible && (
          <aside className="library-panel">
            <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名与正文…" />{query && <button onClick={() => setQuery("")}><X size={13} /></button>}</div>
            <section className="topic-section">
              <header><span>资料视图</span><div>
                <IconButton title="新建子主题" onClick={() => void updateTopic("create")}><Plus size={14} /></IconButton>
                {topicId && <IconButton title="更多主题操作" onClick={() => {
                  const action = window.prompt("输入 rename 重命名，或 delete 删除");
                  if (action === "rename" || action === "delete") void updateTopic(action);
                }}><MoreHorizontal size={15} /></IconButton>}
              </div></header>
              <button className={!topicId ? "topic active" : "topic"} onClick={() => setTopicId(null)}>
                <Archive size={16} /><span>全部资料</span><small>{data.documents.length}</small>
              </button>
              {sortedTopics.map((topic) => (
                <button
                  className={topic.id === topicId ? "topic active" : "topic"}
                  key={topic.id}
                  style={{ paddingLeft: 12 + topicDepth(data.topics, topic) * 18 }}
                  onClick={() => setTopicId(topic.id)}
                >
                  <Folder size={15} /><span>{topic.name}</span>
                  <small>{data.documentTopics.filter((link) => link.topicId === topic.id).length}</small>
                </button>
              ))}
            </section>
            <section className="document-list">
              <header><span>{topicId ? data.topics.find((item) => item.id === topicId)?.name : "所有文档"}</span><small>{visibleDocuments.length}</small></header>
              {visibleDocuments.map((document) => (
                <button className={document.id === activeId ? "document active" : "document"} key={document.id} onClick={() => void openDocument(document.id)}>
                  <span className={`file-icon ${document.extension}`}><FileText size={17} /></span>
                  <span><strong>{displayTitle(document)}</strong><small>{document.extension.toUpperCase()} · {(document.size / 1024).toFixed(0)} KB</small></span>
                </button>
              ))}
              {visibleDocuments.length === 0 && <div className="empty-mini">拖入 PDF、DOCX、HTML、Markdown 或 TXT 开始建立资料库。</div>}
            </section>
            <footer><span className="status-dot" /> 本地资料库 <small>{settings.libraryRoot}</small></footer>
          </aside>
        )}

        <section className="main-stage">
          {!!tabs.length && (
            <nav className="tabs">
              {tabs.map((id) => {
                const document = data.documents.find((item) => item.id === id);
                if (!document) return null;
                return (
                  <button key={id} className={id === activeId ? "active" : ""} onClick={() => setActiveId(id)}>
                    <FileText size={14} /><span>{displayTitle(document)}</span>
                    <X size={13} onClick={(event) => {
                      event.stopPropagation();
                      const next = tabs.filter((value) => value !== id);
                      setTabs(next);
                      if (activeId === id) setActiveId(next.at(-1) ?? null);
                    }} />
                  </button>
                );
              })}
            </nav>
          )}
          {notesOpen ? (
            <NotesPanel
              notes={data.summaryNotes}
              selectedId={selectedNoteId}
              onSelect={setSelectedNoteId}
              onCreate={() => void createNote()}
              onSave={(note) => {
                const next = { ...data, summaryNotes: data.summaryNotes.map((item) => item.id === note.id ? note : item) };
                setData(next);
                window.km.writeNote(note.storedPath ?? null, note.title, note.content).then((storedPath) => {
                  const persisted = {
                    ...next,
                    summaryNotes: next.summaryNotes.map((item) => item.id === note.id ? { ...item, storedPath } : item)
                  };
                  void persist(persisted);
                }).catch((value) => setError(String(value)));
              }}
              onDelete={(id) => {
                if (!window.confirm("删除这条笔记？")) return;
                setSelectedNoteId(null);
                void persist({ ...data, summaryNotes: data.summaryNotes.filter((note) => note.id !== id) });
              }}
            />
          ) : activeDocument && currentCache ? (
            <Reader
              document={activeDocument}
              content={currentCache.text}
              fileUrl={currentCache.fileUrl}
              bookmarkPage={data.bookmarks.find((item) => item.documentId === activeDocument.id)?.pageIndex ?? null}
              annotations={data.annotations.filter((item) => item.documentId === activeDocument.id)}
              onSelection={setReaderQuote}
              onBookmark={(pageIndex) => {
                const bookmark = { documentId: activeDocument.id, pageIndex, updatedAt: now() };
                void persist({
                  ...data,
                  bookmarks: [bookmark, ...data.bookmarks.filter((item) => item.documentId !== activeDocument.id)]
                });
              }}
              onAddAnnotation={(kind, quote) => void addAnnotation(kind, quote)}
              onUpdateAnnotation={(id, note) => {
                const next = {
                  ...data,
                  annotations: data.annotations.map((item) => item.id === id ? { ...item, note, updatedAt: now() } : item)
                };
                setData(next);
                void window.km.saveData(next);
              }}
              onDeleteAnnotation={(id) => void persist({ ...data, annotations: data.annotations.filter((item) => item.id !== id) })}
              onExport={() => void window.km.exportDocument(activeDocument.id, false)}
              onOpenExternal={() => activeDocument.storedPath && void window.km.openExternal(activeDocument.storedPath)}
            />
          ) : activeDocument ? (
            <div className="empty-state"><LoaderCircle className="spin" /><h3>正在准备文档…</h3></div>
          ) : (
            <div className="welcome">
              <div className="welcome-art"><div className="ring one" /><div className="ring two" /><BookOpen size={48} /></div>
              <span className="eyebrow">KNOWLEDGE, MADE YOURS</span>
              <h1>把论文读深，也把理解留下</h1>
              <p>导入研究资料，建立主题脉络，在阅读、批注、笔记与 AI 对话之间保持连续。</p>
              <div className="welcome-actions">
                <button className="primary" onClick={async () => importPaths(await window.km.chooseFiles())}><FilePlus2 size={17} /> 导入第一份资料</button>
                <button className="secondary" onClick={() => void updateTopic("create")}><Folder size={17} /> 创建研究主题</button>
              </div>
              <div className="feature-row">
                <div><Highlighter /><strong>精读批注</strong><span>选区、高亮与研究笔记</span></div>
                <div><Sparkles /><strong>跨文献问答</strong><span>相关片段与本地 Agent</span></div>
                <div><Archive /><strong>本地优先</strong><span>兼容原有资料库结构</span></div>
              </div>
            </div>
          )}
        </section>

        {settings.chatPlacement !== "hidden" && (
          <ChatPanel
            settings={settings}
            data={data}
            activeDocument={activeDocument}
            texts={Object.fromEntries(Object.entries(documentCache).map(([id, value]) => [id, value.text]))}
            quote={readerQuote}
            onData={persist}
          />
        )}
      </div>

      {dragging && <div className="drop-overlay"><div><FolderInput size={38} /><h2>释放以导入资料</h2><p>支持递归目录与常用论文格式</p></div></div>}
      {notice && <div className="toast" onClick={() => setNotice("")}><span className="status-dot" />{notice}<X size={14} /></div>}
      {error && <div className="toast error" onClick={() => setError("")}><CircleAlert size={17} />{error}<X size={14} /></div>}
      {settingsOpen && (
        <SettingsDialog
          value={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={async (patch) => setSettings(await window.km.updateSettings(patch))}
          onChooseLibrary={async () => {
            const next = await window.km.chooseLibrary();
            if (!next) return;
            const migrate = window.confirm("是否将当前资料库复制到新位置？选择“取消”将直接打开新位置已有的资料库。");
            const bootstrap = await window.km.switchLibrary(next, migrate);
            setData(bootstrap.data);
            setSettings(bootstrap.settings);
            setTabs([]);
            setActiveId(null);
            setDocumentCache({});
          }}
        />
      )}
    </main>
  );
}

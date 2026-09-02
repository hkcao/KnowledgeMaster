import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileSearch,
  FileText,
  History,
  LayoutPanelLeft,
  MessageSquare,
  PanelBottom,
  PanelRight,
  Plus,
  Send,
  Sparkles,
  Square,
  TerminalSquare,
  Wrench,
  X
} from "lucide-react";
import { api } from "../api";
import type {
  AgentTraceEvent,
  AppSettings,
  ChatMessage,
  ChatPlacement,
  ContextChunk,
  Conversation,
  KnowledgeData,
  KnowledgeDocument,
  ReaderQuote,
  Topic,
  TopicRecommendation,
  UUID
} from "../types";
import {
  agentScopeSignature,
  displayTitle,
  newConversation,
  pendingSummaryMessages,
  resolveDocumentIDs,
  shouldSendOnReturn,
  visibleMessage
} from "../utils";
import MarkdownView from "./MarkdownView";

interface Props {
  data: KnowledgeData;
  settings: AppSettings;
  agentAvailability: Record<"claudeCode" | "codex", string | null>;
  currentDocument?: KnowledgeDocument | null;
  quote?: ReaderQuote | null;
  onQuote: (quote: ReaderQuote | null) => void;
  onData: (data: KnowledgeData) => void;
  onSettings: (settings: AppSettings) => void;
}

export default function ChatPanel(props: Props) {
  const { data, settings, agentAvailability, currentDocument, quote, onQuote, onData, onSettings } = props;
  const [conversation, setConversation] = useState(newConversation);
  const [draft, setDraft] = useState("");
  const [selectedDocuments, setSelectedDocuments] = useState<Set<UUID>>(new Set());
  const [selectedTopics, setSelectedTopics] = useState<Set<UUID>>(new Set());
  const [includeCurrent, setIncludeCurrent] = useState(false);
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [sending, setSending] = useState(false);
  const [runId, setRunId] = useState<UUID | null>(null);
  const [trace, setTrace] = useState<AgentTraceEvent[]>([]);
  const [traceOpen, setTraceOpen] = useState(true);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showScope, setShowScope] = useState(false);
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeMatches, setScopeMatches] = useState<Set<UUID> | null>(null);
  const [composing, setComposing] = useState(false);
  const [pendingReview, setPendingReview] = useState<string[]>([]);
  const [reviewSelection, setReviewSelection] = useState<Set<string>>(new Set());
  const [importRecommendations, setImportRecommendations] = useState<
    Array<{ document: KnowledgeDocument; values: TopicRecommendation[] }>
  >([]);
  const [importTopicSelection, setImportTopicSelection] = useState<Set<string>>(new Set());
  const [classifyingImports, setClassifyingImports] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<{ runId: UUID; event: AgentTraceEvent }>("agent-trace", ({ payload }) => {
      if (payload.runId !== runId) return;
      setTrace((events) => [...events.slice(-199), payload.event]);
    });
    return () => { void unlisten.then((callback) => callback()); };
  }, [runId]);

  useEffect(() => {
    const target = scrollRef.current;
    if (target) target.scrollTop = target.scrollHeight;
  }, [conversation.messages.length, trace.length, sending]);

  useEffect(() => {
    if (!scopeQuery.trim()) {
      setScopeMatches(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.search(scopeQuery).then((ids) => {
        if (!cancelled) setScopeMatches(new Set(ids));
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scopeQuery, data.documents]);

  async function persistSettings(next: AppSettings) {
    onSettings(next);
    await api.updateSettings(next);
  }

  function selectConversation(value: Conversation) {
    setConversation(value);
    setSelectedDocuments(new Set(value.documentIds));
    setSelectedTopics(new Set(value.topicIds));
    setIncludeCurrent(value.includeCurrentPage);
    setIncludeAnnotations(value.includeAnnotations);
    setShowHistory(false);
    setTrace([]);
    onQuote(null);
  }

  async function sendMessage() {
    const question = draft.trim();
    if (!question || sending) return;
    setDraft("");
    setSending(true);
    setError("");
    setTrace([]);
    const now = new Date().toISOString();
    const user: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      quote: quote ? { ...quote, imageBase64: undefined } : undefined,
      createdAt: now
    };
    const base: Conversation = {
      ...conversation,
      title: conversation.title === "新对话" ? question.slice(0, 26) : conversation.title,
      messages: [...conversation.messages, user],
      updatedAt: now
    };
    setConversation(base);
    const documentIds = resolveDocumentIDs(selectedDocuments, currentDocument?.id, includeCurrent, quote);
    try {
      let assistant: ChatMessage;
      if (settings.chatBackend === "direct") {
        const result = await api.chatDirect({
          conversation: base,
          question,
          quote,
          documentIds,
          topicIds: [...selectedTopics],
          includeAnnotations
        });
        base.messages[base.messages.length - 1].promptContent = result.promptContent;
        assistant = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
          sources: result.sources as ContextChunk[],
          backend: "direct",
          generatedFiles: result.generatedFiles,
          createdAt: new Date().toISOString()
        };
      } else {
        const nextRunId = crypto.randomUUID();
        setRunId(nextRunId);
        const scopeSignature = agentScopeSignature(documentIds, selectedTopics, includeAnnotations);
        const saved = base.agentSessions[settings.chatBackend];
        const sessionId = saved?.scopeSignature === scopeSignature && saved.messageCount === base.messages.length - 1 ? saved.id : null;
        const result = await api.runAgent({
          backend: settings.chatBackend,
          runId: nextRunId,
          conversationId: base.id,
          question,
          quote,
          documentIds,
          topicIds: [...selectedTopics],
          includeAnnotations,
          sessionId
        });
        if (result.sessionID) {
          base.agentSessions = {
            ...base.agentSessions,
            [settings.chatBackend]: {
              id: result.sessionID,
              scopeSignature,
              messageCount: base.messages.length + 1
            }
          };
        }
        assistant = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
          backend: settings.chatBackend,
          generatedFiles: result.generatedFiles,
          pendingImports: result.pendingImports,
          traceEvents: result.traceEvents,
          createdAt: new Date().toISOString()
        };
        if (result.pendingImports.length) {
          setPendingReview(result.pendingImports);
          setReviewSelection(new Set(result.pendingImports));
        }
      }
      const completed: Conversation = {
        ...base,
        documentIds: [...selectedDocuments],
        topicIds: [...selectedTopics],
        includeCurrentPage: includeCurrent,
        includeAnnotations,
        currentDocumentId: currentDocument?.id,
        messages: [...base.messages, assistant],
        updatedAt: new Date().toISOString()
      };
      setConversation(completed);
      onData(await api.saveConversation(completed));
      onQuote(null);
    } catch (value) {
      const text = String(value);
      if (!text.includes("已停止")) setError(text);
    } finally {
      setSending(false);
      setRunId(null);
    }
  }

  async function summarize() {
    if (!conversation.messages.length) return;
    if (!pendingSummaryMessages(conversation).length) {
      setShowSummary(true);
      return;
    }
    setSending(true);
    try {
      const summary = await api.summarizeConversation(conversation);
      const pending = pendingSummaryMessages(conversation);
      const next = {
        ...conversation,
        summary,
        summaryMessageCount: Math.min(conversation.messages.length, conversation.summaryMessageCount + pending.length),
        updatedAt: new Date().toISOString()
      };
      setConversation(next);
      onData(await api.saveConversation(next));
      setShowSummary(true);
    } catch (value) {
      setError(String(value));
    } finally {
      setSending(false);
    }
  }

  const pureChat = !selectedDocuments.size && !selectedTopics.size && !includeCurrent && !quote;
  const backendLabel = settings.chatBackend === "direct"
    ? `${settings.model} · 直接 API`
    : `${settings.chatBackend === "codex" ? "Codex" : "Claude Code"} · 本机 Agent`;

  return (
    <aside className="chat-panel">
      <header className="chat-header">
        <span><Sparkles size={17} /><strong>知识问答</strong></span>
        <div>
          <button className="icon-button" title="对话摘要" onClick={summarize} disabled={!conversation.messages.length || sending}><FileText size={16} /></button>
          <button className="icon-button" title="对话历史" onClick={() => setShowHistory(true)}><History size={16} /></button>
          <button className="icon-button" title="新对话" onClick={() => {
            setConversation(newConversation());
            setSelectedDocuments(new Set());
            setSelectedTopics(new Set());
            setIncludeCurrent(false);
            onQuote(null);
          }}><Plus size={17} /></button>
          <PlacementMenu value={settings.chatPlacement} onChange={(chatPlacement) => persistSettings({ ...settings, chatPlacement })} />
        </div>
      </header>
      <section className="chat-scope">
        <div className="scope-head">
          <button className="scope-toggle" onClick={() => setShowScope(!showScope)}>
            {showScope ? <ChevronDown size={14} /> : <ChevronRight size={14} />}问答范围
          </button>
          <select
            value={settings.chatBackend}
            onChange={(event) => persistSettings({ ...settings, chatBackend: event.target.value as AppSettings["chatBackend"] })}
          >
            <option value="direct">直接 API</option>
            <option value="claudeCode" disabled={!agentAvailability.claudeCode}>Claude Code{agentAvailability.claudeCode ? "" : "（未检测到）"}</option>
            <option value="codex" disabled={!agentAvailability.codex}>Codex{agentAvailability.codex ? "" : "（未检测到）"}</option>
          </select>
          {settings.chatBackend === "direct" && (
            <select
              value={settings.apiContextMode}
              onChange={(event) => persistSettings({ ...settings, apiContextMode: event.target.value as AppSettings["apiContextMode"] })}
            >
              <option value="relevantFragments">相关片段</option>
              <option value="autonomous">自主检索</option>
            </select>
          )}
        </div>
        {showScope && (
          <div className="scope-body">
            <details>
              <summary>选择文件（{selectedDocuments.size}）</summary>
              <div className="scope-picker">
                <label className="scope-search">
                  <FileSearch size={14} />
                  <input value={scopeQuery} onChange={(event) => setScopeQuery(event.target.value)} placeholder="搜索标题、作者或正文" />
                </label>
                {data.documents.filter((document) => !scopeMatches || scopeMatches.has(document.id)).map((document) => (
                  <label className="scope-document-option" key={document.id}><input type="checkbox" checked={selectedDocuments.has(document.id)} onChange={(event) => {
                    const next = new Set(selectedDocuments);
                    if (event.target.checked) next.add(document.id); else next.delete(document.id);
                    setSelectedDocuments(next);
                  }} /><span>{displayTitle(document)}{document.authors.length > 0 && <small>{document.authors.join(" · ")}</small>}</span></label>
                ))}
                {scopeMatches && !data.documents.some((document) => scopeMatches.has(document.id)) && <span className="scope-empty">没有匹配资料</span>}
              </div>
            </details>
            <details>
              <summary>选择主题（{selectedTopics.size}）</summary>
              <div className="scope-picker">
                {data.topics.map((topic) => (
                  <label key={topic.id}><input type="checkbox" checked={selectedTopics.has(topic.id)} onChange={(event) => {
                    const next = new Set(selectedTopics);
                    if (event.target.checked) next.add(topic.id); else next.delete(topic.id);
                    setSelectedTopics(next);
                  }} />{topic.name}</label>
                ))}
              </div>
            </details>
            <label><input type="checkbox" checked={includeCurrent} onChange={(event) => setIncludeCurrent(event.target.checked)} />自动包含当前文档</label>
            <label><input type="checkbox" checked={includeAnnotations} onChange={(event) => setIncludeAnnotations(event.target.checked)} />包含所选范围内的批注</label>
          </div>
        )}
        <small>{pureChat ? "纯聊天：本轮不会加载本地文档或批注；Agent 可按问题使用网页搜索。" : `已选择 ${selectedDocuments.size} 份文件、${selectedTopics.size} 个主题，将按授权范围查询。`}</small>
        {selectedDocuments.size > 0 && (
          <div className="selected-document-chips" aria-label="已选择的问答文档">
            {data.documents.filter((document) => selectedDocuments.has(document.id)).map((document) => (
              <button key={document.id} title={`移除 ${displayTitle(document)}`} onClick={() => {
                const next = new Set(selectedDocuments);
                next.delete(document.id);
                setSelectedDocuments(next);
              }}><FileText size={12} /><span>{displayTitle(document)}</span><X size={11} /></button>
            ))}
          </div>
        )}
      </section>

      <div className="chat-messages" ref={scrollRef}>
        {!conversation.messages.length && (
          <div className="empty-state"><MessageSquare size={30} /><strong>开始聊天</strong><span>不选择范围时为纯聊天；需要资料时再选择当前文档、文件或主题。</span></div>
        )}
        {conversation.messages.map((message) => <MessageBubble key={message.id} message={message} />)}
        {trace.length > 0 && <TracePanel events={trace} open={traceOpen} running={sending} onOpen={setTraceOpen} />}
        {sending && (
          <div className="sending-row">
            <span className="spinner" />{runId ? `正在由 ${settings.chatBackend === "codex" ? "Codex" : "Claude Code"} 处理资料…` : "正在检索并回答…"}
            {runId && <button className="danger" onClick={() => api.stopAgent(runId)}><Square size={13} />停止</button>}
          </div>
        )}
      </div>
      {quote && (
        <div className="quote-strip" title={`${quote.documentName}${quote.page ? ` · 第 ${quote.page} 页` : ""}`}>
          <span><FileSearch size={14} />基于已选中区域回答</span>
          <button className="icon-button" onClick={() => onQuote(null)}><X size={14} /></button>
        </div>
      )}
      {error && <div className="chat-error">{error}</div>}
      <footer className="chat-composer">
        <textarea
          value={draft}
          placeholder="输入问题…"
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(event) => {
            const nativeComposing = event.nativeEvent.isComposing || event.keyCode === 229;
            if (event.key === "Enter" && shouldSendOnReturn(event.shiftKey, composing || nativeComposing)) {
              event.preventDefault();
              void sendMessage();
            }
          }}
        />
        <div><small>{backendLabel}</small><span>Enter 发送 · Shift+Enter 换行</span><button className="send-button" disabled={!draft.trim() || sending} onClick={sendMessage}><Send size={20} /></button></div>
      </footer>

      {showHistory && (
        <div className="modal-backdrop">
          <section className="modal history-modal">
            <h2>对话历史</h2>
            <div className="history-list">
              {data.conversations.map((value) => (
                <button key={value.id} onClick={() => selectConversation(value)}>
                  <History size={16} />
                  <span><strong>{value.messages.find((message) => message.role === "user") ? visibleMessage(value.messages.find((message) => message.role === "user")!) : value.title}</strong><small>{new Date(value.updatedAt).toLocaleString()} · {value.messages.length} 条消息</small></span>
                </button>
              ))}
              {!data.conversations.length && <div className="empty-state small">还没有保存的对话</div>}
            </div>
            <div className="modal-actions"><button onClick={() => setShowHistory(false)}>完成</button></div>
          </section>
        </div>
      )}
      {showSummary && (
        <div className="modal-backdrop">
          <section className="modal summary-modal">
            <h2>对话摘要</h2>
            <div className="summary-content"><MarkdownView markdown={conversation.summary || "尚未生成摘要。"} /></div>
            <div className="modal-actions"><button onClick={() => setShowSummary(false)}>完成</button></div>
          </section>
        </div>
      )}
      {pendingReview.length > 0 && (
        <PendingImportReview
          paths={pendingReview}
          selected={reviewSelection}
          onSelected={setReviewSelection}
          onLater={() => setPendingReview([])}
          onImport={async () => {
            const chosen = [...reviewSelection];
            const discarded = pendingReview.filter((path) => !reviewSelection.has(path));
            if (discarded.length) await api.discardPending(discarded);
            const result = await api.importPending(chosen);
            onData(result.data);
            setPendingReview([]);
            setClassifyingImports(true);
            try {
              const groups = await Promise.all(
                result.documentIds.map(async (id) => {
                  const document = result.data.documents.find((item) => item.id === id)!;
                  return { document, values: await api.recommendations(id) };
                })
              );
              setImportRecommendations(groups);
              setImportTopicSelection(
                new Set(groups.flatMap(({ document, values }) => values.map((value) => `${document.id}:${value.topicId}`)))
              );
            } finally {
              setClassifyingImports(false);
            }
          }}
        />
      )}
      {importRecommendations.length > 0 && (
        <TopicConfirmation
          groups={importRecommendations}
          topics={data.topics}
          selected={importTopicSelection}
          onSelected={setImportTopicSelection}
          onLater={() => setImportRecommendations([])}
          onApply={async () => {
            let next = data;
            for (const group of importRecommendations) {
              const topicIds = data.topics
                .filter((topic) => importTopicSelection.has(`${group.document.id}:${topic.id}`))
                .map((topic) => topic.id);
              next = await api.applyRecommendations(group.document.id, topicIds);
            }
            onData(next);
            setImportRecommendations([]);
          }}
        />
      )}
      {classifyingImports && (
        <div className="modal-backdrop">
          <section className="modal compact classification-progress">
            <span className="spinner" />
            <div><h2>正在分析主题</h2><p className="muted">使用当前配置的模型匹配已有目录；模型不可用时会自动切换为本地规则。</p></div>
          </section>
        </div>
      )}
    </aside>
  );
}

function PlacementMenu({ value, onChange }: { value: ChatPlacement; onChange: (value: ChatPlacement) => void }) {
  const icons = { right: PanelRight, bottom: PanelBottom, sidebar: LayoutPanelLeft, hidden: X };
  const Icon = icons[value];
  return (
    <details className="placement-menu">
      <summary title="知识问答位置"><Icon size={16} /></summary>
      <div className="popover-menu right">
        <button onClick={() => onChange("right")}><PanelRight size={14} />右侧</button>
        <button onClick={() => onChange("bottom")}><PanelBottom size={14} />底部</button>
        <button onClick={() => onChange("sidebar")}><LayoutPanelLeft size={14} />左侧合并</button>
        <button onClick={() => onChange("hidden")}><X size={14} />隐藏</button>
      </div>
    </details>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={`message ${message.role}`}>
      <header>{message.role === "user" ? <><Bot size={14} />你</> : <><Sparkles size={14} />{message.backend === "codex" ? "Codex" : message.backend === "claudeCode" ? "Claude Code" : "AI 助手"}</>}</header>
      <MarkdownView markdown={visibleMessage(message)} />
      {!!message.sources?.length && <small className="message-sources">{message.sources.map((source) => `[${source.label}] ${source.documentName}`).join("  ")}</small>}
      {!!message.generatedFiles?.length && <div className="message-files"><strong>生成文件</strong>{message.generatedFiles.map((path) => <span key={path}><FileText size={13} />{path.split("/").at(-1)}</span>)}</div>}
      {!!message.pendingImports?.length && <div className="message-files"><strong>Agent 下载资料</strong>{message.pendingImports.map((path) => <span key={path}><FileSearch size={13} />{path.split("/").at(-1)}</span>)}</div>}
      {!!message.traceEvents?.length && <TracePanel events={message.traceEvents} open={false} running={false} />}
    </article>
  );
}

function TracePanel({
  events,
  open: initialOpen,
  running,
  onOpen
}: {
  events: AgentTraceEvent[];
  open: boolean;
  running: boolean;
  onOpen?: (value: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(initialOpen);
  const open = onOpen ? initialOpen : localOpen;
  const setOpen = onOpen || setLocalOpen;
  const icons = {
    status: Clock3,
    tool: Wrench,
    file: FileText,
    warning: FileSearch,
    error: X,
    completed: CheckCircle2
  };
  return (
    <section className="trace-panel">
      <button className="trace-title" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {running ? <span className="spinner small" /> : <TerminalSquare size={14} />}
        <strong>{running ? "Agent 执行过程" : "执行过程"}</strong><small>{events.length} 项</small>
      </button>
      {open && <div className="trace-events">{events.map((event) => {
        const Icon = icons[event.kind];
        return <div key={event.id} className={event.kind}><Icon size={14} /><span><strong>{event.title}</strong>{event.detail && <small>{event.detail}</small>}</span><time>{new Date(event.createdAt).toLocaleTimeString()}</time></div>;
      })}</div>}
    </section>
  );
}

function PendingImportReview({
  paths,
  selected,
  onSelected,
  onLater,
  onImport
}: {
  paths: string[];
  selected: Set<string>;
  onSelected: (value: Set<string>) => void;
  onLater: () => void;
  onImport: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="modal compact">
        <h2>导入 Agent 下载资料</h2>
        <p className="muted">文件仍在 source/downloads/pending 中，只有你确认后才会进入知识库。导入后可在推荐主题弹窗中人工确认虚拟归属。</p>
        <div className="pending-list">
          {paths.map((path) => <label key={path}><input type="checkbox" checked={selected.has(path)} onChange={(event) => {
            const next = new Set(selected);
            if (event.target.checked) next.add(path); else next.delete(path);
            onSelected(next);
          }} /><span>{path.split("/").at(-1)}<small>{path}</small></span></label>)}
        </div>
        <div className="modal-actions"><button onClick={onLater}>稍后</button><button className="primary" disabled={!selected.size} onClick={onImport}>导入所选</button></div>
      </section>
    </div>
  );
}

function TopicConfirmation({
  groups,
  topics,
  selected,
  onSelected,
  onLater,
  onApply
}: {
  groups: Array<{ document: KnowledgeDocument; values: TopicRecommendation[] }>;
  topics: Topic[];
  selected: Set<string>;
  onSelected: (value: Set<string>) => void;
  onLater: () => void;
  onApply: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="modal recommendation-modal">
        <h2><Sparkles size={19} />确认下载资料的虚拟主题</h2>
        <p className="muted">模型推荐项已预先勾选。下面展示全部已有主题，你可以任意调整；只有确认后才会建立虚拟关联。</p>
        <div className="recommendation-list">
          {groups.map(({ document, values }) => (
            <div key={document.id} className="recommendation-document">
              <strong>{displayTitle(document)}</strong>
              {topics.length ? <div className="topic-choice-list">{[...topics]
                .sort((left, right) => topicDisplayPath(topics, left).localeCompare(topicDisplayPath(topics, right), "zh-CN"))
                .map((topic) => {
                const value = values.find((recommendation) => recommendation.topicId === topic.id);
                const key = `${document.id}:${topic.id}`;
                return (
                  <label className={value ? "recommended" : ""} key={key}>
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(key); else next.delete(key);
                        onSelected(next);
                      }}
                    />
                    <span><strong>{topicDisplayPath(topics, topic)}</strong><small>{value?.reason || "可手动选择"}</small></span>
                    {value && <em>{value.source === "ai" ? "AI 推荐" : "本地推荐"}</em>}
                  </label>
                );
              })}</div> : <span className="muted">还没有主题目录，可暂时保持未分类。</span>}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={onLater}>稍后处理</button>
          <button className="primary" onClick={onApply}>应用所选主题</button>
        </div>
      </section>
    </div>
  );
}

function topicDisplayPath(topics: Topic[], topic: Topic): string {
  const names = [topic.name];
  let parentId = topic.parentId;
  const visited = new Set<UUID>([topic.id]);
  while (parentId) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = topics.find((item) => item.id === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}

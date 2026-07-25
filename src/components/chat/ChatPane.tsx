import { useState } from "react";
import { useStore } from "../../state/store";
import { MarkdownView } from "./MarkdownView";
import type { Conversation, ChatMessage } from "../../types/models";

export function ChatPane() {
  const {
    conversation, draft, setDraft, sendMessage,
    sending, chatError, quote, setQuote,
    data, selectedDocumentIds, selectedTopicIds,
    includeCurrent, includeAnnotations,
    toggleDocumentSelection, toggleTopicSelection,
    newChat, loadConversation,
    settings,
  } = useStore();

  const [showHistory, setShowHistory] = useState(false);

  const docs = data?.documents || [];
  const topics = data?.topics || [];
  const conversations = data?.conversations || [];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sending && draft.trim()) {
        sendMessage();
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <h2 className="text-sm font-bold flex items-center gap-1.5">
          ✨ 知识问答
        </h2>
        <div className="flex-1" />
        <button
          onClick={() => setShowHistory(true)}
          className="text-xs px-2 py-1 hover:bg-[var(--color-hover)] rounded transition-colors"
          title="对话历史"
        >
          📋
        </button>
        <button
          onClick={newChat}
          className="text-xs px-2 py-1 hover:bg-[var(--color-hover)] rounded transition-colors"
          title="新对话"
          disabled={sending}
        >
          ＋
        </button>
        <button
          onClick={() => useStore.setState({ showSettings: true })}
          className="text-xs px-2 py-1 hover:bg-[var(--color-hover)] rounded transition-colors"
          title="设置"
        >
          ⚙
        </button>
      </div>

      {/* Scope selector */}
      <div className="px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] space-y-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-secondary font-medium shrink-0">问答范围</span>
          <div className="flex-1" />
          <select
            value={settings.chat_backend}
            onChange={(e) => useStore.setState({ settings: { ...settings, chat_backend: e.target.value } })}
            className="text-xs px-1.5 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)]"
          >
            <option value="direct">直接 API</option>
            <option value="claude_code">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
          {settings.chat_backend === "direct" && (
            <select
              value={settings.api_context_mode}
              onChange={(e) => useStore.setState({ settings: { ...settings, api_context_mode: e.target.value } })}
              className="text-xs px-1.5 py-0.5 border border-[var(--color-border)] rounded bg-[var(--color-bg)]"
            >
              <option value="relevant_fragments">相关片段</option>
              <option value="autonomous">自主检索</option>
            </select>
          )}
        </div>

        {/* Selected scope chips */}
        <div className="flex flex-wrap gap-1">
          {Array.from(selectedDocumentIds).map((id) => {
            const d = docs.find((x) => x.id === id);
            return d ? (
              <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 rounded-full text-[11px]">
                {d.display_name?.trim() || d.name}
                <button onClick={() => toggleDocumentSelection(id)} className="hover:opacity-70">×</button>
              </span>
            ) : null;
          })}
          {Array.from(selectedTopicIds).map((id) => {
            const t = topics.find((x) => x.id === id);
            return t ? (
              <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 rounded-full text-[11px]">
                📁 {t.name}
                <button onClick={() => toggleTopicSelection(id)} className="hover:opacity-70">×</button>
              </span>
            ) : null;
          })}
        </div>

        {selectedDocumentIds.size === 0 && selectedTopicIds.size === 0 && !includeCurrent && (
          <p className="text-[11px] text-secondary">纯聊天模式 — 未选择文档或主题</p>
        )}

        <div className="flex gap-3">
          <label className="flex items-center gap-1 text-[11px] cursor-pointer">
            <input type="checkbox" checked={includeCurrent} onChange={() => useStore.setState({ includeCurrent: !includeCurrent })} className="w-3 h-3" />
            当前文档
          </label>
          <label className="flex items-center gap-1 text-[11px] cursor-pointer">
            <input type="checkbox" checked={includeAnnotations} onChange={() => useStore.setState({ includeAnnotations: !includeAnnotations })} className="w-3 h-3" />
            包含批注
          </label>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-[var(--color-bg)]">
        {conversation.messages.length === 0 && (
          <div className="text-center text-sm text-secondary py-12">
            <p className="text-3xl mb-3">💬</p>
            <p className="font-medium">开始聊天</p>
            <p className="text-xs mt-1">
              {selectedDocumentIds.size > 0 || selectedTopicIds.size > 0
                ? "已选择上下文范围，AI 将基于所选资料回答"
                : "不选择范围时为纯聊天模式"}
            </p>
          </div>
        )}
        {conversation.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {sending && (
          <div className="flex items-start gap-2">
            <div className="text-xs font-semibold text-secondary mt-1">AI</div>
            <div className="flex-1 px-3 py-3 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)]">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quote indicator */}
      {quote && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] bg-purple-50 dark:bg-purple-900/20 border-t border-purple-200 dark:border-purple-800">
          <span className="text-secondary">
            📌 基于「{quote.document_name}」{quote.page ? `第${quote.page}页` : ""}的引用
          </span>
          <button onClick={() => setQuote(null)} className="text-red-500 hover:opacity-70 ml-auto">✕</button>
        </div>
      )}

      {chatError && (
        <div className="px-3 py-1.5 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800">
          {chatError}
        </div>
      )}

      {/* Composer */}
      <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <textarea
          className="w-full min-h-[48px] max-h-[120px] px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] resize-none outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/30 transition-all"
          placeholder="输入问题，Enter 发送，Shift+Enter 换行…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <div className="flex justify-between items-center mt-2">
          <span className="text-[11px] text-secondary truncate mr-2">
            {settings.chat_backend === "direct"
              ? `${settings.model}`
              : `${settings.chat_backend === "claude_code" ? "Claude Code" : "Codex"}`}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-secondary hidden sm:inline">Enter 发送 · Shift+Enter 换行</span>
            <button
              onClick={sendMessage}
              disabled={sending || !draft.trim()}
              className="px-4 py-1.5 bg-[var(--color-accent)] text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center gap-1"
            >
              {sending ? "…" : "发送"}
            </button>
          </div>
        </div>
      </div>

      {/* History modal */}
      {showHistory && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50" onClick={() => setShowHistory(false)}>
          <div className="bg-[var(--color-bg)] rounded-xl shadow-2xl p-6 w-[620px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3">对话历史</h2>
            {conversations.length === 0 ? (
              <div className="py-12 text-center text-secondary">
                <p className="text-2xl mb-2">📋</p>
                <p>还没有对话历史</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2">
                {conversations.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => {
                      loadConversation(conv);
                      setShowHistory(false);
                    }}
                    className="w-full text-left p-3 border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-hover)] transition-colors"
                  >
                    <div className="font-medium text-sm truncate">
                      {conv.messages.find((m) => m.role === "user")?.content.slice(0, 60) || conv.title}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-secondary">
                      <span>{conv.messages.length} 条消息</span>
                      <span>{new Date(conv.updated_at).toLocaleDateString("zh-CN")}</span>
                    </div>
                    {conv.summary && (
                      <p className="text-xs text-secondary mt-1 line-clamp-2">{conv.summary}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-3">
              <button onClick={() => setShowHistory(false)} className="px-4 py-1.5 bg-[var(--color-accent)] text-white rounded-md text-sm">
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const backendName = message.backend === "claude_code" ? "Claude Code" : message.backend === "codex" ? "Codex" : "AI 助手";

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs mt-1 ${
        isUser ? "bg-[var(--color-accent)] text-white" : "bg-gray-200 dark:bg-gray-700"
      }`}>
        {isUser ? "你" : "AI"}
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? "items-end" : "items-start"}`}>
        <div className="text-[10px] text-secondary mb-0.5 px-0.5">
          {isUser ? "你" : backendName}
        </div>
        <div className={`px-3.5 py-2.5 rounded-xl text-sm ${
          isUser
            ? "bg-[var(--color-accent-light)] border border-[var(--color-accent)]/10 rounded-tr-sm"
            : "bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-tl-sm"
        }`}>
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <MarkdownView markdown={message.content} />
          )}
          {message.sources && message.sources.length > 0 && (
            <div className="mt-2.5 pt-2 border-t border-[var(--color-border)]/50">
              <div className="text-[10px] text-secondary mb-1 font-medium">参考来源</div>
              <div className="flex flex-wrap gap-1">
                {message.sources.map((s) => (
                  <span key={s.id} className="text-[10px] px-1.5 py-0.5 bg-[var(--color-bg)] rounded-full border border-[var(--color-border)] text-secondary">
                    {s.label}: {s.document_name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

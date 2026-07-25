import { useState } from "react";
import { useStore } from "../../state/store";
import type { Conversation, ChatMessage } from "../../types/models";

export function ChatPane() {
  const {
    conversation, draft, setDraft, sendMessage,
    sending, chatError, quote, setQuote,
    settings, selectedDocumentIds, selectedTopicIds,
    includeCurrent, includeAnnotations,
    toggleDocumentSelection, toggleTopicSelection,
    newChat, data,
  } = useStore();

  const [showHistory, setShowHistory] = useState(false);

  const docs = data?.documents || [];
  const topics = data?.topics || [];

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
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[var(--color-border)]">
        <h2 className="text-sm font-bold">知识问答</h2>
        <div className="flex-1" />
        <button onClick={() => setShowHistory(true)} className="text-xs px-2 py-1 hover:bg-[var(--color-hover)] rounded" title="对话历史">
          📋
        </button>
        <button onClick={newChat} className="text-xs px-2 py-1 hover:bg-[var(--color-hover)] rounded" title="新对话">
          ＋
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {conversation.messages.length === 0 && (
          <div className="text-center text-sm text-secondary py-8">
            <p>开始聊天</p>
            <p className="text-xs mt-1">不选择范围时为纯聊天模式</p>
          </div>
        )}
        {conversation.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {sending && (
          <div className="text-sm text-secondary animate-pulse">正在思考…</div>
        )}
      </div>

      {/* Quote indicator */}
      {quote && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs bg-[var(--color-bg-secondary)] border-t border-[var(--color-border)]">
          <span className="text-secondary">
            基于选中区域：「{quote.document_name}」
          </span>
          <button onClick={() => setQuote(null)} className="text-red-500 hover:opacity-70">
            ×
          </button>
        </div>
      )}

      {chatError && (
        <div className="px-3 py-1 text-xs text-red-500">{chatError}</div>
      )}

      {/* Composer */}
      <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <textarea
          className="w-full min-h-[52px] max-h-[120px] px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] resize-none outline-none focus:border-[var(--color-accent)]"
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex justify-between items-center mt-2">
          <span className="text-xs text-secondary">
            {settings.chat_backend === "direct"
              ? `${settings.model} · 直接 API`
              : `${settings.chat_backend}`}
          </span>
          <button
            onClick={sendMessage}
            disabled={sending || !draft.trim()}
            className="px-4 py-1.5 bg-[var(--color-accent)] text-white rounded-md text-sm font-medium disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-3.5 py-2.5 rounded-lg text-sm ${
          isUser
            ? "bg-[var(--color-accent-light)] border border-[var(--color-accent)]/20"
            : "bg-[var(--color-bg)] border border-[var(--color-border)]"
        }`}
      >
        <div className="text-xs font-semibold mb-1 opacity-60">
          {isUser ? "你" : (message.backend || "AI 助手")}
        </div>
        <div className="prose prose-sm max-w-none leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </div>
        {message.sources && message.sources.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[var(--color-border)] text-xs text-secondary">
            {message.sources.map((s) => (
              <span key={s.id} className="mr-3">
                [{s.label}] {s.document_name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

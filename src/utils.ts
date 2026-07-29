import type { ChatMessage, Conversation, ReaderQuote, UUID } from "./types";

export const legacySelectionPrompt = "请结合上下文回答我关于这段内容的问题：";

export function visibleMessage(message: ChatMessage): string {
  if (message.role !== "user" || !message.quote) return message.content;
  const value = message.content.trim();
  if (!value.startsWith(legacySelectionPrompt)) return message.content;
  return value.slice(legacySelectionPrompt.length).trim() || "基于已选中区域提问";
}

export function shouldSendOnReturn(shiftPressed: boolean, isComposing: boolean): boolean {
  return !shiftPressed && !isComposing;
}

export function resolveDocumentIDs(
  selected: Iterable<UUID>,
  currentDocumentID: UUID | null | undefined,
  includeCurrent: boolean,
  quote: ReaderQuote | null | undefined
): UUID[] {
  const values = new Set(selected);
  if (includeCurrent && currentDocumentID) values.add(currentDocumentID);
  if (quote?.documentId) values.add(quote.documentId);
  return [...values];
}

export function pendingSummaryMessages(conversation: Conversation): ChatMessage[] {
  const start = Math.min(Math.max(0, conversation.summaryMessageCount), conversation.messages.length);
  return conversation.messages.slice(start, start + 30);
}

export function newConversation(): Conversation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    documentIds: [],
    topicIds: [],
    includeCurrentPage: false,
    includeAnnotations: true,
    messages: [],
    summary: "",
    summaryMessageCount: 0,
    agentSessions: {},
    createdAt: now,
    updatedAt: now
  };
}

export function displayTitle(document: { name: string; displayName?: string | null }): string {
  return document.displayName?.trim() || document.name;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

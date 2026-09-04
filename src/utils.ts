import type { AnnotationRect, ChatBackend, ChatMessage, Conversation, ReaderQuote, UUID } from "./types";

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

export function availableChatBackend(
  preferred: ChatBackend,
  availability: Record<"claudeCode" | "codex", string | null>
): ChatBackend {
  if (preferred === "direct") return preferred;
  return availability[preferred] ? preferred : "direct";
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

export function agentScopeSignature(
  documentIds: Iterable<UUID>,
  topicIds: Iterable<UUID>,
  includeAnnotations: boolean
): string {
  const documents = [...new Set(documentIds)].sort().join(",");
  const topics = [...new Set(topicIds)].sort().join(",");
  return `documents:${documents}|topics:${topics}|annotations:${includeAnnotations}`;
}

export function clampChatPanelWidth(requested: number, viewportWidth: number): number {
  const minimum = 240;
  const maximum = Math.max(minimum, Math.min(720, viewportWidth - 660));
  return Math.round(Math.min(Math.max(requested, minimum), maximum));
}

export function pdfOutputScale(devicePixelRatio: number, isWindows: boolean): number {
  const safeRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(2, Math.max(safeRatio, isWindows ? 1.5 : 1));
}

export function fitPDFScale(
  availableWidth: number,
  pageWidth: number
): number {
  if (availableWidth <= 0 || pageWidth <= 0) return 1;
  return Math.min(4, Math.max(0.55, availableWidth / pageWidth));
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

export function selectionToolbarPosition(
  container: Pick<DOMRect, "left" | "top" | "width" | "height">,
  selection: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  toolbar = { width: 320, height: 42 }
): { x: number; y: number } {
  const margin = 8;
  const gap = 8;
  const right = selection.right - container.left + gap;
  const left = selection.left - container.left - toolbar.width - gap;
  const preferredX = right + toolbar.width <= container.width - margin ? right : left;
  const above = selection.top - container.top - toolbar.height - gap;
  const below = selection.bottom - container.top + gap;
  const preferredY = above >= margin ? above : below;
  return {
    x: Math.min(Math.max(margin, preferredX), Math.max(margin, container.width - toolbar.width - margin)),
    y: Math.min(Math.max(margin, preferredY), Math.max(margin, container.height - toolbar.height - margin))
  };
}

export function normalizeAnnotationRects(rects: AnnotationRect[]): AnnotationRect[] {
  const normalized = rects
    .filter((rect) => Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.width > 0.5 && rect.height > 0.5)
    .map((rect) => ({ ...rect }))
    .sort((left, right) => left.page - right.page || left.y - right.y || left.x - right.x);
  const merged: AnnotationRect[] = [];
  for (const rect of normalized) {
    const current = merged.at(-1);
    if (!current || current.page !== rect.page) {
      merged.push(rect);
      continue;
    }
    const verticalOverlap = Math.max(0, Math.min(current.y + current.height, rect.y + rect.height) - Math.max(current.y, rect.y));
    const sameLine = verticalOverlap / Math.min(current.height, rect.height) >= 0.65;
    const horizontalGap = rect.x - (current.x + current.width);
    if (!sameLine || horizontalGap > Math.max(2, Math.min(current.height, rect.height) * 0.35)) {
      merged.push(rect);
      continue;
    }
    const right = Math.max(current.x + current.width, rect.x + rect.width);
    const bottom = Math.max(current.y + current.height, rect.y + rect.height);
    current.x = Math.min(current.x, rect.x);
    current.y = Math.min(current.y, rect.y);
    current.width = right - current.x;
    current.height = bottom - current.y;
  }
  return merged;
}

export function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

import { describe, expect, it } from "vitest";
import {
  agentScopeSignature,
  availableChatBackend,
  clampChatPanelWidth,
  fitPDFScale,
  legacySelectionPrompt,
  newConversation,
  pendingSummaryMessages,
  pdfOutputScale,
  resolveDocumentIDs,
  selectionToolbarPosition,
  shouldSendOnReturn,
  visibleMessage
} from "./utils";
import type { ChatMessage } from "./types";

const message = (content: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  content,
  quote: { text: "quote", documentId: "quoted", documentName: "paper.pdf" },
  createdAt: new Date().toISOString()
});

describe("chat behavior", () => {
  it("sends on return but not shift-return or IME composition", () => {
    expect(shouldSendOnReturn(false, false)).toBe(true);
    expect(shouldSendOnReturn(true, false)).toBe(false);
    expect(shouldSendOnReturn(false, true)).toBe(false);
  });

  it("falls back to direct API when a local agent is unavailable", () => {
    const availability = { claudeCode: null, codex: "/usr/local/bin/codex" };
    expect(availableChatBackend("claudeCode", availability)).toBe("direct");
    expect(availableChatBackend("codex", availability)).toBe("codex");
    expect(availableChatBackend("direct", availability)).toBe("direct");
  });

  it("keeps the internal selection prompt out of the visible bubble", () => {
    expect(visibleMessage(message(`${legacySelectionPrompt}\n解释公式`))).toBe("解释公式");
    expect(visibleMessage(message(legacySelectionPrompt))).toBe("基于已选中区域提问");
  });

  it("automatically authorizes a quoted document", () => {
    expect(resolveDocumentIDs(["one"], "current", false, message("x").quote)).toEqual(
      expect.arrayContaining(["one", "quoted"])
    );
  });

  it("changes the agent scope when documents, topics, or annotations change", () => {
    expect(agentScopeSignature(["b", "a"], ["topic"], true)).toBe(
      agentScopeSignature(["a", "b"], ["topic"], true)
    );
    expect(agentScopeSignature(["a"], ["topic"], true)).not.toBe(
      agentScopeSignature(["a"], ["other"], true)
    );
    expect(agentScopeSignature(["a"], [], true)).not.toBe(
      agentScopeSignature(["a"], [], false)
    );
  });

  it("keeps the right chat panel within readable layout limits", () => {
    expect(clampChatPanelWidth(500, 1400)).toBe(500);
    expect(clampChatPanelWidth(900, 1400)).toBe(720);
    expect(clampChatPanelWidth(100, 900)).toBe(240);
  });

  it("renders Windows PDFs above CSS resolution without exceeding 2x", () => {
    expect(pdfOutputScale(1, true)).toBe(1.5);
    expect(pdfOutputScale(1.25, true)).toBe(1.5);
    expect(pdfOutputScale(2.5, true)).toBe(2);
    expect(pdfOutputScale(1, false)).toBe(1);
  });

  it("fits a PDF page to the full available reader width", () => {
    expect(fitPDFScale(900, 600)).toBe(1.5);
    expect(fitPDFScale(1200, 600)).toBe(2);
    expect(fitPDFScale(100, 1000)).toBe(0.55);
  });

  it("summarizes at most thirty unprocessed messages", () => {
    const conversation = newConversation();
    conversation.summaryMessageCount = 2;
    conversation.messages = Array.from({ length: 40 }, (_, index) => message(String(index)));
    expect(pendingSummaryMessages(conversation)).toHaveLength(30);
    expect(pendingSummaryMessages(conversation)[0].content).toBe("2");
  });
});

describe("reader selection toolbar", () => {
  const container = { left: 100, top: 50, width: 900, height: 700 };

  it("opens beside and above the selected text when space is available", () => {
    expect(selectionToolbarPosition(
      container,
      { left: 300, right: 420, top: 260, bottom: 280 }
    )).toEqual({ x: 328, y: 160 });
  });

  it("moves inside the reader when the selection is near an edge", () => {
    expect(selectionToolbarPosition(
      container,
      { left: 110, right: 160, top: 55, bottom: 75 }
    )).toEqual({ x: 68, y: 33 });
    expect(selectionToolbarPosition(
      container,
      { left: 930, right: 990, top: 260, bottom: 280 }
    ).x).toBe(502);
  });
});

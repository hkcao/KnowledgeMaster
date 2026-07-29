import { describe, expect, it } from "vitest";
import {
  legacySelectionPrompt,
  newConversation,
  pendingSummaryMessages,
  resolveDocumentIDs,
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

  it("keeps the internal selection prompt out of the visible bubble", () => {
    expect(visibleMessage(message(`${legacySelectionPrompt}\n解释公式`))).toBe("解释公式");
    expect(visibleMessage(message(legacySelectionPrompt))).toBe("基于已选中区域提问");
  });

  it("automatically authorizes a quoted document", () => {
    expect(resolveDocumentIDs(["one"], "current", false, message("x").quote)).toEqual(
      expect.arrayContaining(["one", "quoted"])
    );
  });

  it("summarizes at most thirty unprocessed messages", () => {
    const conversation = newConversation();
    conversation.summaryMessageCount = 2;
    conversation.messages = Array.from({ length: 40 }, (_, index) => message(String(index)));
    expect(pendingSummaryMessages(conversation)).toHaveLength(30);
    expect(pendingSummaryMessages(conversation)[0].content).toBe("2");
  });
});

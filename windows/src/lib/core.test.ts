import { describe, expect, it } from "vitest";
import {
  chunks,
  documentIdsForTopic,
  normalizeKnowledgeData,
  queryTerms,
  score
} from "./core";

describe("Windows knowledge core", () => {
  it("loads sparse legacy knowledge.json values", () => {
    const data = normalizeKnowledgeData({ version: 2, documents: [] });
    expect(data.version).toBe(2);
    expect(data.annotations).toEqual([]);
    expect(data.summaryNotes).toEqual([]);
  });

  it("uses the same title-weighted keyword scoring as macOS", () => {
    expect(queryTerms("Graph-RAG, PDF")).toEqual(["graph", "rag", "pdf"]);
    expect(score("graph", "graph in body", "unrelated")).toBe(2);
    expect(score("graph", "", "Graph methods")).toBe(8);
  });

  it("chunks with overlap without losing the tail", () => {
    const values = chunks("1234567890", 6, 2);
    expect(values).toEqual(["123456", "567890"]);
  });

  it("includes nested topic documents", () => {
    const data = normalizeKnowledgeData({
      topics: [
        { id: "a", name: "A", createdAt: "" },
        { id: "b", name: "B", parentId: "a", createdAt: "" }
      ],
      documentTopics: [{ documentId: "doc", topicId: "b", createdAt: "" }]
    });
    expect(documentIdsForTopic(data, "a")).toEqual(new Set(["doc"]));
  });
});

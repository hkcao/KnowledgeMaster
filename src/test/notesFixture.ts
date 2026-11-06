import type { KnowledgeData } from "../types";
export const knowledgeFixture: KnowledgeData = {
  version: 8,
  documents: [{ id: "doc", name: "storage.pdf", displayName: "Mooncake 技术论文", extension: ".pdf", size: 1, sha256: "hash", authors: [], importedAt: "2026-11-06", status: "ready" }],
  topics: [], documentTopics: [], bookmarks: [], conversations: [], topicSummaries: [],
  summaryNotes: [
    { id: "a", title: "缓存设计", content: "KV cache 的设计与优化", annotationIDs: ["x"], createdAt: "2026-11-01", updatedAt: "2026-11-06" },
    { id: "b", title: "传输方案", content: "RDMA 与 TCP 的延迟对比", annotationIDs: [], createdAt: "2026-11-01", updatedAt: "2026-11-05" },
    { id: "c", title: "独立研究", content: "无关联内容", annotationIDs: [], createdAt: "2026-11-01", updatedAt: "2026-11-04" }
  ],
  annotations: [
    { id: "x", documentId: "doc", page: 2, quote: "Zero-copy memory transfer", kind: "note", note: "零拷贝路径", rects: [], createdAt: "2026-11-01", updatedAt: "2026-11-03" },
    { id: "y", documentId: "doc", page: 4, quote: "Prefix caching improves reuse", kind: "highlight", note: "", rects: [], createdAt: "2026-11-01", updatedAt: "2026-11-02" }
  ],
  noteLinks: [{ id: "edge", source: "annotation:x", target: "note:b", reason: "传输背景", createdBy: "manual", createdAt: "2026-11-06" }]
};

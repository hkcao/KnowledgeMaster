import type {
  ContextChunk,
  KnowledgeData,
  KnowledgeDocument,
  Topic
} from "../types";

export const emptyKnowledgeData = (): KnowledgeData => ({
  version: 5,
  documents: [],
  topics: [],
  documentTopics: [],
  bookmarks: [],
  annotations: [],
  conversations: [],
  topicSummaries: [],
  summaryNotes: []
});

export function normalizeKnowledgeData(input: Partial<KnowledgeData> | null | undefined): KnowledgeData {
  const empty = emptyKnowledgeData();
  return {
    ...empty,
    ...input,
    version: input?.version ?? 5,
    documents: input?.documents ?? [],
    topics: input?.topics ?? [],
    documentTopics: input?.documentTopics ?? [],
    bookmarks: input?.bookmarks ?? [],
    annotations: input?.annotations ?? [],
    conversations: input?.conversations ?? [],
    topicSummaries: input?.topicSummaries ?? [],
    summaryNotes: input?.summaryNotes ?? []
  };
}

export function displayTitle(document: KnowledgeDocument): string {
  return document.displayName?.trim() || document.name;
}

export function queryTerms(query: string): string[] {
  return query
    .toLocaleLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function score(query: string, text: string, title = ""): number {
  const body = text.toLocaleLowerCase();
  const name = title.toLocaleLowerCase();
  return queryTerms(query).reduce(
    (total, term) => total + (body.includes(term) ? 2 : 0) + (name.includes(term) ? 8 : 0),
    0
  );
}

export function chunks(text: string, size = 1400, overlap = 180): string[] {
  if (!text) return [];
  const result: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    result.push(text.slice(start, end));
    if (end === text.length) break;
    start = Math.max(start + 1, end - Math.min(overlap, end - start));
  }
  return result;
}

export function documentIdsForTopic(data: KnowledgeData, topicId: string | null): Set<string> | null {
  if (!topicId) return null;
  const childIds = new Set<string>([topicId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const topic of data.topics) {
      if (topic.parentId && childIds.has(topic.parentId) && !childIds.has(topic.id)) {
        childIds.add(topic.id);
        changed = true;
      }
    }
  }
  return new Set(
    data.documentTopics
      .filter((link) => childIds.has(link.topicId))
      .map((link) => link.documentId)
  );
}

export function filterDocuments(
  data: KnowledgeData,
  query: string,
  topicId: string | null,
  extractedText: Record<string, string> = {}
): KnowledgeDocument[] {
  const topicDocuments = documentIdsForTopic(data, topicId);
  return data.documents
    .filter((document) => !topicDocuments || topicDocuments.has(document.id))
    .filter((document) => {
      if (!query.trim()) return true;
      return score(query, extractedText[document.id] ?? "", displayTitle(document)) > 0;
    })
    .sort((a, b) => displayTitle(a).localeCompare(displayTitle(b), "zh-CN"));
}

export function topicDepth(topics: Topic[], topic: Topic): number {
  let depth = 0;
  let current = topic;
  const visited = new Set<string>();
  while (current.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = topics.find((candidate) => candidate.id === current.parentId);
    if (!parent) break;
    current = parent;
    depth += 1;
  }
  return depth;
}

export function buildContext(
  query: string,
  documents: KnowledgeDocument[],
  texts: Record<string, string>,
  maxChunks = 12
): ContextChunk[] {
  return documents
    .flatMap((document) =>
      chunks(texts[document.id] ?? "").map((text, index) => ({
        id: crypto.randomUUID(),
        label: `${displayTitle(document)} · 片段 ${index + 1}`,
        documentId: document.id,
        documentName: displayTitle(document),
        page: null,
        text,
        rank: score(query, text, displayTitle(document))
      }))
    )
    .sort((a, b) => b.rank - a.rank)
    .slice(0, maxChunks)
    .map(({ rank: _rank, ...chunk }) => chunk);
}

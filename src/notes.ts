import type { KnowledgeData } from "./types";
import { displayTitle } from "./utils";

export interface NoteNode {
  key: string;
  id: string;
  kind: "note" | "annotation";
  title: string;
  body: string;
  quote: string;
  source: string;
  updatedAt: string;
  page?: number | null;
}
export interface NoteEdge { id: string; source: string; target: string; reason: string; origin: "manual" | "model" | "reference" }

export function noteNodes(data: KnowledgeData): NoteNode[] {
  return [
    ...data.summaryNotes.map((note) => ({ key: `note:${note.id}`, id: note.id, kind: "note" as const, title: note.title, body: note.content, quote: "", source: "独立笔记", updatedAt: note.updatedAt })),
    ...data.annotations.map((annotation) => {
      const doc = data.documents.find((d) => d.id === annotation.documentId);
      return { key: `annotation:${annotation.id}`, id: annotation.id, kind: "annotation" as const,
        title: (annotation.note || annotation.quote).split("\n")[0].slice(0, 90) || "未命名注释", body: annotation.note,
        quote: annotation.quote, source: doc ? displayTitle(doc) : "原文已删除", updatedAt: annotation.updatedAt, page: annotation.page };
    })
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key));
}

export function noteEdges(data: KnowledgeData): NoteEdge[] {
  const valid = new Set(noteNodes(data).map((n) => n.key));
  const seen = new Set<string>();
  const edges: NoteEdge[] = [];
  const add = (edge: NoteEdge) => {
    const pair = [edge.source, edge.target].sort().join("|");
    if (edge.source === edge.target || !valid.has(edge.source) || !valid.has(edge.target) || seen.has(pair)) return;
    seen.add(pair); edges.push(edge);
  };
  for (const link of data.noteLinks || []) add({ ...link, origin: link.createdBy });
  for (const note of data.summaryNotes) for (const id of note.annotationIDs) add({ id: `reference:${note.id}:${id}`, source: `note:${note.id}`, target: `annotation:${id}`, reason: "笔记引用此注释", origin: "reference" });
  return edges;
}

export function relatedKeys(selected: string | null, edges: NoteEdge[], transitive = true): Set<string> {
  if (!selected) return new Set();
  const found = new Set([selected]);
  const queue = [selected];
  for (let index = 0; index < queue.length; index++) {
    const key = queue[index];
    for (const edge of edges) {
      const other = edge.source === key ? edge.target : edge.target === key ? edge.source : null;
      if (other && !found.has(other)) { found.add(other); if (transitive) queue.push(other); }
    }
  }
  return found;
}

export function matchesNote(node: NoteNode, query: string) {
  const text = `${node.title} ${node.body} ${node.quote} ${node.source}`.toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every((term) => text.includes(term));
}

/** Stable, separated clusters; isolated notes remain visible and selectable. */
export function layoutNotes(nodes: NoteNode[], edges: NoteEdge[]) {
  const pending = new Set(nodes.map((n) => n.key).sort());
  const groups: string[][] = [];
  while (pending.size) {
    const first = pending.values().next().value as string;
    const component = relatedKeys(first, edges);
    const keys = [...component].filter((key) => pending.has(key));
    for (const key of keys) pending.delete(key);
    groups.push(keys.sort((a, b) => edges.filter((e) => e.source === b || e.target === b).length - edges.filter((e) => e.source === a || e.target === a).length || a.localeCompare(b)));
  }
  groups.sort((a, b) => b.length - a.length);
  const limit = Math.max(640, Math.sqrt(nodes.length) * 160);
  const positions = new Map<string, { x: number; y: number }>();
  let left = 0, top = 0, rowHeight = 0, width = 0;
  for (const group of groups) {
    const radius = group.length <= 1 ? 0 : Math.sqrt(group.length - 1) * 110;
    const size = radius * 2 + 170;
    if (left && left + size > limit) { left = 0; top += rowHeight + 45; rowHeight = 0; }
    group.forEach((key, index) => {
      const angle = index * 2.399963229728653;
      const distance = index === 0 ? 0 : Math.sqrt(index) * 110;
      positions.set(key, { x: left + size / 2 + Math.cos(angle) * distance, y: top + size / 2 + Math.sin(angle) * distance });
    });
    left += size + 35; rowHeight = Math.max(rowHeight, size); width = Math.max(width, left);
  }
  const height = top + rowHeight;
  for (const point of positions.values()) { point.x -= width / 2; point.y -= height / 2; }
  return { positions, width: Math.max(width, 300), height: Math.max(height, 240) };
}

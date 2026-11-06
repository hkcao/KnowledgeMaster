import { describe, expect, it } from "vitest";
import { layoutNotes, matchesNote, noteEdges, noteNodes, relatedKeys } from "./notes";
import { knowledgeFixture } from "./test/notesFixture";

describe("knowledge graph", () => {
  it("searches content, quotes, source titles and English keywords directly", () => {
    const nodes = noteNodes(knowledgeFixture);
    expect(nodes.filter((n) => matchesNote(n, "kv CACHE")).map((n) => n.key)).toEqual(["note:a"]);
    expect(nodes.filter((n) => matchesNote(n, "Mooncake zero-copy")).map((n) => n.key)).toEqual(["annotation:x"]);
    expect(nodes.filter((n) => matchesNote(n, "零拷贝")).map((n) => n.key)).toEqual(["annotation:x"]);
  });
  it("merges existing references and explicit links and distinguishes direct from transitive connections", () => {
    const edges = noteEdges(knowledgeFixture);
    expect(edges).toHaveLength(2);
    expect([...relatedKeys("note:a", edges, false)].sort()).toEqual(["annotation:x", "note:a"]);
    expect([...relatedKeys("note:a", edges)].sort()).toEqual(["annotation:x", "note:a", "note:b"]);
    expect(relatedKeys("note:a", edges).has("note:c")).toBe(false);
    const data = { ...knowledgeFixture, noteLinks: [...knowledgeFixture.noteLinks!, { ...knowledgeFixture.noteLinks![0], id: "reference-duplicate", source: "annotation:x", target: "note:a" }, { ...knowledgeFixture.noteLinks![0], id: "missing", source: "note:gone" }] };
    expect(noteEdges(data)).toHaveLength(2);
  });
  it("keeps every node visible with stable finite positions including isolated nodes", () => {
    const nodes = noteNodes(knowledgeFixture), edges = noteEdges(knowledgeFixture);
    const layout = layoutNotes(nodes, edges);
    expect(layout.positions.size).toBe(nodes.length);
    expect([...layout.positions.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(layoutNotes([...nodes].reverse(), edges).positions).toEqual(layout.positions);
  });
});

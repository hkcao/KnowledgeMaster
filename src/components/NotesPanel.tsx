import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, FilePenLine, Network, Plus, Search } from "lucide-react";
import { api } from "../api";
import type { KnowledgeData, SummaryNote, UUID } from "../types";
import { displayTitle } from "../utils";
import { matchesNote, noteEdges, noteNodes, relatedKeys } from "../notes";
import type { NoteNode } from "../notes";
import MarkdownView from "./MarkdownView";
import NoteCard from "./NoteCard";
import NotesWorkspace from "./NotesWorkspace";

export default function NotesPanel({ data, onData, onOpenAnnotation }: {
  data: KnowledgeData; onData: (data: KnowledgeData) => void; onOpenAnnotation: (id: UUID) => void;
}) {
  const [editing, setEditing] = useState<SummaryNote | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState(false);
  const nodes = useMemo(() => noteNodes(data), [data]);
  const edges = useMemo(() => noteEdges(data), [data]);
  const related = useMemo(() => relatedKeys(selected, edges), [selected, edges]);
  const visible = nodes.filter((node) => (kind === "all" || node.kind === kind) && matchesNote(node, query));
  return <div className="notes-panel">
    <div className="notes-heading"><div><strong>我的知识</strong><small>{data.summaryNotes.length} 篇笔记 · {data.annotations.length} 条注释</small></div><button className="icon-button" title="新建笔记" onClick={() => setEditing("new")}><Plus size={18}/></button></div>
    <label className="search-field notes-search"><Search size={15}/><input aria-label="搜索笔记和注释" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索笔记、注释、原文…"/></label>
    <div className="notes-toolbar"><button className="notes-graph-button" onClick={() => setWorkspace(true)}><Network size={15}/>知识图谱<small>{edges.length} 条关联</small></button></div>
    <div className="notes-filters" aria-label="笔记类型">{[["all", "全部"], ["note", "笔记"], ["annotation", "注释"]].map(([value, label]) => <button key={value} className={kind === value ? "active" : ""} onClick={() => setKind(value)}>{label}</button>)}<small>{visible.length} 项</small></div>
    <div className="notes-scroll note-card-list">
      {visible.map((node) => <div className="note-entry" key={node.key}>
        <NoteCard node={node} selected={selected === node.key} expanded={selected === node.key} related={related.has(node.key) && selected !== node.key} links={edges.filter((edge) => edge.source === node.key || edge.target === node.key).length} onClick={() => setSelected(selected === node.key ? null : node.key)}/>
        {selected === node.key && <ExpandedNote node={node} onData={onData} onEdit={() => { const note = data.summaryNotes.find((item) => item.id === node.id); if (note) setEditing(note); }} onOpenAnnotation={onOpenAnnotation}/>}
      </div>)}
      {!visible.length && <div className="empty-state"><FilePenLine size={28}/><strong>{nodes.length ? "没有匹配内容" : "从一条思考开始"}</strong><span>{nodes.length ? "试试标题、正文或原文中的关键词" : "新建笔记，或在阅读时划词添加注释"}</span>{!nodes.length && <button onClick={() => setEditing("new")}>新建笔记</button>}</div>}
    </div>
    {workspace && !editing && createPortal(<NotesWorkspace data={data} selected={selected} onSelect={setSelected} onClose={() => setWorkspace(false)} onData={onData} onEdit={(note) => setEditing(note)} onNew={() => setEditing("new")} onOpenAnnotation={(id) => { setWorkspace(false); onOpenAnnotation(id); }}/>, document.body)}
    {editing && createPortal(<SummaryNoteEditor key={editing === "new" ? "new" : editing.id} note={editing === "new" ? null : editing} data={data} onCancel={() => setEditing(null)} onSave={async (value) => { onData(await api.saveSummaryNote(value)); setEditing(null); }}/>, document.body)}
  </div>;
}

function ExpandedNote({ node, onData, onEdit, onOpenAnnotation }: {
  node: NoteNode; onData: (data: KnowledgeData) => void; onEdit: () => void; onOpenAnnotation: (id: UUID) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <section className="note-expanded" role="region" aria-label={`${node.kind === "note" ? "笔记" : "注释"}内容：${node.title}`}>
    {editing ? <div className="annotation-inline-editor">
      <textarea aria-label="注释正文" value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)}/>
      <div><button disabled={saving} onClick={() => setEditing(false)}>取消</button><button className="primary" disabled={saving} onClick={async () => {
        setSaving(true); setError("");
        try { onData(await api.updateAnnotation(node.id, draft)); setEditing(false); }
        catch (value) { setError(String(value)); }
        finally { setSaving(false); }
      }}>保存</button></div>
    </div> : node.body ? <MarkdownView markdown={node.body}/> : !node.quote && <p className="muted">暂无正文</p>}
    {node.quote && <blockquote className="knowledge-quote"><small>原文摘录</small>{node.quote}</blockquote>}
    {!editing && <div className="detail-actions">{node.kind === "note" ? <button onClick={onEdit}><FilePenLine size={13}/>编辑笔记</button> : <>
      <button onClick={() => { setDraft(node.body); setError(""); setEditing(true); }}>编辑注释</button>
      <button onClick={() => onOpenAnnotation(node.id)}><BookOpen size={13}/>定位原文</button>
    </>}</div>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}

function SummaryNoteEditor({
  note,
  data,
  onCancel,
  onSave
}: {
  note: SummaryNote | null;
  data: KnowledgeData;
  onCancel: () => void;
  onSave: (note: Partial<SummaryNote> & { title: string; content: string; annotationIDs: UUID[] }) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
  const [annotationIDs, setAnnotationIDs] = useState(new Set(note?.annotationIDs || []));
  const [preview, setPreview] = useState(Boolean(note));
  const ordered = useMemo(() => [...data.annotations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [data.annotations]);
  return (
    <div className="modal-backdrop">
      <section className="modal note-editor">
        <h2>{note ? "编辑笔记" : "新建笔记"}</h2>
        <div className="segmented narrow">
          <button className={preview ? "active" : ""} onClick={() => setPreview(true)}>预览</button>
          <button className={!preview ? "active" : ""} onClick={() => setPreview(false)}>编辑</button>
        </div>
        {preview ? (
          <div className="note-preview"><MarkdownView markdown={`# ${title}\n\n${content}`} /></div>
        ) : (
          <>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题" />
            <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="使用 Markdown 记录你的总结与思考…" />
          </>
        )}
        <h3>引用注释</h3>
        <label className="search-field"><Search size={14}/><input aria-label="搜索可引用注释" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索注释或原文…"/></label>
        <div className="annotation-picker">
          {ordered.filter((annotation) => { const document = data.documents.find((d) => d.id === annotation.documentId); return `${annotation.note} ${annotation.quote} ${document ? displayTitle(document) : ""}`.toLowerCase().includes(query.toLowerCase()); }).map((annotation) => {
            const document = data.documents.find((item) => item.id === annotation.documentId);
            return (
              <label key={annotation.id}>
                <input
                  type="checkbox"
                  checked={annotationIDs.has(annotation.id)}
                  onChange={(event) => {
                    const next = new Set(annotationIDs);
                    if (event.target.checked) next.add(annotation.id); else next.delete(annotation.id);
                    setAnnotationIDs(next);
                  }}
                />
                <span><strong>{document ? displayTitle(document) : "已删除文档"}</strong><small>{annotation.note || annotation.quote}</small></span>
              </label>
            );
          })}
        </div>
        <div className="modal-actions">
          {error && <p role="alert" className="error-text">{error}</p>}
          <button disabled={saving} onClick={onCancel}>取消</button>
          <button
            className="primary"
            disabled={!title.trim() || saving}
            onClick={async () => { setSaving(true); setError(""); try { await onSave({ id: note?.id, title: title.trim(), content, annotationIDs: [...annotationIDs] }); } catch (error) { setError(String(error)); } finally { setSaving(false); } }}
          >
            保存
          </button>
        </div>
      </section>
    </div>
  );
}

import { useMemo, useState } from "react";
import { FilePenLine, Highlighter, Link2, MessageSquareText, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import type { KnowledgeData, SummaryNote, UUID } from "../types";
import { displayTitle } from "../utils";
import MarkdownView from "./MarkdownView";

export default function NotesPanel({
  data,
  onData,
  onOpenAnnotation
}: {
  data: KnowledgeData;
  onData: (data: KnowledgeData) => void;
  onOpenAnnotation: (id: UUID) => void;
}) {
  const [editing, setEditing] = useState<SummaryNote | "new" | null>(null);
  const annotations = [...data.annotations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const notes = [...data.summaryNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="notes-panel">
      <div className="tree-title"><span>笔记系统</span><button className="icon-button" title="新建总结笔记" onClick={() => setEditing("new")}><Plus size={16} /></button></div>
      <div className="notes-scroll">
        <section>
          <h3>注释类笔记 · {annotations.length}</h3>
          {annotations.map((annotation) => {
            const document = data.documents.find((item) => item.id === annotation.documentId);
            return (
              <button className="note-list-row" key={annotation.id} onClick={() => onOpenAnnotation(annotation.id)}>
                {annotation.note ? <MessageSquareText size={15} className="green" /> : <Highlighter size={15} className="orange" />}
                <span>
                  <strong>{document ? displayTitle(document) : "已删除文档"}</strong>
                  <small>{annotation.note || annotation.quote}</small>
                </span>
                {annotation.page && <em>P{annotation.page}</em>}
              </button>
            );
          })}
        </section>
        <section>
          <h3>总结类笔记 · {notes.length}</h3>
          {notes.map((note) => (
            <div className="summary-note-row" key={note.id}>
              <button onClick={() => setEditing(note)}>
                <FilePenLine size={15} />
                <span>
                  <strong>{note.title}</strong>
                  <small>{note.content || "暂无正文"}{note.annotationIDs.length ? ` · 关联 ${note.annotationIDs.length} 条` : ""}</small>
                </span>
              </button>
              <button className="icon-button danger" title="删除" onClick={async () => {
                if (window.confirm(`删除总结笔记“${note.title}”？`)) onData(await api.deleteSummaryNote(note.id));
              }}><Trash2 size={14} /></button>
              {note.annotationIDs.slice(0, 3).map((id) => {
                const annotation = data.annotations.find((item) => item.id === id);
                return annotation ? (
                  <button className="linked-note" key={id} onClick={() => onOpenAnnotation(id)}>
                    <Link2 size={12} />{(annotation.note || annotation.quote).slice(0, 42)}
                  </button>
                ) : null;
              })}
            </div>
          ))}
        </section>
        {!annotations.length && !notes.length && <div className="empty-state"><FilePenLine size={28} /><strong>还没有笔记</strong></div>}
      </div>
      {editing && (
        <SummaryNoteEditor
          note={editing === "new" ? null : editing}
          data={data}
          onCancel={() => setEditing(null)}
          onSave={async (value) => {
            onData(await api.saveSummaryNote(value));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
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
  onSave: (note: Partial<SummaryNote> & { title: string; content: string; annotationIDs: UUID[] }) => void;
}) {
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
  const [annotationIDs, setAnnotationIDs] = useState(new Set(note?.annotationIDs || []));
  const [preview, setPreview] = useState(Boolean(note));
  const ordered = useMemo(() => [...data.annotations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [data.annotations]);
  return (
    <div className="modal-backdrop">
      <section className="modal note-editor">
        <h2>{note ? "编辑总结笔记" : "新建总结笔记"}</h2>
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
        <h3>关联注释类笔记</h3>
        <div className="annotation-picker">
          {ordered.map((annotation) => {
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
          <button onClick={onCancel}>取消</button>
          <button
            className="primary"
            disabled={!title.trim()}
            onClick={() => onSave({ id: note?.id, title: title.trim(), content, annotationIDs: [...annotationIDs] })}
          >
            保存
          </button>
        </div>
      </section>
    </div>
  );
}

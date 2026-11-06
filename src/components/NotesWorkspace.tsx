import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, FilePenLine, Link2, Network, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { api } from "../api";
import type { KnowledgeData, NoteSuggestions, SummaryNote } from "../types";
import { matchesNote, noteEdges, noteNodes, relatedKeys } from "../notes";
import type { NoteNode } from "../notes";
import MarkdownView from "./MarkdownView";
import NoteCard from "./NoteCard";
import NoteGraph from "./NoteGraph";

export default function NotesWorkspace({ data, selected, onSelect, onClose, onData, onEdit, onNew, onOpenAnnotation }: {
  data: KnowledgeData; selected: string | null; onSelect: (key: string | null) => void; onClose: () => void;
  onData: (data: KnowledgeData) => void; onEdit: (note: SummaryNote) => void; onNew: () => void; onOpenAnnotation: (id: string) => void;
}) {
  const nodes = useMemo(() => noteNodes(data), [data]);
  const edges = useMemo(() => noteEdges(data), [data]);
  const [query, setQuery] = useState("");
  const [transitive, setTransitive] = useState(true);
  const [onlyRelated, setOnlyRelated] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<(NoteSuggestions & { source: string }) | null>(null);
  const [editingAnnotation, setEditingAnnotation] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const node = nodes.find((n) => n.key === selected);
  const related = useMemo(() => relatedKeys(node?.key || null, edges, transitive), [node?.key, edges, transitive]);
  const direct = useMemo(() => relatedKeys(node?.key || null, edges, false), [node?.key, edges]);
  const visible = nodes.filter((n) => matchesNote(n, query) && (!onlyRelated || !node || related.has(n.key)));
  const visibleKeys = new Set(visible.map((n) => n.key));
  const visibleEdges = edges.filter((e) => visibleKeys.has(e.source) && visibleKeys.has(e.target));
  const currentSuggestions = suggestions?.source === node?.key ? suggestions : null;
  useEffect(() => {
    setLinking(false); setLinkQuery(""); setReason(""); setError(""); setEditingAnnotation(false);
  }, [selected]);
  useEffect(() => { if (selected && !nodes.some((n) => n.key === selected)) onSelect(null); }, [nodes, selected]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { if (linking) setLinking(false); else onClose(); } };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [linking, onClose]);

  async function toggleLink(target: string, linked: boolean, explanation = reason, origin: "manual" | "model" = "manual") {
    if (!node || busy) return;
    const source = node.key;
    setBusy(true); setError("");
    try {
      onData(await api.setNoteLink(source, target, linked, explanation, origin));
      setSuggestions((value) => value?.source === source ? { ...value, suggestions: value.suggestions.filter((s) => s.target !== target) } : value);
    } catch (error) { if (mounted.current && selectedRef.current === source) setError(String(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function findSuggestions() {
    if (!node || analyzing) return;
    const source = node.key; setAnalyzing(source); setError("");
    try {
      const value = await api.suggestNoteLinks(source);
      if (mounted.current && selectedRef.current === source) setSuggestions({ source, ...value });
    } catch (error) { if (mounted.current && selectedRef.current === source) setError(String(error)); }
    finally { if (mounted.current) setAnalyzing(null); }
  }
  async function deleteNode() {
    if (!node || !window.confirm(`删除这${node.kind === "note" ? "篇笔记" : "条注释"}及它的关联？`)) return;
    setBusy(true); setError("");
    try { onData(await (node.kind === "note" ? api.deleteSummaryNote(node.id) : api.deleteAnnotation(node.id))); onSelect(null); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop notes-workspace-backdrop"><section className="notes-workspace" role="dialog" aria-modal="true" aria-labelledby="notes-workspace-title">
    <header className="notes-workspace-header"><div><span className="workspace-emblem"><Network size={22}/></span><span><h2 id="notes-workspace-title">知识关联</h2><small>{nodes.length} 个知识节点 · {edges.length} 条关联</small></span></div><div><button onClick={onNew}><Plus size={15}/>新建笔记</button><button className="icon-button" title="关闭知识关联" onClick={onClose}><X size={20}/></button></div></header>
    <div className="notes-workspace-body">
      <aside className="knowledge-index"><label className="search-field"><Search size={15}/><input aria-label="搜索知识节点" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、正文、注释…"/></label><div className="index-count">{visible.length} 项{query && <button className="icon-button" title="清空知识搜索" onClick={() => setQuery("")}><X size={13}/></button>}</div><div className="note-card-list knowledge-index-scroll">{visible.map((n) => <NoteCard key={n.key} node={n} selected={n.key === selected} related={related.has(n.key) && n.key !== selected} dimmed={!!node && !related.has(n.key)} links={edges.filter((e) => e.source === n.key || e.target === n.key).length} onClick={() => onSelect(n.key)}/>)}{!visible.length && <p className="empty-search">没有匹配的笔记或注释</p>}</div></aside>
      <div className="knowledge-map"><div className="graph-toolbar"><span>{node ? <>已选中 <strong>{node.kind === "note" ? "笔记" : "注释"}</strong> · {Math.max(0, related.size - 1)} 项关联</> : "选择一个节点，查看它的知识连接"}</span><div>{node && <button className="icon-button" title="清除知识选择" onClick={() => onSelect(null)}><X size={14}/></button>}<select aria-label="关联高亮范围" value={transitive ? "all" : "direct"} onChange={(e) => setTransitive(e.target.value === "all")}><option value="all">全部关联链</option><option value="direct">直接关联</option></select><label><input type="checkbox" disabled={!node} checked={onlyRelated} onChange={(e) => setOnlyRelated(e.target.checked)}/>只看关联</label></div></div><NoteGraph nodes={visible} edges={visibleEdges} selected={node?.key || null} related={related} onSelect={onSelect}/></div>
      <aside className="knowledge-detail">{node ? <>
        <div className="detail-meta"><span>{node.kind === "note" ? "独立笔记" : "阅读注释"}</span><button className="icon-button danger" title="删除当前知识项" disabled={busy} onClick={() => void deleteNode()}><Trash2 size={15}/></button></div>
        <h2>{node.title}</h2><p className="detail-source">{node.source}{node.page ? ` · 第 ${node.page} 页` : ""}</p>
        <div className="detail-actions">{node.kind === "note" ? <button onClick={() => { const note = data.summaryNotes.find((n) => n.id === node.id); if (note) onEdit(note); }}><FilePenLine size={14}/>编辑笔记</button> : <><button onClick={() => onOpenAnnotation(node.id)}><BookOpen size={14}/>定位原文</button><button onClick={() => { setAnnotationDraft(node.body); setEditingAnnotation(true); }}>编辑注释</button></>}</div>
        {editingAnnotation ? <div className="annotation-inline-editor"><textarea aria-label="注释正文" value={annotationDraft} onChange={(e) => setAnnotationDraft(e.target.value)}/><div><button disabled={busy} onClick={() => setEditingAnnotation(false)}>取消</button><button className="primary" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { onData(await api.updateAnnotation(node.id, annotationDraft)); setEditingAnnotation(false); } catch (error) { setError(String(error)); } finally { setBusy(false); } }}>保存</button></div></div> : node.body ? <MarkdownView markdown={node.body} className="knowledge-body"/> : <p className="muted">还没有额外的文字笔记。</p>}
        {node.quote && <blockquote className="knowledge-quote"><small>原文摘录</small>{node.quote}</blockquote>}
        <section className="knowledge-links"><header><h3><Link2 size={14}/>直接关联 <small>{direct.size - 1}</small></h3><button className="icon-button" title="管理关联" onClick={() => setLinking(!linking)}><Plus size={16}/></button></header>
          {edges.filter((e) => e.source === node.key || e.target === node.key).map((edge) => { const other = nodes.find((n) => n.key === (edge.source === node.key ? edge.target : edge.source)); return other ? <div className="knowledge-link" key={edge.id}><button onClick={() => onSelect(other.key)}><strong>{other.title}</strong><small>{edge.origin === "model" ? "AI · " : ""}{edge.reason || "手动关联"}</small></button><button className="icon-button" title={`解除与${other.title}的关联`} disabled={busy} onClick={() => void toggleLink(other.key, false)}><X size={13}/></button></div> : null; })}
          {direct.size === 1 && <p className="muted">连接另一篇笔记或注释，让思考形成脉络。</p>}
          <button className="add-knowledge-link" onClick={() => setLinking(!linking)}><Plus size={14}/>手动建立关联</button>
          {linking && <div className="knowledge-link-picker"><label className="search-field"><Search size={13}/><input aria-label="搜索关联目标" value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} placeholder="搜索要关联的知识…"/></label><input aria-label="关联说明" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="关联说明（可选）" maxLength={400}/><div>{nodes.filter((n) => n.key !== node.key && matchesNote(n, linkQuery)).map((n) => <label key={n.key}><input type="checkbox" disabled={busy} checked={direct.has(n.key)} onChange={(e) => void toggleLink(n.key, e.target.checked)}/><span><strong>{n.title}</strong><small>{n.kind === "note" ? "笔记" : "注释"} · {n.source}</small></span></label>)}</div></div>}
        </section>
        <section className="knowledge-ai"><header><h3><Sparkles size={14}/>发现新连接</h3></header><p>使用已配置的 API，分析当前项与其他笔记、注释，给出关联理由，由你确认保存。</p><button disabled={!!analyzing || busy || nodes.length < 2} onClick={() => void findSuggestions()}><Sparkles size={14}/>{analyzing === node.key ? "正在分析…" : analyzing ? "另一项正在分析…" : "AI 建议关联"}</button>
          {currentSuggestions && <><small className="ai-scope">已分析 {currentSuggestions.candidateCount} / {currentSuggestions.totalCount} 个未关联候选</small>{currentSuggestions.suggestions.length ? currentSuggestions.suggestions.map((suggestion) => { const target = nodes.find((n) => n.key === suggestion.target); return target ? <div className="knowledge-suggestion" key={suggestion.target}><strong>{target.title}</strong><p>{suggestion.reason}</p><div><button disabled={busy} onClick={() => void toggleLink(target.key, true, suggestion.reason, "model")}><Link2 size={12}/>建立关联</button><button className="icon-button" title={`忽略${target.title}的建议`} onClick={() => setSuggestions((v) => v ? { ...v, suggestions: v.suggestions.filter((s) => s.target !== target.key) } : v)}><X size={13}/></button></div></div> : null; }) : <p className="muted">当前没有待确认的关联建议。</p>}</>}
        </section>
      </> : <div className="knowledge-welcome"><Network size={36}/><h2>让思考彼此连接</h2><p>选择左侧卡片或图谱节点，查看正文和关联。笔记、注释都可以连接；已有的引用关系会自动出现在图中。</p><button onClick={onNew}><Plus size={15}/>写下第一篇笔记</button></div>}
      {error && <p className="error-text" role="alert">{error}</p>}
      </aside>
    </div>
  </section></div>;
}

import { FilePenLine, Link2, MessageSquareText } from "lucide-react";
import type { NoteNode } from "../notes";

export default function NoteCard({ node, selected, related, dimmed, links, onClick, expanded }: {
  node: NoteNode; selected?: boolean; related?: boolean; dimmed?: boolean; links: number; onClick: () => void; expanded?: boolean;
}) {
  const date = new Date(node.updatedAt);
  return <button className={`note-card ${selected ? "selected" : ""} ${related ? "related" : ""} ${dimmed ? "dimmed" : ""}`} aria-pressed={!!selected} aria-expanded={expanded} onClick={onClick}>
    <div className="note-card-meta"><span>{node.kind === "note" ? <FilePenLine size={12}/> : <MessageSquareText size={12}/>} {node.kind === "note" ? "笔记" : "注释"}</span>{links > 0 && <span><Link2 size={11}/>{links}</span>}</div>
    <strong>{node.title}</strong>
    <p>{((node.kind === "annotation" ? node.quote || node.body : node.body) || "写下你的思考，连接新的知识。").replace(/[#*_`>]/g, "")}</p>
    <div className="note-card-footer"><span title={node.source}>{node.source}{node.page ? ` · P${node.page}` : ""}</span><time>{Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time></div>
  </button>;
}

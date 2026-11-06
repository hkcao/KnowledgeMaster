import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Maximize2, Minus, Plus, Quote } from "lucide-react";
import { layoutNotes } from "../notes";
import type { NoteEdge, NoteNode } from "../notes";

export default function NoteGraph({ nodes, edges, selected, related, onSelect }: {
  nodes: NoteNode[]; edges: NoteEdge[]; selected: string | null; related: Set<string>; onSelect: (key: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 650, height: 600 });
  const [camera, setCamera] = useState({ x: 325, y: 300, zoom: 1 });
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const signature = nodes.map((n) => n.key).join("|") + edges.map((e) => e.id).join("|");
  const layout = useMemo(() => layoutNotes(nodes, edges), [signature]);
  const fit = () => setCamera({ x: size.width / 2, y: size.height / 2, zoom: Math.min(1.2, (size.width - 80) / layout.width, (size.height - 80) / layout.height) });
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(fit, [size.width, size.height, signature]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      setCamera((current) => {
        const zoom = Math.max(0.08, Math.min(4, current.zoom * Math.exp(-event.deltaY * .0015)));
        return { zoom, x: x - (x - current.x) * zoom / current.zoom, y: y - (y - current.y) * zoom / current.zoom };
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  function zoomBy(factor: number) {
    setCamera((current) => {
      const zoom = Math.min(4, Math.max(.08, current.zoom * factor));
      return { zoom, x: size.width / 2 - (size.width / 2 - current.x) * zoom / current.zoom, y: size.height / 2 - (size.height / 2 - current.y) * zoom / current.zoom };
    });
  }
  return <div className="note-graph" ref={host}>
    <svg role="group" aria-label="笔记与注释关联图" width="100%" height="100%"
      onPointerDown={(event) => { if (event.button !== 0) return; drag.current = { x: event.clientX, y: event.clientY, originX: camera.x, originY: camera.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (drag.current) setCamera((current) => ({ ...current, x: drag.current!.originX + event.clientX - drag.current!.x, y: drag.current!.originY + event.clientY - drag.current!.y })); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
        {edges.map((edge) => {
          const from = layout.positions.get(edge.source), to = layout.positions.get(edge.target);
          if (!from || !to) return null;
          const highlighted = !selected || (related.has(edge.source) && related.has(edge.target));
          return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={`graph-edge ${highlighted ? "connected" : "dimmed"} ${edge.origin === "model" ? "model" : ""}`}><title>{edge.reason || "手动关联"}</title></line>;
        })}
        {nodes.map((node) => {
          const position = layout.positions.get(node.key)!;
          const active = node.key === selected;
          return <g key={node.key} transform={`translate(${position.x} ${position.y})`} role="button" tabIndex={0} aria-label={`${node.kind === "note" ? "笔记" : "注释"}：${node.title}`} aria-pressed={active}
            className={`graph-node ${node.kind} ${active ? "selected" : related.has(node.key) ? "related" : selected ? "dimmed" : ""}`}
            onPointerDown={(event) => event.stopPropagation()} onClick={() => onSelect(node.key)}
            onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); onSelect(node.key); } }}>
            <title>{node.title}</title><circle className="node-halo" r="34"/><circle className="node-disc" r="23"/>
            <g className="node-symbol">{node.kind === "note" ? <FileText x={-9} y={-9} width={18} height={18}/> : <Quote x={-9} y={-9} width={18} height={18}/>}</g>
            <text className="node-label" textAnchor="middle" y="47">{node.title.length > 10 ? `${node.title.slice(0, 10)}…` : node.title}</text>
          </g>;
        })}
      </g>
    </svg>
    <div className="graph-legend"><span><i className="note-dot"/>笔记</span><span><i className="annotation-dot"/>注释</span><span>滚轮缩放 · 拖动平移</span></div>
    <div className="graph-controls"><button className="icon-button" title="缩小图谱" onClick={() => zoomBy(.8)}><Minus size={16}/></button><small>{Math.round(camera.zoom * 100)}%</small><button className="icon-button" title="放大图谱" onClick={() => zoomBy(1.25)}><Plus size={16}/></button><button className="icon-button" title="适应全部节点" onClick={fit}><Maximize2 size={15}/></button></div>
  </div>;
}

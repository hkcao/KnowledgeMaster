import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import DOMPurify from "dompurify";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Download,
  Highlighter,
  ListTree,
  Maximize2,
  MessageSquareText,
  Minus,
  Plus,
  Quote,
  Sparkles,
  Underline,
  X
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { api, annotationsFor } from "../api";
import type {
  AnnotationKind,
  AnnotationRect,
  KnowledgeAnnotation,
  KnowledgeData,
  KnowledgeDocument,
  ReaderDocumentPayload,
  ReaderQuote,
  UUID
} from "../types";
import { displayTitle, fitPDFScale, formatBytes, normalizeAnnotationRects, pdfOutputScale, selectionToolbarPosition } from "../utils";
import MarkdownView from "./MarkdownView";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

interface Props {
  document?: KnowledgeDocument | null;
  data: KnowledgeData;
  focusedAnnotationId?: UUID | null;
  layoutRevision: number;
  onData: (data: KnowledgeData) => void;
  onAsk: (quote: ReaderQuote) => void;
}

interface SelectionState {
  text: string;
  page: number | null;
  rects: AnnotationRect[];
  x: number;
  y: number;
  imageBase64?: string;
}

interface OutlineEntry {
  id: string;
  title: string;
  level: number;
  page?: number;
  anchor?: string;
}

export default function Reader({ document, data, focusedAnnotationId, layoutRevision, onData, onAsk }: Props) {
  const [payload, setPayload] = useState<ReaderDocumentPayload | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [showOutline, setShowOutline] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [editing, setEditing] = useState<KnowledgeAnnotation | { selection: SelectionState } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [error, setError] = useState("");
  const [navigationPage, setNavigationPage] = useState<number | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const currentPageRef = useRef(0);

  useEffect(() => {
    setPayload(null);
    setSelection(null);
    setOutline([]);
    setNavigationPage(null);
    if (!document) return;
    api.documentPayload(document.id).then(setPayload).catch((value) => setError(String(value)));
  }, [document?.id]);

  useEffect(() => {
    if (!focusedAnnotationId) return;
    const annotation = data.annotations.find((item) => item.id === focusedAnnotationId);
    if (!annotation) return;
    if (annotation.page) setNavigationPage(annotation.page - 1);
    setEditing(annotation);
    setNoteDraft(annotation.note);
  }, [focusedAnnotationId]);

  useEffect(() => {
    if (!document || document.extension !== ".pdf") return;
    setNavigationPage(currentPageRef.current);
  }, [layoutRevision]);

  if (!document) {
    return <main className="reader-empty"><div className="empty-state"><Quote size={34} /><strong>选择一份资料</strong><span>导入或从左侧打开 PDF、Word、HTML、Markdown 和文本文件。</span></div></main>;
  }

  const annotations = annotationsFor(data, document.id);
  const bookmark = data.bookmarks.find((item) => item.documentId === document.id)?.pageIndex;

  async function addAnnotation(kind: AnnotationKind, note = "") {
    if (!selection) return;
    try {
      onData(await api.addAnnotation(document!.id, selection.text, selection.page, kind, note, selection.rects));
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (value) {
      setError(String(value));
    }
  }

  async function saveNote() {
    const value = noteDraft.trim();
    if (!value) return;
    try {
      if (editing && "selection" in editing) {
        const source = editing.selection;
        onData(await api.addAnnotation(document!.id, source.text, source.page, "note", value, source.rects));
        setSelection(null);
      } else if (editing) {
        onData(await api.updateAnnotation(editing.id, value));
      }
      setEditing(null);
      setNoteDraft("");
    } catch (value) {
      setError(String(value));
    }
  }

  function askSelection() {
    if (!selection) return;
    onAsk({
      text: selection.text,
      documentId: document!.id,
      documentName: displayTitle(document!),
      page: selection.page,
      imageBase64: selection.imageBase64
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  async function exportDocument(annotated: boolean) {
    const stem = document!.name.replace(/\.[^.]+$/, "");
    const ext = document!.name.split(".").pop() || "dat";
    const destination = await save({
      defaultPath: annotated ? `${stem}-带批注.${ext}` : document!.name,
      filters: [{ name: annotated ? "带批注文档" : "原文档", extensions: [ext] }]
    });
    if (!destination) return;
    try {
      await api.exportDocument(document!.id, destination, annotated);
    } catch (value) {
      setError(String(value));
    }
  }

  return (
    <main className="reader-shell" ref={readerRef}>
      <header className="reader-header">
        <div className="document-heading">
          <Quote size={18} />
          <span><strong>{displayTitle(document)}</strong><small>{formatBytes(document.size)}{document.pageCount ? ` · ${document.pageCount} 页` : ""}</small></span>
        </div>
        <button className={showOutline ? "active" : ""} onClick={() => setShowOutline(!showOutline)}><ListTree size={15} />目录</button>
        <details className="header-menu">
          <summary><Download size={15} />导出</summary>
          <div className="popover-menu right">
            <button onClick={() => exportDocument(false)}>导出原文档…</button>
            <button disabled={!annotations.length} onClick={() => exportDocument(true)}>导出带批注版本…</button>
          </div>
        </details>
        <button disabled={!annotations.length} onClick={() => setShowAnnotations(true)}>批注 {annotations.length}</button>
      </header>
      <div className="reader-content">
        {showOutline && (
          <aside className="outline-panel">
            <header><strong>文档目录</strong><button className="icon-button" onClick={() => setShowOutline(false)}><X size={15} /></button></header>
            <div>
              {outline.length ? outline.map((entry) => (
                <button
                  key={entry.id}
                  style={{ paddingLeft: 12 + Math.max(0, entry.level - 1) * 12 }}
                  onClick={() => {
                    if (entry.page != null) setNavigationPage(entry.page);
                    if (entry.anchor) window.document.getElementById(entry.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >{entry.title}</button>
              )) : <div className="empty-state small"><ListTree size={25} /><strong>未识别到目录</strong></div>}
            </div>
          </aside>
        )}
        <section className="document-viewport">
          {!payload ? <div className="loading-state">正在载入文档…</div> : payload.kind === "pdf" ? (
            <PDFReader
              documentId={document.id}
              base64={payload.content}
              annotations={annotations}
              bookmarkPage={bookmark}
              navigationPage={navigationPage}
              onNavigationComplete={() => setNavigationPage(null)}
              onOutline={setOutline}
              onSelection={setSelection}
              onCurrentPage={(value) => { currentPageRef.current = value; }}
              onBookmark={async (page) => onData(await api.toggleBookmark(document.id, page))}
              onAnnotation={(annotation) => { setEditing(annotation); setNoteDraft(annotation.note); }}
            />
          ) : (
            <TextReader
              payload={payload}
              annotations={annotations}
              onOutline={setOutline}
              onSelection={setSelection}
              onAnnotation={(annotation) => {
                setEditing(annotation);
                setNoteDraft(annotation.note);
              }}
            />
          )}
          {selection && (
            <div
              className="selection-toolbar"
              role="toolbar"
              aria-label="所选文字操作"
              style={{ left: selection.x, top: selection.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button onClick={askSelection}><Sparkles size={14} />Ask AI</button>
              <button onClick={askSelection}><Quote size={14} />引用</button>
              <i />
              <button onClick={() => addAnnotation("highlight")}><Highlighter size={14} />高亮</button>
              <button onClick={() => addAnnotation("underline")}><Underline size={14} />划线</button>
              <button onClick={() => { setEditing({ selection }); setNoteDraft(""); }}><MessageSquareText size={14} />笔记</button>
            </div>
          )}
        </section>
      </div>

      {editing && (
        <div className="modal-backdrop">
          <section className="modal annotation-editor">
            <h2>{"selection" in editing ? "添加笔记" : "编辑笔记"}</h2>
            <blockquote>{"selection" in editing ? editing.selection.text : editing.quote}</blockquote>
            <textarea autoFocus value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="记录你的理解、疑问或关联…" />
            <div className="modal-actions">
              {!Object.hasOwn(editing, "selection") && (
                <button className="danger" onClick={async () => {
                  onData(await api.deleteAnnotation((editing as KnowledgeAnnotation).id));
                  setEditing(null);
                }}>删除批注</button>
              )}
              <span />
              <button onClick={() => setEditing(null)}>取消</button>
              <button className="primary" disabled={!noteDraft.trim()} onClick={saveNote}>保存</button>
            </div>
          </section>
        </div>
      )}
      {showAnnotations && (
        <div className="modal-backdrop">
          <section className="modal compact">
            <h2>文档批注</h2>
            <div className="annotation-picker">
              {annotations.map((annotation) => (
                <button
                  key={annotation.id}
                  onClick={() => {
                    if (annotation.page) setNavigationPage(annotation.page - 1);
                    setEditing(annotation);
                    setNoteDraft(annotation.note);
                    setShowAnnotations(false);
                  }}
                >
                  <span>
                    <strong>{annotation.note || annotation.kind}</strong>
                    <small>{annotation.page ? `第 ${annotation.page} 页 · ` : ""}{annotation.quote}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="modal-actions"><button onClick={() => setShowAnnotations(false)}>完成</button></div>
          </section>
        </div>
      )}
      {error && <div className="toast error" onClick={() => setError("")}>{error}</div>}
    </main>
  );
}

function TextReader({
  payload,
  annotations,
  onOutline,
  onSelection,
  onAnnotation
}: {
  payload: ReaderDocumentPayload;
  annotations: KnowledgeAnnotation[];
  onOutline: (entries: OutlineEntry[]) => void;
  onSelection: (value: SelectionState | null) => void;
  onAnnotation: (annotation: KnowledgeAnnotation) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [annotationPositions, setAnnotationPositions] = useState<Array<{ annotation: KnowledgeAnnotation; top: number }>>([]);
  const markdown = payload.kind === "markdown";
  const headings = useMemo(() => {
    const source = payload.extractedText;
    return [...source.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match, index) => ({
      id: `heading-${index}`,
      title: match[2].replace(/\s+#+$/, ""),
      level: match[1].length,
      anchor: `reader-heading-${index}`
    }));
  }, [payload.extractedText]);
  useEffect(() => onOutline(headings), [headings]);
  useEffect(() => {
    const root = content.current;
    const container = host.current;
    if (!root || !container) return;
    const textNodes: Text[] = [];
    const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }
    const fullText = textNodes.map((value) => value.data).join("");
    const offsets: number[] = [];
    textNodes.reduce((total, value) => {
      offsets.push(total);
      return total + value.data.length;
    }, 0);
    const containerRect = container.getBoundingClientRect();
    const positions = annotations.flatMap((annotation) => {
      const start = fullText.indexOf(annotation.quote);
      if (start < 0) return [];
      const end = start + annotation.quote.length;
      const startIndex = textNodes.findIndex((value, index) => start >= offsets[index] && start <= offsets[index] + value.data.length);
      const endIndex = textNodes.findIndex((value, index) => end >= offsets[index] && end <= offsets[index] + value.data.length);
      if (startIndex < 0 || endIndex < 0) return [];
      const range = window.document.createRange();
      range.setStart(textNodes[startIndex], Math.min(start - offsets[startIndex], textNodes[startIndex].data.length));
      range.setEnd(textNodes[endIndex], Math.min(end - offsets[endIndex], textNodes[endIndex].data.length));
      const rect = range.getBoundingClientRect();
      return [{ annotation, top: rect.top - containerRect.top + container.scrollTop }];
    });
    setAnnotationPositions(positions);
  }, [payload.content, annotations]);

  function handleSelection() {
    const selected = window.getSelection();
    const text = selected?.toString().trim() || "";
    const root = content.current;
    const viewport = host.current?.closest(".document-viewport");
    if (!text || !root || !viewport || !selected?.rangeCount) return onSelection(null);
    const range = selected.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return onSelection(null);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    const rect = rects.at(-1);
    if (!rect) return onSelection(null);
    const parent = viewport.getBoundingClientRect();
    const position = selectionToolbarPosition(parent, rect);
    onSelection({
      text,
      page: null,
      rects: [],
      x: position.x,
      y: position.y
    });
  }

  return (
    <div className="text-reader" ref={host} onPointerUp={() => window.requestAnimationFrame(handleSelection)}>
      <div ref={content}>
        {payload.kind === "html" ? (
          <div className="html-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(payload.content, {
            FORBID_TAGS: ["script", "iframe", "object", "embed"],
            FORBID_ATTR: ["onerror", "onclick", "onload"]
          }) }} />
        ) : markdown ? (
          <MarkdownView markdown={payload.content} headingPrefix="reader-heading" />
        ) : (
          <pre>{payload.content}</pre>
        )}
      </div>
      {annotationPositions.map(({ annotation, top }) => (
        <button
          key={annotation.id}
          className="text-annotation-chip"
          style={{ top }}
          title={annotation.note || annotation.quote}
          onClick={() => onAnnotation(annotation)}
        ><MessageSquareText size={14} /></button>
      ))}
    </div>
  );
}

function PDFReader({
  base64,
  annotations,
  bookmarkPage,
  navigationPage,
  onNavigationComplete,
  onOutline,
  onSelection,
  onCurrentPage,
  onBookmark,
  onAnnotation
}: {
  documentId: UUID;
  base64: string;
  annotations: KnowledgeAnnotation[];
  bookmarkPage?: number;
  navigationPage: number | null;
  onNavigationComplete: () => void;
  onOutline: (entries: OutlineEntry[]) => void;
  onSelection: (value: SelectionState | null) => void;
  onCurrentPage: (page: number) => void;
  onBookmark: (page: number) => void;
  onAnnotation: (annotation: KnowledgeAnnotation) => void;
}) {
  const [pdf, setPDF] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [zoom, setZoom] = useState(1.2);
  const [renderZoom, setRenderZoom] = useState(1.2);
  const [showZoom, setShowZoom] = useState(false);
  const [fitMode, setFitMode] = useState(false);
  const [renderedPages, setRenderedPages] = useState<Set<number>>(() => new Set([0, 1]));
  const zoomRef = useRef(1.2);
  const fitModeRef = useRef(false);
  const visiblePageRef = useRef(0);
  const zoomFrame = useRef<number | null>(null);
  const renderTimer = useRef<number | null>(null);
  const zoomLabelTimer = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => () => {
    if (zoomFrame.current) window.cancelAnimationFrame(zoomFrame.current);
    if (renderTimer.current) window.clearTimeout(renderTimer.current);
    if (zoomLabelTimer.current) window.clearTimeout(zoomLabelTimer.current);
  }, []);

  function applyZoom(nextValue: number, adaptive: boolean) {
    const next = Math.min(4, Math.max(0.55, nextValue));
    zoomRef.current = next;
    fitModeRef.current = adaptive;
    setFitMode(adaptive);
    if (zoomFrame.current == null) {
      zoomFrame.current = window.requestAnimationFrame(() => {
        setZoom(zoomRef.current);
        setShowZoom(true);
        zoomFrame.current = null;
      });
    }
    if (renderTimer.current) window.clearTimeout(renderTimer.current);
    if (zoomLabelTimer.current) window.clearTimeout(zoomLabelTimer.current);
    renderTimer.current = window.setTimeout(() => setRenderZoom(zoomRef.current), 220);
    zoomLabelTimer.current = window.setTimeout(() => setShowZoom(false), 850);
  }

  function changeZoom(change: (current: number) => number) {
    applyZoom(change(zoomRef.current), false);
  }

  function fitToArea() {
    const target = scroller.current;
    const page = pages[visiblePageRef.current] || pages[0];
    if (!target || !page) return;
    const style = window.getComputedStyle(target);
    const availableWidth = target.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const viewport = page.getViewport({ scale: 1 });
    applyZoom(fitPDFScale(availableWidth, viewport.width), true);
  }

  useEffect(() => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const task = pdfjs.getDocument({ data: bytes });
    task.promise.then(async (value) => {
      setPDF(value);
      const loaded = await Promise.all(Array.from({ length: value.numPages }, (_, index) => value.getPage(index + 1)));
      setPages(loaded);
      setRenderedPages(new Set([0, 1].filter((index) => index < loaded.length)));
      const raw = await value.getOutline();
      const entries: OutlineEntry[] = [];
      async function walk(items: typeof raw, level: number) {
        for (const item of items || []) {
          let page: number | undefined;
          if (item.dest) {
            const destination = typeof item.dest === "string" ? await value.getDestination(item.dest) : item.dest;
            if (destination?.[0]) page = await value.getPageIndex(destination[0]);
          }
          entries.push({ id: `${entries.length}-${item.title}`, title: item.title, level, page });
          await walk(item.items, level + 1);
        }
      }
      await walk(raw, 1);
      onOutline(entries.length ? entries : loaded.map((_, index) => ({ id: `page-${index}`, title: `第 ${index + 1} 页`, level: 1, page: index })));
      window.setTimeout(() => {
        if (bookmarkPage != null) pageRefs.current.get(bookmarkPage)?.scrollIntoView({ block: "start" });
      }, 150);
    });
    return () => { task.destroy(); };
  }, [base64]);

  useEffect(() => {
    if (navigationPage == null) return;
    pageRefs.current.get(navigationPage)?.scrollIntoView({ behavior: "smooth", block: "start" });
    onNavigationComplete();
  }, [navigationPage, pages.length]);

  useEffect(() => {
    const target = scroller.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const page = visible ? Number((visible.target as HTMLElement).dataset.page) - 1 : null;
        if (page != null && page >= 0) {
          visiblePageRef.current = page;
          onCurrentPage(page);
        }
      },
      { root: target, threshold: [0.25, 0.5, 0.75] }
    );
    pageRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pages.length]);

  useEffect(() => {
    const target = scroller.current;
    if (!target) return;
    const observer = new IntersectionObserver((entries) => {
      setRenderedPages((current) => {
        const next = new Set(current);
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page) - 1;
          if (entry.isIntersecting) next.add(page); else next.delete(page);
        }
        if (next.size === current.size && [...next].every((page) => current.has(page))) return current;
        return next;
      });
    }, { root: target, rootMargin: "900px 0px", threshold: 0 });
    pageRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pages.length]);

  useEffect(() => {
    const target = scroller.current;
    if (!target || !pages.length) return;
    const observer = new ResizeObserver(() => {
      if (fitModeRef.current) fitToArea();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [pages]);

  useEffect(() => {
    const target = scroller.current;
    if (!target) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const delta = Math.max(-100, Math.min(100, event.deltaY));
      changeZoom((value) => value * Math.exp(-delta * 0.0025));
    };
    target.addEventListener("wheel", wheel, { passive: false });
    return () => target.removeEventListener("wheel", wheel);
  }, []);

  function captureSelection() {
    const selected = window.getSelection();
    const text = selected?.toString().trim() || "";
    if (!text || !selected?.rangeCount || !scroller.current) return onSelection(null);
    const range = selected.getRangeAt(0);
    if (!scroller.current.contains(range.startContainer) || !scroller.current.contains(range.endContainer)) {
      return onSelection(null);
    }
    const clientRects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    const last = clientRects.at(-1);
    if (!last) return onSelection(null);
    const rects: AnnotationRect[] = [];
    let targetPage: number | null = null;
    for (const [index, element] of pageRefs.current.entries()) {
      const pageRect = element.getBoundingClientRect();
      const viewport = pages[index]?.getViewport({ scale: zoom });
      if (!viewport) continue;
      for (const rect of clientRects) {
        const left = Math.max(rect.left, pageRect.left);
        const right = Math.min(rect.right, pageRect.right);
        const top = Math.max(rect.top, pageRect.top);
        const bottom = Math.min(rect.bottom, pageRect.bottom);
        if (right <= left || bottom <= top) continue;
        const [x1, y1] = viewport.convertToPdfPoint(left - pageRect.left, top - pageRect.top);
        const [x2, y2] = viewport.convertToPdfPoint(right - pageRect.left, bottom - pageRect.top);
        rects.push({ page: index + 1, x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
        targetPage ??= index + 1;
      }
    }
    const host = scroller.current.getBoundingClientRect();
    const position = selectionToolbarPosition(host, last);
    const normalizedRects = normalizeAnnotationRects(rects);
    if (!normalizedRects.length) return onSelection(null);
    onSelection({
      text,
      page: targetPage,
      rects: normalizedRects,
      x: position.x,
      y: position.y,
      imageBase64: snapshotSelection(normalizedRects, pages, pageRefs.current, zoom)
    });
  }

  return (
    <div className="pdf-reader">
      <div className="pdf-controls">
        <button className="icon-button" title="缩小" onClick={() => changeZoom((value) => value - 0.1)}><Minus size={15} /></button>
        <button className={`icon-button pdf-fit-button ${fitMode ? "active" : ""}`} title="适合窗口宽度" onClick={fitToArea}><Maximize2 size={14} /><span>适合</span></button>
        <button className="icon-button" title="放大" onClick={() => changeZoom((value) => value + 0.1)}><Plus size={15} /></button>
      </div>
      {showZoom && <div className="pdf-zoom-indicator" role="status">{Math.round(zoom * 100)}%</div>}
      <div className="pdf-scroller" ref={scroller} onPointerUp={() => window.requestAnimationFrame(captureSelection)}>
        {pdf && pages.map((page, index) => (
          <PDFPage
            key={index}
            page={page}
            index={index}
            displayZoom={zoom}
            renderZoom={renderZoom}
            active={renderedPages.has(index)}
            annotations={annotations.filter((annotation) => annotation.page === index + 1)}
            bookmarked={bookmarkPage === index}
            pageRef={(element) => {
              if (element) pageRefs.current.set(index, element); else pageRefs.current.delete(index);
            }}
            onBookmark={() => onBookmark(index)}
            onAnnotation={onAnnotation}
          />
        ))}
      </div>
    </div>
  );
}

function PDFPage({
  page,
  index,
  displayZoom,
  renderZoom,
  active,
  annotations,
  bookmarked,
  pageRef,
  onBookmark,
  onAnnotation
}: {
  page: PDFPageProxy;
  index: number;
  displayZoom: number;
  renderZoom: number;
  active: boolean;
  annotations: KnowledgeAnnotation[];
  bookmarked: boolean;
  pageRef: (element: HTMLDivElement | null) => void;
  onBookmark: () => void;
  onAnnotation: (annotation: KnowledgeAnnotation) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const displayViewport = page.getViewport({ scale: displayZoom });
  const renderViewport = page.getViewport({ scale: renderZoom });
  const transientScale = displayZoom / renderZoom;

  useEffect(() => {
    if (!active) return;
    const target = canvas.current;
    const textContainer = textLayer.current;
    if (!target || !textContainer) return;
    const ratio = pdfOutputScale(window.devicePixelRatio || 1, /Windows/i.test(navigator.userAgent));
    target.width = Math.ceil(renderViewport.width * ratio);
    target.height = Math.ceil(renderViewport.height * ratio);
    target.style.width = `${renderViewport.width}px`;
    target.style.height = `${renderViewport.height}px`;
    const context = target.getContext("2d")!;
    const render = page.render({ canvas: target, canvasContext: context, viewport: renderViewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
    textContainer.replaceChildren();
    textContainer.style.setProperty("--total-scale-factor", String(renderZoom));
    const selectableText = new pdfjs.TextLayer({
      textContentSource: page.streamTextContent({
        includeMarkedContent: true,
        disableNormalization: true
      }),
      container: textContainer,
      viewport: renderViewport
    });
    selectableText.render().catch((reason) => {
      if (reason?.name !== "AbortException") console.error("PDF text layer failed:", reason);
    });
    return () => {
      render.cancel();
      selectableText.cancel();
      textContainer.replaceChildren();
    };
  }, [active, page, renderZoom]);

  return (
    <div
      className="pdf-page"
      data-page={index + 1}
      ref={pageRef}
      style={{ width: displayViewport.width, height: displayViewport.height }}
    >
      {active && <div
        className={`pdf-page-content ${transientScale === 1 ? "" : "zooming"}`}
        style={{ width: renderViewport.width, height: renderViewport.height, transform: `scale(${transientScale})` }}
      >
        <canvas ref={canvas} />
        <div ref={textLayer} className="pdf-text-layer" />
        <div className="pdf-annotation-layer">
        {annotations.flatMap((annotation) => annotation.rects.map((rect, rectIndex) => {
          const [x1, y1] = renderViewport.convertToViewportPoint(rect.x, rect.y);
          const [x2, y2] = renderViewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
          const left = Math.min(x1, x2);
          const top = Math.min(y1, y2);
          const width = Math.abs(x2 - x1);
          const height = Math.abs(y2 - y1);
          return (
            <button
              type="button"
              key={`${annotation.id}-${rectIndex}`}
              className={`pdf-annotation ${annotation.kind}`}
              style={{ left, top, width, height }}
              title={annotation.note || annotation.quote}
              aria-label={`打开${annotation.kind === "underline" ? "划线" : "高亮"}批注`}
              onClick={(event) => {
                event.stopPropagation();
                onAnnotation(annotation);
              }}
              onPointerUp={(event) => event.stopPropagation()}
            />
          );
        }))}
        {annotations.filter((annotation) => annotation.note && annotation.rects.length).map((annotation) => {
          const last = annotation.rects.at(-1)!;
          const points = renderViewport.convertToViewportPoint(last.x + last.width, last.y);
          return (
            <button
              key={`bubble-${annotation.id}`}
              className="annotation-bubble"
              style={{ top: Math.max(8, points[1] - 12), right: 8 }}
              title={annotation.note}
              onClick={() => onAnnotation(annotation)}
            ><MessageSquareText size={15} /></button>
          );
        })}
        </div>
      </div>}
      <button className={`bookmark-ribbon ${bookmarked ? "active" : ""}`} title={bookmarked ? "取消本页书签" : "将本页设为书签"} onClick={onBookmark}><Bookmark size={17} /></button>
    </div>
  );
}

function snapshotSelection(
  rects: AnnotationRect[],
  pages: PDFPageProxy[],
  pageElements: Map<number, HTMLDivElement>,
  zoom: number
): string | undefined {
  const first = rects[0];
  if (!first) return undefined;
  const element = pageElements.get(first.page - 1);
  const source = element?.querySelector("canvas");
  const page = pages[first.page - 1];
  if (!element || !source || !page) return undefined;
  const viewport = page.getViewport({ scale: zoom });
  const related = rects.filter((rect) => rect.page === first.page);
  const boxes = related.map((rect) => {
    const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y);
    const [x2, y2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
    return [x1, y1, x2, y2];
  });
  const padding = 18;
  const left = Math.max(0, Math.min(...boxes.flatMap((box) => [box[0], box[2]])) - padding);
  const top = Math.max(0, Math.min(...boxes.flatMap((box) => [box[1], box[3]])) - padding);
  const right = Math.min(viewport.width, Math.max(...boxes.flatMap((box) => [box[0], box[2]])) + padding);
  const bottom = Math.min(viewport.height, Math.max(...boxes.flatMap((box) => [box[1], box[3]])) + padding);
  const ratio = source.width / viewport.width;
  const output = window.document.createElement("canvas");
  output.width = Math.max(1, Math.round((right - left) * ratio));
  output.height = Math.max(1, Math.round((bottom - top) * ratio));
  output.getContext("2d")?.drawImage(
    source,
    left * ratio,
    top * ratio,
    (right - left) * ratio,
    (bottom - top) * ratio,
    0,
    0,
    output.width,
    output.height
  );
  return output.toDataURL("image/png").split(",")[1];
}

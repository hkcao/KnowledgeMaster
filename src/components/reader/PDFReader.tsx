import { useEffect, useRef, useState, useCallback, forwardRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { KnowledgeAnnotation, ReaderSelection } from "../../types/models";

// Set PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs`;

interface PDFReaderProps {
  bytes: Uint8Array;
  annotations: KnowledgeAnnotation[];
  bookmarkPage?: number | null;
  onSelection: (sel: ReaderSelection | null) => void;
  onPageChange: (page: number) => void;
  onAnnotationClick: (id: string) => void;
  focusedAnnotationId?: string | null;
}

interface PageViewport {
  width: number;
  height: number;
}

export function PDFReader({
  bytes, annotations, bookmarkPage, onSelection,
  onPageChange, onAnnotationClick, focusedAnnotationId,
}: PDFReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Load PDF
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
        if (cancelled) return;
        setPdf(doc);
        setNumPages(doc.numPages);
        const initPage = bookmarkPage ? bookmarkPage + 1 : 1;
        setCurrentPage(Math.min(initPage, doc.numPages));
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [bytes]);

  // Focus annotation
  useEffect(() => {
    if (focusedAnnotationId && annotations.length > 0) {
      const ann = annotations.find((a) => a.id === focusedAnnotationId);
      if (ann?.page) {
        setCurrentPage(ann.page);
        const pageKey = ann.page;
        setTimeout(() => {
          const el = pageRefs.current.get(pageKey);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
    }
  }, [focusedAnnotationId, annotations]);

  // Scroll to bookmark on first load
  useEffect(() => {
    if (pdf && bookmarkPage != null) {
      const pageKey = bookmarkPage + 1;
      setTimeout(() => {
        const el = pageRefs.current.get(pageKey);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    }
  }, [pdf, bookmarkPage]);

  // Track visible page
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0;
        let bestPage = currentPage;
        for (const entry of entries) {
          const pageNum = parseInt(entry.target.getAttribute("data-page") || "0");
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            bestPage = pageNum;
          }
        }
        if (maxRatio > 0.3) {
          onPageChange(bestPage - 1);
        }
      },
      { threshold: [0.1, 0.3, 0.5, 0.7, 0.9] }
    );
    for (const [_, el] of pageRefs.current) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [numPages, pdf]);

  const handleTextSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      onSelection(null);
      return;
    }
    const text = sel.toString().trim().slice(0, 4000);
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();

    // Find which page the selection is in
    let pageNum: number | undefined;
    let node: Node | null = range.startContainer;
    while (node) {
      if (node instanceof HTMLElement) {
        const dp = node.getAttribute("data-page");
        if (dp) { pageNum = parseInt(dp); break; }
      }
      node = node.parentNode;
    }

    onSelection({
      text,
      page: pageNum,
      rects: [{
        page: pageNum || 1,
        x: rect.left - (containerRect?.left || 0),
        y: rect.top - (containerRect?.top || 0),
        width: rect.width,
        height: rect.height,
      }],
      anchor_x: rect.right - (containerRect?.left || 0),
      anchor_y: rect.bottom - (containerRect?.top || 0),
    });
  }, [onSelection]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-secondary">
        <div className="text-center">
          <div className="animate-spin text-2xl mb-2">⏳</div>
          <p>正在加载 PDF…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500">
        <p>PDF 加载失败：{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-2 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)]">
        <button
          onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
          className="px-2 py-1 text-sm border border-[var(--color-border)] rounded hover:bg-[var(--color-hover)]"
          title="缩小"
        >−</button>
        <span className="text-xs text-secondary min-w-[48px] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={() => setScale((s) => Math.min(4, s + 0.25))}
          className="px-2 py-1 text-sm border border-[var(--color-border)] rounded hover:bg-[var(--color-hover)]"
          title="放大"
        >+</button>
        <div className="flex-1" />
        <span className="text-xs text-secondary">
          {currentPage} / {numPages}
        </span>
        <input
          type="number"
          min={1}
          max={numPages}
          value={currentPage}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            if (v >= 1 && v <= numPages) {
              setCurrentPage(v);
              const el = pageRefs.current.get(v);
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }}
          className="w-[50px] px-1.5 py-0.5 text-xs text-center border border-[var(--color-border)] rounded bg-[var(--color-bg)]"
        />
      </div>

      {/* Pages */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto px-2 py-3 bg-[var(--color-reader-bg)]"
        onMouseUp={handleTextSelection}
      >
        <div className="flex flex-col items-center gap-3">
          {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
            <PDFPage
              key={pageNum}
              pdf={pdf!}
              pageNum={pageNum}
              scale={scale}
              annotations={annotations.filter((a) => {
                return a.page === pageNum || a.rects.some((r) => r.page === pageNum);
              })}
              onAnnotationClick={onAnnotationClick}
              ref={(el) => {
                if (el) pageRefs.current.set(pageNum, el as HTMLDivElement);
                else pageRefs.current.delete(pageNum);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const PDFPage = forwardRef<HTMLDivElement, {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageNum: number;
  scale: number;
  annotations: KnowledgeAnnotation[];
  onAnnotationClick: (id: string) => void;
}>(({ pdf, pageNum, scale, annotations, onAnnotationClick }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      const page = await pdf.getPage(pageNum);
      const vp = page.getViewport({ scale });
      if (cancelled) return;
      setViewport({ width: vp.width, height: vp.height });

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      canvas.width = vp.width;
      canvas.height = vp.height;

      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      // Render text layer
      const textContent = await page.getTextContent();
      if (cancelled || !textLayerRef.current) return;

      const textLayer = textLayerRef.current;
      textLayer.innerHTML = "";

      const tx = vp.width / vp.width;
      const ty = vp.height / vp.height;

      for (const item of textContent.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const tx1 = item.transform;
        const div = document.createElement("span");
        div.textContent = item.str;
        div.style.position = "absolute";
        div.style.left = `${tx1[4] * tx}px`;
        div.style.top = `${(vp.height - tx1[5] - (item as any).height * ty) * ty}px`;
        div.style.fontSize = `${(item as any).height * 0.9 * tx}px`;
        div.style.color = "transparent";
        div.style.pointerEvents = "auto";
        div.style.cursor = "text";
        div.style.userSelect = "text";
        div.setAttribute("data-page", String(pageNum));
        textLayer.appendChild(div);
      }
      setRendered(true);
    }
    render();
    return () => { cancelled = true; };
  }, [pdf, pageNum, scale]);

  return (
    <div
      ref={ref}
      data-page={pageNum}
      className="pdf-page bg-white shadow-md relative"
      style={{ width: viewport?.width || "auto", minHeight: viewport?.height || 200 }}
    >
      <canvas ref={canvasRef} className="block" />
      <div
        ref={textLayerRef}
        className="absolute inset-0 overflow-hidden"
        style={{ mixBlendMode: "multiply" }}
      />
      {/* Annotation overlay */}
      {rendered && annotations.map((ann) => (
        <div key={ann.id}>
          {ann.rects.filter((r) => r.page === pageNum).map((rect, i) => (
            <div
              key={i}
              onClick={() => onAnnotationClick(ann.id)}
              className="absolute cursor-pointer opacity-40 hover:opacity-60 transition-opacity"
              style={{
                left: rect.x * (viewport!.width / (rect.width / scale)),
                top: rect.y,
                width: rect.width,
                height: Math.max(rect.height, 4),
                backgroundColor: ann.kind === "underline"
                  ? "#8B4513"
                  : ann.kind === "note"
                  ? "#228B22"
                  : "#FFD700",
                borderBottom: ann.kind === "underline" ? "2px solid #8B4513" : undefined,
                borderRadius: ann.kind === "highlight" ? "1px" : undefined,
              }}
              title={ann.note || ann.quote.slice(0, 50)}
            />
          ))}
        </div>
      ))}
    </div>
  );
});

PDFPage.displayName = "PDFPage";

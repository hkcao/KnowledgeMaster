import { useState } from "react";
import { useStore } from "../../state/store";
import type { KnowledgeAnnotation, ReaderSelection } from "../../types/models";

export function ReaderPane() {
  const {
    currentDocument, extractedContent, documentBytes, outlineEntries,
    readerSelection, setReaderSelection,
    addAnnotation, quote, setQuote,
  } = useStore();

  const [noteText, setNoteText] = useState("");
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [bookmarkPage, setBookmarkPage] = useState<number | null>(null);

  if (!currentDocument) {
    return (
      <div className="flex items-center justify-center h-full text-secondary">
        <div className="text-center">
          <p className="text-lg mb-2">📖</p>
          <p>选择一份资料开始阅读</p>
          <p className="text-xs mt-1">导入或从左侧打开 PDF、Word、HTML、Markdown 和文本文件</p>
        </div>
      </div>
    );
  }

  const isPDF = currentDocument.extension === ".pdf";
  const annotations = useStore.getState().data?.annotations?.filter(
    (a) => a.document_id === currentDocument?.id
  ) || [];

  const handleAskAI = (sel: ReaderSelection) => {
    const quoteData = {
      text: sel.text,
      document_id: currentDocument?.id,
      document_name: currentDocument?.display_name?.trim() || currentDocument.name,
      page: sel.page,
    };
    setQuote(quoteData);
  };

  const handleAddAnnotation = (sel: ReaderSelection, kind: string) => {
    if (currentDocument) {
      addAnnotation(currentDocument.id, sel, kind);
      setReaderSelection(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-[var(--color-border)]">
        <span className="text-sm font-semibold truncate">
          {currentDocument.display_name?.trim() || currentDocument.name}
        </span>
        <span className="text-xs text-secondary">
          {currentDocument.page_count ? `${currentDocument.page_count} 页` : ""}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setShowOutline(!showOutline)}
          className="px-2 py-1 text-xs border border-[var(--color-border)] rounded hover:bg-[var(--color-hover)]"
        >
          {showOutline ? "收起目录" : "目录"}
        </button>
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {showOutline && outlineEntries.length > 0 && (
          <div className="w-[220px] border-r border-[var(--color-border)] bg-[var(--color-sidebar)] overflow-y-auto flex-shrink-0">
            <div className="px-3 py-2 text-xs font-semibold text-secondary">文档目录</div>
            {outlineEntries.map((entry) => (
              <button
                key={entry.id}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--color-hover)]"
                style={{ paddingLeft: `${12 + (entry.level - 1) * 12}px` }}
              >
                {entry.title}
              </button>
            ))}
          </div>
        )}

        {/* Reader content */}
        <div className="flex-1 overflow-auto relative bg-[var(--color-reader-bg)]">
          {isPDF ? (
            <div className="p-4">
              <p className="text-center text-sm text-secondary mb-4">
                PDF 阅读器 — 使用 PDF.js 渲染
              </p>
              {documentBytes ? (
                <PDFReaderContent
                  bytes={documentBytes}
                  annotations={annotations}
                  onSelection={setReaderSelection}
                />
              ) : (
                <p className="text-center text-secondary">加载中…</p>
              )}
            </div>
          ) : (
            <div className="max-w-[900px] mx-auto p-8">
              <RichTextContent
                content={extractedContent?.text || ""}
                extension={currentDocument.extension}
                annotations={annotations}
              />
            </div>
          )}
        </div>
      </div>

      {/* Selection toolbar */}
      {readerSelection && (
        <div
          className="selection-toolbar"
          style={{
            left: `${Math.max(0, (readerSelection.anchor_x || 200) - 200)}px`,
            top: `${Math.max(20, (readerSelection.anchor_y || 100) - 40)}px`,
          }}
        >
          <button
            onClick={() => handleAskAI(readerSelection)}
            className="px-2 py-1 text-xs rounded hover:bg-[var(--color-hover)]"
          >
            ✨ Ask AI
          </button>
          <button
            onClick={() => handleAskAI(readerSelection)}
            className="px-2 py-1 text-xs rounded hover:bg-[var(--color-hover)]"
          >
            引用
          </button>
          <div className="w-px bg-[var(--color-border)] mx-1" />
          <button
            onClick={() => handleAddAnnotation(readerSelection, "highlight")}
            className="px-2 py-1 text-xs rounded hover:bg-yellow-100"
          >
            高亮
          </button>
          <button
            onClick={() => handleAddAnnotation(readerSelection, "underline")}
            className="px-2 py-1 text-xs rounded hover:bg-[var(--color-hover)]"
          >
            划线
          </button>
          <button
            onClick={() => {
              setNoteText("");
              setShowNoteEditor(true);
            }}
            className="px-2 py-1 text-xs rounded hover:bg-green-100"
          >
            笔记
          </button>
        </div>
      )}

      {/* Note editor modal */}
      {showNoteEditor && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-50" onClick={() => setShowNoteEditor(false)}>
          <div className="bg-[var(--color-bg)] rounded-lg shadow-xl p-6 w-[480px]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3">添加笔记</h2>
            <div className="p-3 bg-[var(--color-bg-secondary)] rounded mb-3 text-sm text-secondary max-h-[120px] overflow-y-auto">
              {readerSelection?.text}
            </div>
            <textarea
              className="w-full h-[150px] px-3 py-2 border border-[var(--color-border)] rounded resize-none text-sm"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setShowNoteEditor(false)} className="px-4 py-2 text-sm">取消</button>
              <button
                onClick={() => {
                  if (readerSelection && noteText.trim()) {
                    handleAddAnnotation(readerSelection, "note");
                    // Note: Need to save the note text separately
                    // For simplicity, just create highlight for now
                  }
                  setShowNoteEditor(false);
                  setReaderSelection(null);
                }}
                className="px-4 py-2 bg-[var(--color-accent)] text-white rounded-md text-sm"
                disabled={!noteText.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PDFReaderContent({
  bytes, annotations, onSelection,
}: {
  bytes: Uint8Array;
  annotations: KnowledgeAnnotation[];
  onSelection: (sel: ReaderSelection | null) => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <p className="text-xs text-secondary mb-4">
        PDF 已加载（{Math.round(bytes.length / 1024)} KB）— 完整 PDF.js 渲染待集成
      </p>
      <p className="text-xs text-secondary">
        批注数：{annotations.length}
      </p>
    </div>
  );
}

function RichTextContent({
  content, extension, annotations,
}: {
  content: string;
  extension: string;
  annotations: KnowledgeAnnotation[];
}) {
  if (!content) {
    return <p className="text-secondary text-center">文档内容为空</p>;
  }

  if ([".html", ".htm"].includes(extension)) {
    return (
      <div
        className="prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
      />
    );
  }

  // For MD and TXT, render as plain text with basic formatting
  const lines = content.split("\n");
  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap">
      {lines.map((line, i) => (
        <div key={i} className="min-h-[1.5em]">
          {line.startsWith("# ") ? (
            <h1 className="text-xl font-bold mt-4 mb-2">{line.slice(2)}</h1>
          ) : line.startsWith("## ") ? (
            <h2 className="text-lg font-bold mt-3 mb-1.5">{line.slice(3)}</h2>
          ) : line.startsWith("### ") ? (
            <h3 className="text-base font-bold mt-2 mb-1">{line.slice(4)}</h3>
          ) : (
            <span>{line || " "}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/javascript:/gi, "");
}

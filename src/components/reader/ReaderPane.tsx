import { useState, useEffect } from "react";
import { useStore } from "../../state/store";
import { PDFReader } from "./PDFReader";
import type { KnowledgeAnnotation, ReaderSelection } from "../../types/models";

export function ReaderPane() {
  const {
    currentDocument, extractedContent, documentBytes, outlineEntries,
    readerSelection, setReaderSelection,
    addAnnotation, updateAnnotation, deleteAnnotation,
    quote, setQuote, data,
  } = useStore();

  const [noteText, setNoteText] = useState("");
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [editingAnnotation, setEditingAnnotation] = useState<KnowledgeAnnotation | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [bookmarkPage, setBookmarkPage] = useState<number | null>(null);

  // Load bookmark
  useEffect(() => {
    if (currentDocument) {
      const loadBookmark = async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const bp = await invoke<number | null>("get_bookmark", { document_id: currentDocument.id });
          setBookmarkPage(bp);
        } catch {}
      };
      loadBookmark();
    }
  }, [currentDocument?.id]);

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
  const annotations: KnowledgeAnnotation[] = data?.annotations?.filter(
    (a) => a.document_id === currentDocument?.id
  ) || [];

  const handleAskAI = (sel: ReaderSelection) => {
    setQuote({
      text: sel.text,
      document_id: currentDocument?.id,
      document_name: currentDocument?.display_name?.trim() || currentDocument.name,
      page: sel.page,
    });
    setReaderSelection(null);
  };

  const handleAddAnnotation = async (sel: ReaderSelection, kind: string) => {
    if (currentDocument) {
      await addAnnotation(currentDocument.id, sel, kind);
      setReaderSelection(null);
    }
  };

  const handleOpenNoteEditor = (sel?: ReaderSelection, ann?: KnowledgeAnnotation) => {
    if (ann) {
      setNoteText(ann.note);
      setEditingAnnotation(ann);
    } else if (sel) {
      setNoteText("");
      setEditingAnnotation(null);
    }
    setShowNoteEditor(true);
  };

  const handleSaveNote = async () => {
    if (editingAnnotation) {
      await updateAnnotation(editingAnnotation.id, noteText.trim());
    } else if (readerSelection && currentDocument && noteText.trim()) {
      await addAnnotation(currentDocument.id, readerSelection, "note", noteText.trim());
    }
    setShowNoteEditor(false);
    setNoteText("");
    setEditingAnnotation(null);
    setReaderSelection(null);
  };

  const handleToggleBookmark = async () => {
    if (!currentDocument) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<boolean>("toggle_bookmark", {
        document_id: currentDocument.id,
        page_index: currentPageIndex,
      });
      setBookmarkPage(result ? currentPageIndex : null);
    } catch {}
  };

  const handleExportOriginal = async () => {
    if (!currentDocument) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const dest = await save({
        defaultPath: currentDocument.name,
      });
      if (dest) {
        await invoke("export_original_document", { document_id: currentDocument.id, destination: dest });
      }
    } catch (e: any) {
      console.error("Export failed:", e);
    }
  };

  const handleExportAnnotated = async () => {
    if (!currentDocument) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const filename = await invoke<string>("get_annotated_filename", { document_id: currentDocument.id });
      const dest = await save({ defaultPath: filename });
      if (dest) {
        await invoke("export_annotated_document", { document_id: currentDocument.id, destination: dest });
      }
    } catch (e: any) {
      console.error("Export failed:", e);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <span className="text-xs opacity-50">{isPDF ? "📄" : "📝"}</span>
        <span className="text-sm font-semibold truncate flex-1">
          {currentDocument.display_name?.trim() || currentDocument.name}
        </span>
        <span className="text-xs text-secondary whitespace-nowrap">
          {currentDocument.page_count ? `${currentDocument.page_count} 页` : ""}
        </span>

        <button
          onClick={() => setShowOutline(!showOutline)}
          className={`px-2 py-1 text-xs border rounded transition-colors ${
            showOutline ? "bg-[var(--color-accent-light)] border-[var(--color-accent)]" : "border-[var(--color-border)] hover:bg-[var(--color-hover)]"
          }`}
        >
          {showOutline ? "收起目录" : "目录"}
        </button>

        <button
          onClick={handleToggleBookmark}
          className={`px-2 py-1 text-xs border rounded transition-colors ${
            bookmarkPage !== null ? "bg-orange-100 border-orange-400 text-orange-700" : "border-[var(--color-border)] hover:bg-[var(--color-hover)]"
          }`}
          title={bookmarkPage !== null ? `书签：第 ${bookmarkPage + 1} 页` : "设置书签"}
        >
          {bookmarkPage !== null ? "🔖" : "书签"}
        </button>

        <div className="relative group">
          <button className="px-2 py-1 text-xs border border-[var(--color-border)] rounded hover:bg-[var(--color-hover)]">
            导出 ▾
          </button>
          <div className="absolute right-0 top-full mt-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md shadow-lg py-1 z-50 hidden group-hover:block min-w-[150px]">
            <button onClick={handleExportOriginal} className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--color-hover)]">
              导出原文档…
            </button>
            <button
              onClick={handleExportAnnotated}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--color-hover)]"
              disabled={annotations.length === 0}
            >
              导出带批注版本…
            </button>
          </div>
        </div>

        <button
          onClick={() => setShowAnnotations(true)}
          className="px-2 py-1 text-xs border border-[var(--color-border)] rounded hover:bg-[var(--color-hover)]"
        >
          批注 {annotations.length}
        </button>
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {/* Outline sidebar */}
        {showOutline && (
          <div className="w-[220px] flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-sidebar)] overflow-y-auto">
            <div className="px-3 py-2 text-xs font-semibold text-secondary border-b border-[var(--color-border)]">
              文档目录
            </div>
            {outlineEntries.length === 0 ? (
              <div className="px-3 py-6 text-xs text-secondary text-center">未识别到目录结构</div>
            ) : (
              outlineEntries.map((entry) => (
                <button
                  key={entry.id}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--color-hover)] transition-colors truncate"
                  style={{ paddingLeft: `${12 + (entry.level - 1) * 12}px` }}
                  onClick={() => {
                    if (entry.target.type === "pdf") {
                      const pageNum = (entry.target.value as any).page_index + 1;
                      const container = document.querySelector("[data-page]");
                      if (container) {
                        const pages = document.querySelectorAll("[data-page]");
                        pages.forEach((el) => {
                          if (parseInt(el.getAttribute("data-page") || "0") === pageNum) {
                            el.scrollIntoView({ behavior: "smooth", block: "start" });
                          }
                        });
                      }
                    }
                  }}
                >
                  {entry.title}
                </button>
              ))
            )}
          </div>
        )}

        {/* Reader */}
        <div className="flex-1 overflow-hidden relative bg-[var(--color-reader-bg)]">
          {isPDF ? (
            documentBytes ? (
              <PDFReader
                bytes={documentBytes}
                annotations={annotations}
                bookmarkPage={bookmarkPage}
                onSelection={setReaderSelection}
                onPageChange={setCurrentPageIndex}
                onAnnotationClick={(id) => {
                  const ann = annotations.find((a) => a.id === id);
                  if (ann) handleOpenNoteEditor(undefined, ann);
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-secondary">
                <div className="text-center">
                  <div className="animate-spin text-2xl mb-2">⏳</div>
                  <p>加载中…</p>
                </div>
              </div>
            )
          ) : (
            <RichTextContent
              extension={currentDocument.extension}
              extractedText={extractedContent?.text || ""}
              documentBytes={documentBytes}
            />
          )}
        </div>
      </div>

      {/* Selection toolbar */}
      {readerSelection && (
        <div className="fixed z-50" style={{
          left: `${Math.max(100, (readerSelection.anchor_x || 400) - 200)}px`,
          top: `${Math.max(60, (readerSelection.anchor_y || 200) - 50)}px`,
        }}>
          <div className="flex items-center gap-1 px-2 py-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md border border-[var(--color-border)] rounded-lg shadow-xl">
            <button onClick={() => handleAskAI(readerSelection)} className="px-2.5 py-1 text-xs rounded hover:bg-purple-100 dark:hover:bg-purple-900/30 flex items-center gap-1">
              ✨ Ask AI
            </button>
            <button onClick={() => handleAskAI(readerSelection)} className="px-2.5 py-1 text-xs rounded hover:bg-[var(--color-hover)] flex items-center gap-1">
              💬 引用
            </button>
            <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
            <button onClick={() => handleAddAnnotation(readerSelection, "highlight")} className="px-2.5 py-1 text-xs rounded hover:bg-yellow-100 dark:hover:bg-yellow-900/30">
              高亮
            </button>
            <button onClick={() => handleAddAnnotation(readerSelection, "underline")} className="px-2.5 py-1 text-xs rounded hover:bg-[var(--color-hover)]">
              划线
            </button>
            <button onClick={() => handleOpenNoteEditor(readerSelection)} className="px-2.5 py-1 text-xs rounded hover:bg-green-100 dark:hover:bg-green-900/30">
              📝 笔记
            </button>
          </div>
        </div>
      )}

      {/* Note editor modal */}
      {showNoteEditor && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50" onClick={() => setShowNoteEditor(false)}>
          <div className="bg-[var(--color-bg)] rounded-xl shadow-2xl p-6 w-[520px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3">
              {editingAnnotation ? "编辑笔记" : "添加笔记"}
            </h2>
            <div className="p-3 bg-[var(--color-bg-secondary)] rounded-lg mb-3 text-sm text-secondary max-h-[120px] overflow-y-auto border border-[var(--color-border)]">
              {editingAnnotation?.quote || readerSelection?.text || ""}
            </div>
            <textarea
              className="flex-1 min-h-[120px] px-3 py-2 border border-[var(--color-border)] rounded-lg resize-none text-sm focus:border-[var(--color-accent)] outline-none bg-[var(--color-bg)]"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="输入你的笔记…"
              autoFocus
            />
            <div className="flex justify-between items-center mt-3">
              {editingAnnotation && (
                <button
                  onClick={() => {
                    deleteAnnotation(editingAnnotation.id);
                    setShowNoteEditor(false);
                    setEditingAnnotation(null);
                  }}
                  className="px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                >
                  删除批注
                </button>
              )}
              <div className="flex-1" />
              <button onClick={() => { setShowNoteEditor(false); setEditingAnnotation(null); }} className="px-4 py-1.5 text-sm">
                取消
              </button>
              <button
                onClick={handleSaveNote}
                className="px-4 py-1.5 bg-[var(--color-accent)] text-white rounded-md text-sm font-medium disabled:opacity-40"
                disabled={!noteText.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Annotations list modal */}
      {showAnnotations && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50" onClick={() => setShowAnnotations(false)}>
          <div className="bg-[var(--color-bg)] rounded-xl shadow-2xl p-6 w-[620px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3">文档批注 ({annotations.length})</h2>
            {annotations.length === 0 ? (
              <div className="py-12 text-center text-secondary">
                <p className="text-2xl mb-2">🖊️</p>
                <p>还没有批注</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-3">
                {annotations.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")).map((ann) => (
                  <div key={ann.id} className="p-3 border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-hover)] transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                        ann.kind === "highlight" ? "bg-yellow-100 text-yellow-800" :
                        ann.kind === "underline" ? "bg-orange-100 text-orange-800" :
                        "bg-green-100 text-green-800"
                      }`}>
                        {ann.kind === "highlight" ? "高亮" : ann.kind === "underline" ? "划线" : "笔记"}
                      </span>
                      {ann.page && <span className="text-xs text-secondary">第 {ann.page} 页</span>}
                      <div className="flex-1" />
                      <button onClick={() => handleOpenNoteEditor(undefined, ann)} className="text-xs text-[var(--color-accent)] hover:underline">
                        {ann.note ? "编辑笔记" : "添加笔记"}
                      </button>
                      <button onClick={() => deleteAnnotation(ann.id)} className="text-xs text-red-500 hover:underline">
                        删除
                      </button>
                    </div>
                    <p className="text-sm text-secondary line-clamp-3">{ann.quote}</p>
                    {ann.note && (
                      <p className="text-sm mt-1.5 p-2 bg-[var(--color-bg-secondary)] rounded">{ann.note}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-3">
              <button onClick={() => setShowAnnotations(false)} className="px-4 py-1.5 bg-[var(--color-accent)] text-white rounded-md text-sm">
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RichTextContent({ extension, extractedText, documentBytes }: {
  extension: string;
  extractedText: string;
  documentBytes: Uint8Array | null;
}) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if ([".docx", ".doc"].includes(extension) && documentBytes) {
      setLoading(true);
      import("mammoth").then((mammoth) => {
        mammoth.convertToHtml({ arrayBuffer: documentBytes.buffer as ArrayBuffer })
          .then((result: any) => {
            setHtmlContent(result.value);
            setLoading(false);
          })
          .catch(() => {
            setHtmlContent("<p class='text-secondary'>无法解析此文档</p>");
            setLoading(false);
          });
      });
    }
  }, [extension, documentBytes]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-secondary">
        <p>正在解析文档…</p>
      </div>
    );
  }

  if (htmlContent) {
    return (
      <div className="max-w-[900px] mx-auto p-8 h-full overflow-y-auto">
        <div
          className="prose prose-sm max-w-none text-sm leading-relaxed"
          dangerouslySetInnerHTML={{
            __html: htmlContent
              .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
              .replace(/\son\w+\s*=\s*"[^"]*"/gi, ""),
          }}
        />
      </div>
    );
  }

  if ([".html", ".htm"].includes(extension)) {
    return (
      <div className="max-w-[900px] mx-auto p-8 h-full overflow-y-auto">
        <div
          className="prose prose-sm max-w-none text-sm leading-relaxed"
          dangerouslySetInnerHTML={{
            __html: extractedText
              .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
              .replace(/\son\w+\s*=\s*"[^"]*"/gi, ""),
          }}
        />
      </div>
    );
  }

  // Render as plain text / basic markdown
  const lines = extractedText.split("\n");
  return (
    <div className="max-w-[900px] mx-auto p-8 h-full overflow-y-auto">
      <div className="prose prose-sm max-w-none text-sm leading-relaxed">
        {lines.map((line, i) => {
          if (line.startsWith("# ")) return <h1 key={i} className="text-xl font-bold mt-5 mb-2">{line.slice(2)}</h1>;
          if (line.startsWith("## ")) return <h2 key={i} className="text-lg font-bold mt-4 mb-1.5">{line.slice(3)}</h2>;
          if (line.startsWith("### ")) return <h3 key={i} className="text-base font-bold mt-3 mb-1">{line.slice(4)}</h3>;
          if (line.trim() === "") return <div key={i} className="h-3" />;
          return <p key={i} className="my-1">{line || " "}</p>;
        })}
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { useStore } from "./state/store";
import { LibrarySidebar } from "./components/library/LibrarySidebar";
import { ReaderPane } from "./components/reader/ReaderPane";
import { ChatPane } from "./components/chat/ChatPane";
import { ChatPlacement } from "./types/models";

export default function App() {
  const {
    libraryVisible, chatPlacement, loading, loadData,
    currentDocument, tabs, openDocument, closeDocument,
  } = useStore();

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">知屿 KnowledgeMaster</h1>
          <p className="text-secondary">正在加载知识库…</p>
        </div>
      </div>
    );
  }

  const showLibrary = libraryVisible || chatPlacement === "sidebar";
  const showChatSidebar = chatPlacement === "sidebar";
  const showChatRight = chatPlacement === "right";
  const showChatBottom = chatPlacement === "bottom";

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Library sidebar */}
      {showLibrary && (
        <div className={`flex flex-col border-r border-[var(--color-border)] bg-[var(--color-sidebar)] ${showChatSidebar ? "flex-1" : "w-[280px] flex-shrink-0"}`}>
          <LibrarySidebar
            currentDocument={currentDocument}
            onOpen={openDocument}
          />
          {showChatSidebar && (
            <div className="flex-1 border-t border-[var(--color-border)] min-h-[300px]">
              <ChatPane />
            </div>
          )}
        </div>
      )}

      {/* Center: Reader + optional bottom chat */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Tab bar */}
        {tabs.length > 0 && (
          <div className="flex items-center h-[38px] bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] px-2 gap-1 overflow-x-auto">
            {tabs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => openDocument(doc)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm whitespace-nowrap ${
                  currentDocument?.id === doc.id
                    ? "bg-[var(--color-bg)] shadow-sm"
                    : "hover:bg-[var(--color-hover)]"
                }`}
              >
                <span className="truncate max-w-[200px]">
                  {doc.display_name?.trim() || doc.name}
                </span>
                <span
                  className="text-xs opacity-40 hover:opacity-80 cursor-pointer ml-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeDocument(doc);
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Reader */}
        <div className="flex-1 min-h-0">
          <ReaderPane />
        </div>

        {/* Bottom chat */}
        {showChatBottom && (
          <div className="h-[340px] border-t border-[var(--color-border)]">
            <ChatPane />
          </div>
        )}
      </div>

      {/* Right chat */}
      {showChatRight && (
        <div className="w-[380px] flex-shrink-0 border-l border-[var(--color-border)]">
          <ChatPane />
        </div>
      )}
    </div>
  );
}

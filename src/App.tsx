import { useEffect } from "react";
import { useStore } from "./state/store";
import { LibrarySidebar } from "./components/library/LibrarySidebar";
import { ReaderPane } from "./components/reader/ReaderPane";
import { ChatPane } from "./components/chat/ChatPane";
import { SettingsDialog } from "./components/settings/SettingsDialog";

export default function App() {
  const {
    libraryVisible, chatPlacement, loading, loadData,
    currentDocument, tabs, openDocument, closeDocument,
    showSettings,
  } = useStore();

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--color-bg)]">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-3">知屿 KnowledgeMaster</h1>
          <div className="flex gap-1.5 justify-center mb-4">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
          <p className="text-sm text-secondary">正在加载知识库…</p>
        </div>
      </div>
    );
  }

  const showLibraryPanel = libraryVisible || chatPlacement === "sidebar";
  const showChatSidebar = chatPlacement === "sidebar" && libraryVisible;
  const showChatRight = chatPlacement === "right";
  const showChatBottom = chatPlacement === "bottom";
  const showChatHidden = chatPlacement === "hidden";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-bg)]">
      {/* Library sidebar */}
      {showLibraryPanel && (
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
        <div className="flex items-center h-[38px] bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] px-2 gap-0.5 overflow-x-auto shrink-0">
          {!libraryVisible && (
            <button
              onClick={() => useStore.setState({ libraryVisible: true })}
              className="px-2 py-1 text-xs hover:bg-[var(--color-hover)] rounded mr-1 shrink-0"
              title="显示资料侧边栏"
            >
              📚
            </button>
          )}
          {tabs.map((doc) => (
            <button
              key={doc.id}
              onClick={() => openDocument(doc)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-sm whitespace-nowrap shrink-0 transition-colors ${
                currentDocument?.id === doc.id
                  ? "bg-[var(--color-bg)] shadow-sm font-medium"
                  : "hover:bg-[var(--color-hover)]"
              }`}
            >
              <span className="truncate max-w-[180px]">
                {doc.display_name?.trim() || doc.name}
              </span>
              <span
                className="text-xs opacity-30 hover:opacity-80 cursor-pointer ml-0.5"
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

        {/* Reader */}
        <div className="flex-1 min-h-0">
          <ReaderPane />
        </div>

        {/* Bottom chat */}
        {showChatBottom && (
          <div className="h-[340px] border-t border-[var(--color-border)] shrink-0">
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

      {/* Hidden chat - show button */}
      {showChatHidden && (
        <div className="fixed bottom-4 right-4 z-40">
          <button
            onClick={() => useStore.setState({ chatPlacement: "right" })}
            className="px-4 py-2.5 bg-[var(--color-accent)] text-white rounded-full shadow-lg text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            ✨ 知识问答
          </button>
        </div>
      )}

      {/* Settings dialog */}
      {showSettings && <SettingsDialog onClose={() => useStore.setState({ showSettings: false })} />}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { PanelLeft, Sparkles, X } from "lucide-react";
import { api } from "./api";
import type { BootstrapState, KnowledgeData, KnowledgeDocument, ReaderQuote, UUID } from "./types";
import LibrarySidebar from "./components/LibrarySidebar";
import Reader from "./components/Reader";
import ChatPanel from "./components/ChatPanel";
import SettingsModal from "./components/SettingsModal";
import { availableChatBackend, clampChatPanelWidth, displayTitle } from "./utils";

const CHAT_WIDTH_KEY = "knowledgemaster.rightChatWidth";

export default function App() {
  const [state, setState] = useState<BootstrapState | null>(null);
  const [tabs, setTabs] = useState<KnowledgeDocument[]>([]);
  const [currentId, setCurrentId] = useState<UUID | null>(null);
  const [quote, setQuote] = useState<ReaderQuote | null>(null);
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<UUID | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastChatPlacement, setLastChatPlacement] = useState<"right" | "bottom" | "sidebar">("right");
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [externalRecommendationIds, setExternalRecommendationIds] = useState<UUID[]>([]);
  const [rightChatWidth, setRightChatWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem(CHAT_WIDTH_KEY));
    return clampChatPanelWidth(Number.isFinite(saved) && saved > 0 ? saved : 382, window.innerWidth);
  });
  const [bootError, setBootError] = useState("");

  useEffect(() => {
    api.bootstrap().then((value) => {
      const chatBackend = availableChatBackend(value.settings.chatBackend, value.agentAvailability);
      const next = chatBackend === value.settings.chatBackend
        ? value
        : { ...value, settings: { ...value.settings, chatBackend } };
      setState(next);
      if (next !== value) void api.updateSettings(next.settings);
    }).catch((value) => setBootError(String(value)));
  }, []);

  useEffect(() => {
    const fitChatPanel = () => setRightChatWidth((value) => clampChatPanelWidth(value, window.innerWidth));
    window.addEventListener("resize", fitChatPanel);
    return () => window.removeEventListener("resize", fitChatPanel);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop" && event.payload.paths.length) {
        const paths = event.payload.paths;
        void api.reload().then(async (before) => {
          const previous = new Set(before.documents.map((document) => document.id));
          await api.importFiles(paths);
          const data = await api.reload();
          setState((value) => value ? { ...value, data } : value);
          setExternalRecommendationIds(data.documents.filter((document) => !previous.has(document.id)).map((document) => document.id));
        });
      }
    }).then((value) => { unlisten = value; });
    return () => unlisten?.();
  }, []);

  const currentDocument = useMemo(
    () => state?.data.documents.find((document) => document.id === currentId) || null,
    [state?.data.documents, currentId]
  );

  useEffect(() => {
    if (!state) return;
    setTabs((values) => values.map((tab) => state.data.documents.find((document) => document.id === tab.id)).filter(Boolean) as KnowledgeDocument[]);
    if (currentId && !state.data.documents.some((document) => document.id === currentId)) setCurrentId(null);
  }, [state?.data.documents]);

  function updateData(data: KnowledgeData) {
    setState((value) => value ? { ...value, data } : value);
  }

  function openDocument(document: KnowledgeDocument) {
    setTabs((values) => values.some((item) => item.id === document.id) ? values : [...values, document]);
    setCurrentId(document.id);
    setFocusedAnnotationId(null);
  }

  function openAnnotation(id: UUID) {
    const annotation = state?.data.annotations.find((item) => item.id === id);
    if (!annotation || !state) return;
    const document = state.data.documents.find((item) => item.id === annotation.documentId);
    if (!document) return;
    openDocument(document);
    window.setTimeout(() => setFocusedAnnotationId(id), 0);
  }

  function closeTab(id: UUID) {
    setTabs((values) => {
      const index = values.findIndex((item) => item.id === id);
      const next = values.filter((item) => item.id !== id);
      if (currentId === id) setCurrentId(next[Math.min(Math.max(0, index), next.length - 1)]?.id || null);
      return next;
    });
  }

  function startRightChatResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    let latest = rightChatWidth;
    const previousCursor = window.document.body.style.cursor;
    const previousSelection = window.document.body.style.userSelect;
    window.document.body.style.cursor = "col-resize";
    window.document.body.style.userSelect = "none";
    const move = (value: PointerEvent) => {
      latest = clampChatPanelWidth(window.innerWidth - value.clientX, window.innerWidth);
      setRightChatWidth(latest);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.document.body.style.cursor = previousCursor;
      window.document.body.style.userSelect = previousSelection;
      window.localStorage.setItem(CHAT_WIDTH_KEY, String(latest));
      setLayoutRevision((value) => value + 1);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  if (!state) return <div className="boot-screen"><span className="brand-mark large">屿</span><strong>知屿</strong><span>{bootError || "正在打开知识库…"}</span></div>;

  const { settings } = state;
  const showLibrary = settings.libraryVisible;
  const placement = settings.chatPlacement;
  const chat = (
    <ChatPanel
      data={state.data}
      settings={settings}
      agentAvailability={state.agentAvailability}
      currentDocument={currentDocument}
      quote={quote}
      onQuote={setQuote}
      onData={updateData}
      onSettings={(next) => {
        if (next.chatPlacement === "hidden" && settings.chatPlacement !== "hidden") {
          setLastChatPlacement(settings.chatPlacement as "right" | "bottom" | "sidebar");
        }
        setState({ ...state, settings: next });
        setLayoutRevision((value) => value + 1);
      }}
    />
  );
  const library = (
    <LibrarySidebar
      data={state.data}
      rootPath={state.rootPath}
      settings={settings}
      currentDocumentId={currentId}
      externalRecommendationIds={externalRecommendationIds}
      onData={updateData}
      onReload={async () => updateData(await api.reload())}
      onExternalRecommendationsHandled={() => setExternalRecommendationIds([])}
      onOpenDocument={openDocument}
      onOpenAnnotation={openAnnotation}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );

  return (
    <div className={`app-shell placement-${placement}`}>
      <div className="workspace">
        {(showLibrary || placement === "sidebar") && (
          <div className="left-column">
            {showLibrary && placement === "sidebar" ? <><div className="left-library">{library}</div><div className="left-chat">{chat}</div></> : showLibrary ? library : chat}
          </div>
        )}
        <div className="center-column">
          <header className="tabs-bar">
            <button
              className="icon-button"
              title={showLibrary ? "隐藏资料侧边栏" : "显示资料侧边栏"}
              onClick={async () => {
                const next = { ...settings, libraryVisible: !showLibrary };
                await api.updateSettings(next);
                setState({ ...state, settings: next });
                setLayoutRevision((value) => value + 1);
              }}
            ><PanelLeft size={17} /></button>
            <i />
            <div className="tabs-scroll">
              {tabs.map((document) => (
                <div className={`tab ${document.id === currentId ? "active" : ""}`} key={document.id}>
                  <button onClick={() => setCurrentId(document.id)}>{displayTitle(document)}</button>
                  <button className="icon-button" onClick={() => closeTab(document.id)}><X size={12} /></button>
                </div>
              ))}
            </div>
            {placement === "hidden" && (
              <button className="restore-chat" onClick={async () => {
                const next = { ...settings, chatPlacement: lastChatPlacement };
                await api.updateSettings(next);
                setState({ ...state, settings: next });
                setLayoutRevision((value) => value + 1);
              }}><Sparkles size={15} />知识问答</button>
            )}
          </header>
          <Reader
            document={currentDocument}
            data={state.data}
            focusedAnnotationId={focusedAnnotationId}
            layoutRevision={layoutRevision}
            onData={updateData}
            onAsk={(value) => {
              setQuote(value);
              if (placement === "hidden") {
                const next = { ...settings, chatPlacement: lastChatPlacement };
                void api.updateSettings(next);
                setState({ ...state, settings: next });
                setLayoutRevision((current) => current + 1);
              }
            }}
          />
          {placement === "bottom" && <div className="bottom-chat">{chat}</div>}
        </div>
        {placement === "right" && <>
          <div
            className="right-chat-resizer"
            role="separator"
            aria-label="调整知识问答宽度"
            aria-orientation="vertical"
            onPointerDown={startRightChatResize}
          />
          <div className="right-column" style={{ flexBasis: rightChatWidth, width: rightChatWidth }}>{chat}</div>
        </>}
      </div>
      {settingsOpen && <SettingsModal state={state} onState={setState} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

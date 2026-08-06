import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  FolderMinus,
  FolderPlus,
  GripVertical,
  Globe2,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles
} from "lucide-react";
import { api } from "../api";
import type {
  AppSettings,
  KnowledgeData,
  KnowledgeDocument,
  Topic,
  TopicRecommendation,
  UUID
} from "../types";
import { displayTitle, formatBytes } from "../utils";
import NotesPanel from "./NotesPanel";

interface Props {
  data: KnowledgeData;
  rootPath: string;
  settings: AppSettings;
  currentDocumentId?: UUID | null;
  externalRecommendationIds?: UUID[];
  onData: (data: KnowledgeData) => void;
  onReload: () => Promise<void>;
  onExternalRecommendationsHandled?: () => void;
  onOpenDocument: (document: KnowledgeDocument) => void;
  onOpenAnnotation: (id: UUID) => void;
  onOpenSettings: () => void;
}

type Mode = "directory" | "notes";
type DraggedDocument = { documentId: UUID; sourceTopicId: UUID | null };
type PointerDrag = { pointerId: number; x: number; y: number };
type MoveRequest = { document: KnowledgeDocument; sourceTopicId: UUID | null };

interface WebImportProgress {
  importId: UUID;
  stage: "connecting" | "downloading" | "detecting" | "extracting" | "refreshing";
  detail: string;
}

const webImportStages: Array<{ stage: WebImportProgress["stage"]; label: string }> = [
  { stage: "downloading", label: "下载" },
  { stage: "detecting", label: "识别" },
  { stage: "extracting", label: "解析入库" },
  { stage: "refreshing", label: "刷新目录" }
];

function webImportStageIndex(stage: WebImportProgress["stage"]): number {
  if (stage === "connecting") return 0;
  return Math.max(0, webImportStages.findIndex((item) => item.stage === stage));
}

function descendants(data: KnowledgeData, topicId: UUID): Topic[] {
  const children = data.topics.filter((topic) => topic.parentId === topicId);
  return children.flatMap((child) => [child, ...descendants(data, child.id)]);
}

function topicPath(topics: Topic[], topic: Topic): string {
  const names = [topic.name];
  let parentId = topic.parentId;
  const visited = new Set<UUID>([topic.id]);
  while (parentId) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = topics.find((item) => item.id === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}

function closeFolderMenus() {
  window.document.querySelectorAll<HTMLDetailsElement>("details.tree-menu[open]")
    .forEach((menu) => menu.removeAttribute("open"));
}

function closeOtherFolderMenus(current: HTMLDetailsElement) {
  window.document.querySelectorAll<HTMLDetailsElement>("details.tree-menu[open]")
    .forEach((menu) => {
      if (menu !== current) menu.removeAttribute("open");
    });
}

export default function LibrarySidebar(props: Props) {
  const { data, rootPath, currentDocumentId, onData, onReload, onOpenDocument, onOpenAnnotation } = props;
  const [mode, setMode] = useState<Mode>("directory");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Set<UUID> | null>(null);
  const [expanded, setExpanded] = useState<Set<UUID>>(new Set(data.topics.map((topic) => topic.id)));
  const [message, setMessage] = useState("");
  const [recommendations, setRecommendations] = useState<
    Array<{ document: KnowledgeDocument; values: TopicRecommendation[] }>
  >([]);
  const [recommendationSelection, setRecommendationSelection] = useState<Set<string>>(new Set());
  const [recommendationLoading, setRecommendationLoading] = useState<string[]>([]);
  const [dragging, setDragging] = useState<DraggedDocument | null>(null);
  const [dropTarget, setDropTarget] = useState<UUID | "unclassified" | null>(null);
  const [pointerDrag, setPointerDrag] = useState<PointerDrag | null>(null);
  const [openDocumentMenu, setOpenDocumentMenu] = useState<string | null>(null);
  const [moveRequest, setMoveRequest] = useState<MoveRequest | null>(null);
  const [webDialog, setWebDialog] = useState(false);
  const [webURL, setWebURL] = useState("");
  const [webImportProgress, setWebImportProgress] = useState<WebImportProgress | null>(null);
  const [webImportElapsed, setWebImportElapsed] = useState(0);
  const [webImportError, setWebImportError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (!query.trim()) {
        setMatches(null);
        return;
      }
      setMatches(new Set(await api.search(query)));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, data]);

  useEffect(() => {
    if (!props.externalRecommendationIds?.length) return;
    const documents = props.externalRecommendationIds
      .map((id) => data.documents.find((document) => document.id === id))
      .filter((document): document is KnowledgeDocument => Boolean(document));
    void showRecommendations(documents).finally(() => props.onExternalRecommendationsHandled?.());
  }, [props.externalRecommendationIds]);

  useEffect(() => {
    if (!webImportProgress) {
      setWebImportElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setWebImportElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [webImportProgress?.importId]);

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".tree-menu")) return;
      setOpenDocumentMenu(null);
      closeFolderMenus();
    };
    window.document.addEventListener("pointerdown", closeMenus);
    return () => window.document.removeEventListener("pointerdown", closeMenus);
  }, []);

  async function showRecommendations(documents: KnowledgeDocument[]) {
    if (!documents.length) return;
    setRecommendationLoading(documents.map(displayTitle));
    try {
      const groups = await Promise.all(
        documents.map(async (document) => ({ document, values: await api.recommendations(document.id) }))
      );
      setRecommendations(groups);
      setRecommendationSelection(
        new Set(groups.flatMap(({ document, values }) => values.map((value) => `${document.id}:${value.topicId}`)))
      );
    } finally {
      setRecommendationLoading([]);
    }
  }

  async function importPaths(paths: string[]) {
    if (!paths.length) return;
    const before = new Set(data.documents.map((document) => document.id));
    const messages = await api.importFiles(paths);
    setMessage(messages.join(" · "));
    const next = await api.reload();
    onData(next);
    const imported = next.documents.filter((document) => !before.has(document.id));
    await showRecommendations(imported);
  }

  async function pickFiles() {
    const selected = await open({
      multiple: true,
      filters: [
        { name: "支持的资料", extensions: ["pdf", "html", "htm", "md", "markdown", "txt", "doc", "docx"] }
      ]
    });
    await importPaths(Array.isArray(selected) ? selected : selected ? [selected] : []);
  }

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) await importPaths([selected]);
  }

  async function importWeb() {
    if (webImportProgress) return;
    const importId = crypto.randomUUID();
    const initialProgress: WebImportProgress = {
      importId,
      stage: "connecting",
      detail: "正在准备导入…"
    };
    setWebImportProgress(initialProgress);
    setWebImportError("");
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<WebImportProgress>("web-import-progress", ({ payload }) => {
        if (payload.importId === importId) setWebImportProgress(payload);
      });
      const before = new Set(data.documents.map((document) => document.id));
      const messages = await api.importWebPage(webURL, importId);
      setMessage(messages.join(" · "));
      setWebImportProgress({ importId, stage: "refreshing", detail: "正在刷新知识目录…" });
      const next = await api.reload();
      onData(next);
      const imported = next.documents.filter((document) => !before.has(document.id));
      setWebDialog(false);
      setWebURL("");
      await showRecommendations(imported);
    } catch (error) {
      const description = String(error);
      setWebImportError(description);
      setMessage(description);
    } finally {
      unlisten?.();
      setWebImportProgress(null);
    }
  }

  async function addTopic(parentId?: UUID) {
    const name = window.prompt(parentId ? "子主题名称" : "主题名称");
    if (name?.trim()) onData(await api.createTopic(name, parentId));
  }

  async function renameTopic(topic: Topic) {
    const name = window.prompt("重命名主题", topic.name);
    if (name?.trim()) onData(await api.renameTopic(topic.id, name));
  }

  async function deleteTopic(topic: Topic) {
    const count = descendants(data, topic.id).length;
    if (
      window.confirm(
        `删除“${topic.name}”${count ? `及 ${count} 个子主题` : ""}？\n只移除虚拟关联，不会删除原始文档、批注或笔记。`
      )
    ) {
      onData(await api.deleteTopic(topic.id));
    }
  }

  async function applyRecommended() {
    let next = data;
    for (const group of recommendations) {
      const topicIds = data.topics
        .filter((topic) => recommendationSelection.has(`${group.document.id}:${topic.id}`))
        .map((topic) => topic.id);
      next = await api.applyRecommendations(group.document.id, topicIds);
    }
    onData(next);
    setRecommendations([]);
  }

  async function moveDocument(payload: DraggedDocument, targetTopicId: UUID | null) {
    const targetName = targetTopicId
      ? data.topics.find((topic) => topic.id === targetTopicId)?.name || "目标主题"
      : "未分类";
    onData(await api.moveDocument(payload.documentId, payload.sourceTopicId, targetTopicId));
    if (targetTopicId) {
      const next = new Set(expanded);
      next.add(targetTopicId);
      setExpanded(next);
    }
    setMessage(`已移动到“${targetName}”`);
    setDragging(null);
    setDropTarget(null);
  }

  async function unlinkDocument(payload: DraggedDocument) {
    if (!payload.sourceTopicId) return;
    setOpenDocumentMenu(null);
    const sourceName = data.topics.find((topic) => topic.id === payload.sourceTopicId)?.name || "当前目录";
    onData(await api.unlinkDocument(payload.documentId, payload.sourceTopicId));
    setMessage(`已从“${sourceName}”移出，源文件仍保留`);
  }

  function pointerTargetAt(x: number, y: number): UUID | "unclassified" | null {
    const target = window.document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-topic-drop]")
      ?.dataset.topicDrop;
    return target === "unclassified" ? "unclassified" : target || null;
  }

  function startPointerDrag(payload: DraggedDocument, pointerId: number, x: number, y: number) {
    setOpenDocumentMenu(null);
    closeFolderMenus();
    setDragging(payload);
    setPointerDrag({ pointerId, x, y });
    setDropTarget(pointerTargetAt(x, y));
  }

  function updatePointerDrag(pointerId: number, x: number, y: number) {
    setPointerDrag({ pointerId, x, y });
    setDropTarget(pointerTargetAt(x, y));
  }

  function finishPointerDrag(payload: DraggedDocument, x: number, y: number) {
    const target = pointerTargetAt(x, y);
    setPointerDrag(null);
    setDropTarget(null);
    if (!target) {
      setDragging(null);
      return;
    }
    void moveDocument(payload, target === "unclassified" ? null : target).catch((error) => {
      setMessage(String(error));
      setDragging(null);
    });
  }

  function cancelPointerDrag() {
    setPointerDrag(null);
    setDropTarget(null);
    setDragging(null);
  }

  const linked = useMemo(() => new Set(data.documentTopics.map((item) => item.documentId)), [data.documentTopics]);
  const allTopics = useMemo(
    () => [...data.topics].sort((left, right) => topicPath(data.topics, left).localeCompare(topicPath(data.topics, right), "zh-CN")),
    [data.topics]
  );
  const roots = data.topics
    .filter((topic) => !topic.parentId || !data.topics.some((candidate) => candidate.id === topic.parentId))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const unclassified = data.documents
    .filter((document) => !linked.has(document.id) && (!matches || matches.has(document.id)))
    .sort((a, b) => displayTitle(a).localeCompare(displayTitle(b), "zh-CN"));

  return (
    <aside className="library-sidebar" data-testid="library-sidebar">
      <header className="library-header">
        <div className="brand"><span className="brand-mark">屿</span><strong>知屿</strong></div>
        <button className="icon-button" title="设置" onClick={props.onOpenSettings}><Settings size={17} /></button>
      </header>
      <div className="segmented">
        <button className={mode === "directory" ? "active" : ""} onClick={() => setMode("directory")}>目录</button>
        <button className={mode === "notes" ? "active" : ""} onClick={() => setMode("notes")}>笔记</button>
      </div>

      {mode === "notes" ? (
        <NotesPanel data={data} onData={onData} onOpenAnnotation={onOpenAnnotation} />
      ) : (
        <div className="library-body">
          <label className="search-field">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名、正文或主题" />
          </label>
          <div className="import-actions">
            <button className="primary small" onClick={pickFiles}><FilePlus2 size={14} />导入文件</button>
            <button className="small" onClick={pickFolder}><FolderInput size={14} />目录</button>
            <button className="small" onClick={() => setWebDialog(true)}><Globe2 size={14} />网页</button>
          </div>
          <div className="tree-title">
            <span>知识目录</span>
            <button className="icon-button" title="新建主题" onClick={() => addTopic()}><FolderPlus size={16} /></button>
          </div>
          <div className="tree-scroll">
            {roots.map((topic) => (
              <TopicNode
                key={topic.id}
                topic={topic}
                data={data}
                matches={matches}
                query={query}
                expanded={expanded}
                currentDocumentId={currentDocumentId}
                onExpanded={setExpanded}
                onOpen={onOpenDocument}
                onAdd={addTopic}
                onRename={renameTopic}
                onDelete={deleteTopic}
                dragging={dragging}
                dropTarget={dropTarget}
                openDocumentMenu={openDocumentMenu}
                onCloseDocumentMenu={() => setOpenDocumentMenu(null)}
                onDocumentMenu={(key) => {
                  closeFolderMenus();
                  setOpenDocumentMenu((current) => current === key ? null : key);
                }}
                onMoveRequest={(document, sourceTopicId) => {
                  setOpenDocumentMenu(null);
                  setMoveRequest({ document, sourceTopicId });
                }}
                onUnlink={unlinkDocument}
                onPointerDragStart={startPointerDrag}
                onPointerDragMove={updatePointerDrag}
                onPointerDragEnd={finishPointerDrag}
                onPointerDragCancel={cancelPointerDrag}
              />
            ))}
            {(unclassified.length > 0 || dragging) && (
              <div
                className={`tree-group drop-zone ${dropTarget === "unclassified" ? "drop-active" : ""}`}
                data-topic-drop="unclassified"
              >
                <div className="tree-row folder-row"><Folder size={15} /><span>未分类</span><em>{dropTarget === "unclassified" ? "释放移动" : unclassified.length}</em></div>
                <div className="tree-children">
                  {unclassified.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      sourceTopicId={null}
                      active={document.id === currentDocumentId}
                      onOpen={onOpenDocument}
                      dragging={dragging?.documentId === document.id}
                      menuKey={`unclassified:${document.id}`}
                      menuOpen={openDocumentMenu === `unclassified:${document.id}`}
                      onMenu={(key) => {
                        closeFolderMenus();
                        setOpenDocumentMenu((current) => current === key ? null : key);
                      }}
                      onMoveRequest={(value) => {
                        setOpenDocumentMenu(null);
                        setMoveRequest({ document: value, sourceTopicId: null });
                      }}
                      onUnlink={unlinkDocument}
                      onPointerDragStart={startPointerDrag}
                      onPointerDragMove={updatePointerDrag}
                      onPointerDragEnd={finishPointerDrag}
                      onPointerDragCancel={cancelPointerDrag}
                    />
                  ))}
                </div>
              </div>
            )}
            {!roots.length && !unclassified.length && (
              <div className="empty-state"><BookOpen size={28} /><strong>{query ? "没有匹配结果" : "还没有资料"}</strong></div>
            )}
          </div>
          {message && <p className="status-line" title={message}>{message}</p>}
        </div>
      )}

      <footer className="library-footer">
        <span>{data.documents.length} 份资料</span>
        <span>{rootPath.includes("CloudDocs") ? "iCloud Drive" : "本地存储"}</span>
      </footer>

      {webDialog && createPortal(
        <div className="modal-backdrop web-import-backdrop" onPointerDown={(event) => event.stopPropagation()}>
          <section className="modal compact">
            <h2>导入网页</h2>
            <p className="muted">普通网页将以 HTML 原文保存；链接实际返回 PDF 时会直接下载为 PDF。两种格式均可阅读、检索并用于 AI 问答。</p>
            <input autoFocus disabled={Boolean(webImportProgress)} value={webURL} onChange={(event) => setWebURL(event.target.value)} placeholder="https://example.com/article" />
            {webImportProgress && (
              <div className="web-import-progress" role="status" aria-live="polite">
                <div className="web-import-progress-head">
                  <span className="spinner" />
                  <strong>{webImportProgress.detail}</strong>
                  <time>{webImportElapsed} 秒</time>
                </div>
                <div className="web-import-progress-track">
                  <i style={{
                    width: `${Math.max(
                      12,
                      ((webImportStageIndex(webImportProgress.stage) + 1) / webImportStages.length) * 100
                    )}%`
                  }} />
                </div>
                <ol>
                  {webImportStages.map((item, index) => {
                    const activeIndex = webImportStageIndex(webImportProgress.stage);
                    return <li className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""} key={item.stage}>{item.label}</li>;
                  })}
                </ol>
                <small>PDF 文本提取可能需要数十秒，期间请保持窗口打开。</small>
              </div>
            )}
            {webImportError && <p className="web-import-error">{webImportError}</p>}
            <div className="modal-actions">
              <button disabled={Boolean(webImportProgress)} onClick={() => setWebDialog(false)}>取消</button>
              <button className="primary" disabled={!webURL.trim() || Boolean(webImportProgress)} onClick={importWeb}>
                {webImportProgress ? "导入中…" : "导入"}
              </button>
            </div>
          </section>
        </div>,
        window.document.body
      )}

      {recommendations.length > 0 && (
        <div className="modal-backdrop">
          <section className="modal recommendation-modal">
            <h2><Sparkles size={19} />推荐主题</h2>
            <p className="muted">模型会从已有主题中推荐最相关的目录并预先勾选。下面展示全部主题，你可以任意增删选择，确认后才建立虚拟关联。</p>
            <div className="recommendation-list">
              {recommendations.map(({ document, values }) => (
                <div key={document.id} className="recommendation-document">
                  <strong>{displayTitle(document)}</strong>
                  {allTopics.length ? <div className="topic-choice-list">{allTopics.map((topic) => {
                    const value = values.find((recommendation) => recommendation.topicId === topic.id);
                    const key = `${document.id}:${topic.id}`;
                    return (
                      <label className={value ? "recommended" : ""} key={key}>
                        <input
                          type="checkbox"
                          checked={recommendationSelection.has(key)}
                          onChange={(event) => {
                            const next = new Set(recommendationSelection);
                            if (event.target.checked) next.add(key); else next.delete(key);
                            setRecommendationSelection(next);
                          }}
                        />
                        <span><strong>{topicPath(data.topics, topic)}</strong><small>{value?.reason || "可手动选择"}</small></span>
                        {value && <em>{value.source === "ai" ? "AI 推荐" : "本地推荐"}</em>}
                      </label>
                    );
                  })}</div> : <span className="muted">还没有主题目录。可以先新建主题，也可以保持未分类。</span>}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button onClick={() => addTopic()}><FolderPlus size={14} />新建主题</button>
              <span />
              <button onClick={() => setRecommendations([])}>稍后处理</button>
              <button className="primary" onClick={applyRecommended}>应用所选主题</button>
            </div>
          </section>
        </div>
      )}

      {recommendationLoading.length > 0 && (
        <div className="modal-backdrop">
          <section className="modal compact classification-progress">
            <span className="spinner" />
            <div><h2>正在分析主题</h2><p className="muted">使用当前配置的模型匹配已有目录；模型不可用时会自动切换为本地规则。</p></div>
          </section>
        </div>
      )}

      {moveRequest && (
        <div className="modal-backdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget) setMoveRequest(null);
        }}>
          <section className="modal compact move-topic-modal">
            <h2>移动到主题</h2>
            <p className="muted">“{displayTitle(moveRequest.document)}”只会调整虚拟目录归属，源文件、批注和笔记不会被删除。</p>
            <div className="move-topic-list">
              {allTopics.map((topic) => {
                const current = topic.id === moveRequest.sourceTopicId;
                return (
                  <button
                    key={topic.id}
                    disabled={current}
                    onClick={async () => {
                      await moveDocument(
                        { documentId: moveRequest.document.id, sourceTopicId: moveRequest.sourceTopicId },
                        topic.id
                      );
                      setMoveRequest(null);
                    }}
                  >
                    <Folder size={16} className="folder-icon" />
                    <span><strong>{topicPath(data.topics, topic)}</strong><small>{current ? "当前目录" : "点击移动到这里"}</small></span>
                    {!current && <ChevronRight size={15} />}
                  </button>
                );
              })}
              {!allTopics.length && <div className="empty-state small">还没有主题，请先新建主题。</div>}
            </div>
            <div className="modal-actions"><button onClick={() => setMoveRequest(null)}>取消</button></div>
          </section>
        </div>
      )}

      {dragging && pointerDrag && (
        <div className="drag-preview" style={{ left: pointerDrag.x + 13, top: pointerDrag.y + 13 }}>
          <FileText size={14} />
          <span>{displayTitle(data.documents.find((document) => document.id === dragging.documentId)!)}</span>
        </div>
      )}
    </aside>
  );
}

function TopicNode(props: {
  topic: Topic;
  data: KnowledgeData;
  matches: Set<UUID> | null;
  query: string;
  expanded: Set<UUID>;
  currentDocumentId?: UUID | null;
  onExpanded: (value: Set<UUID>) => void;
  onOpen: (document: KnowledgeDocument) => void;
  onAdd: (parentId: UUID) => void;
  onRename: (topic: Topic) => void;
  onDelete: (topic: Topic) => void;
  dragging: DraggedDocument | null;
  dropTarget: UUID | "unclassified" | null;
  openDocumentMenu: string | null;
  onCloseDocumentMenu: () => void;
  onDocumentMenu: (key: string) => void;
  onMoveRequest: (document: KnowledgeDocument, sourceTopicId: UUID | null) => void;
  onUnlink: (payload: DraggedDocument) => Promise<void>;
  onPointerDragStart: (payload: DraggedDocument, pointerId: number, x: number, y: number) => void;
  onPointerDragMove: (pointerId: number, x: number, y: number) => void;
  onPointerDragEnd: (payload: DraggedDocument, x: number, y: number) => void;
  onPointerDragCancel: () => void;
}) {
  const { topic, data, matches } = props;
  const topicMatch = Boolean(props.query && topic.name.toLocaleLowerCase().includes(props.query.toLocaleLowerCase()));
  const documents = data.documentTopics
    .filter((item) => item.topicId === topic.id)
    .map((item) => data.documents.find((document) => document.id === item.documentId))
    .filter((document): document is KnowledgeDocument => Boolean(document))
    .filter((document) => topicMatch || !matches || matches.has(document.id))
    .sort((a, b) => displayTitle(a).localeCompare(displayTitle(b), "zh-CN"));
  const children = data.topics.filter((item) => item.parentId === topic.id).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const isOpen = props.expanded.has(topic.id);
  if (matches && !topicMatch && !documents.length && !children.some((child) => topicContainsMatches(child.id, data, matches))) return null;

  return (
    <div
      className={`tree-group drop-zone ${props.dropTarget === topic.id ? "drop-active" : ""}`}
      data-topic-drop={topic.id}
    >
      <div className="tree-row folder-row">
        <button className="chevron" onClick={() => {
          const next = new Set(props.expanded);
          if (isOpen) next.delete(topic.id); else next.add(topic.id);
          props.onExpanded(next);
        }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        <Folder size={15} className="folder-icon" />
        <span>{topic.name}</span>
        <em>{props.dropTarget === topic.id ? "释放移动" : data.documentTopics.filter((item) => item.topicId === topic.id).length}</em>
        <details className="tree-menu" onClick={(event) => event.stopPropagation()} onToggle={(event) => {
          if (event.currentTarget.open) {
            props.onCloseDocumentMenu();
            closeOtherFolderMenus(event.currentTarget);
          }
        }}>
          <summary><MoreHorizontal size={15} /></summary>
          <div className="popover-menu">
            <button onClick={() => { closeFolderMenus(); props.onAdd(topic.id); }}>新建子主题</button>
            <button onClick={() => { closeFolderMenus(); props.onRename(topic); }}>重命名</button>
            <button className="danger" onClick={() => { closeFolderMenus(); props.onDelete(topic); }}>删除</button>
          </div>
        </details>
      </div>
      {isOpen && (
        <div className="tree-children">
          {children.map((child) => <TopicNode key={child.id} {...props} topic={child} />)}
          {documents.map((document) => (
            <DocumentRow
              key={`${topic.id}-${document.id}`}
              document={document}
              sourceTopicId={topic.id}
              active={document.id === props.currentDocumentId}
              onOpen={props.onOpen}
              dragging={props.dragging?.documentId === document.id}
              menuKey={`${topic.id}:${document.id}`}
              menuOpen={props.openDocumentMenu === `${topic.id}:${document.id}`}
              onMenu={props.onDocumentMenu}
              onMoveRequest={(value) => props.onMoveRequest(value, topic.id)}
              onUnlink={props.onUnlink}
              onPointerDragStart={props.onPointerDragStart}
              onPointerDragMove={props.onPointerDragMove}
              onPointerDragEnd={props.onPointerDragEnd}
              onPointerDragCancel={props.onPointerDragCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function topicContainsMatches(topicId: UUID, data: KnowledgeData, matches: Set<UUID>): boolean {
  const ids = new Set(data.documentTopics.filter((item) => item.topicId === topicId).map((item) => item.documentId));
  if ([...ids].some((id) => matches.has(id))) return true;
  return data.topics.filter((topic) => topic.parentId === topicId).some((topic) => topicContainsMatches(topic.id, data, matches));
}

function DocumentRow(props: {
  document: KnowledgeDocument;
  sourceTopicId: UUID | null;
  active: boolean;
  onOpen: (document: KnowledgeDocument) => void;
  dragging: boolean;
  menuKey: string;
  menuOpen: boolean;
  onMenu: (key: string) => void;
  onMoveRequest: (document: KnowledgeDocument) => void;
  onUnlink: (payload: DraggedDocument) => Promise<void>;
  onPointerDragStart: (payload: DraggedDocument, pointerId: number, x: number, y: number) => void;
  onPointerDragMove: (pointerId: number, x: number, y: number) => void;
  onPointerDragEnd: (payload: DraggedDocument, x: number, y: number) => void;
  onPointerDragCancel: () => void;
}) {
  const pointerStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const didDrag = useRef(false);

  function beginPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest(".tree-menu")) return;
    const payload = { documentId: props.document.id, sourceTopicId: props.sourceTopicId };
    pointerStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    didDrag.current = false;
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
    };
    const move = (value: PointerEvent) => {
      const start = pointerStart.current;
      if (!start || value.pointerId !== start.pointerId) return;
      if (!didDrag.current && Math.hypot(value.clientX - start.x, value.clientY - start.y) < 6) return;
      value.preventDefault();
      if (!didDrag.current) {
        didDrag.current = true;
        props.onPointerDragStart(payload, value.pointerId, value.clientX, value.clientY);
      }
      props.onPointerDragMove(value.pointerId, value.clientX, value.clientY);
    };
    const end = (value: PointerEvent) => {
      const start = pointerStart.current;
      if (!start || value.pointerId !== start.pointerId) return;
      cleanup();
      pointerStart.current = null;
      if (didDrag.current) {
        value.preventDefault();
        props.onPointerDragEnd(payload, value.clientX, value.clientY);
        window.setTimeout(() => { didDrag.current = false; }, 0);
      }
    };
    const cancel = (value: PointerEvent) => {
      if (value.pointerId !== pointerStart.current?.pointerId) return;
      cleanup();
      pointerStart.current = null;
      didDrag.current = false;
      props.onPointerDragCancel();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
  }

  return (
    <div
      className={`tree-row document-row ${props.active ? "active" : ""} ${props.dragging ? "dragging" : ""}`}
      onPointerDown={beginPointer}
      title="拖动到其他主题目录"
    >
      <GripVertical className="drag-handle" size={14} />
      <button className="document-open" onClick={(event) => {
        if (didDrag.current) {
          event.preventDefault();
          return;
        }
        props.onOpen(props.document);
      }}>
        <FileText size={15} />
        <span><strong>{displayTitle(props.document)}</strong><small>{formatBytes(props.document.size)}</small></span>
      </button>
      <div className="tree-menu document-menu" onPointerDown={(event) => event.stopPropagation()}>
        <button className="icon-button tree-menu-trigger" onClick={() => props.onMenu(props.menuKey)}><MoreHorizontal size={14} /></button>
        {props.menuOpen && (
          <div className="popover-menu right">
            <button onClick={() => { props.onMenu(props.menuKey); props.onOpen(props.document); }}>打开</button>
            <button onClick={() => props.onMoveRequest(props.document)}><FolderInput size={14} />移动到…</button>
            {props.sourceTopicId && (
              <button onClick={() => void props.onUnlink({
                documentId: props.document.id,
                sourceTopicId: props.sourceTopicId
              })}><FolderMinus size={14} />移出当前目录</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

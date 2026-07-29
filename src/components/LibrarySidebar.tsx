import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
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

function descendants(data: KnowledgeData, topicId: UUID): Topic[] {
  const children = data.topics.filter((topic) => topic.parentId === topicId);
  return children.flatMap((child) => [child, ...descendants(data, child.id)]);
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
  const [webDialog, setWebDialog] = useState(false);
  const [webURL, setWebURL] = useState("");

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

  async function showRecommendations(documents: KnowledgeDocument[]) {
    const groups = await Promise.all(
      documents.map(async (document) => ({ document, values: await api.recommendations(document.id) }))
    );
    setRecommendations(groups);
    setRecommendationSelection(
      new Set(groups.flatMap(({ document, values }) => values.map((value) => `${document.id}:${value.name}`)))
    );
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
    try {
      const before = new Set(data.documents.map((document) => document.id));
      const messages = await api.importWebPage(webURL);
      setMessage(messages.join(" · "));
      setWebDialog(false);
      setWebURL("");
      const next = await api.reload();
      onData(next);
      const imported = next.documents.filter((document) => !before.has(document.id));
      await showRecommendations(imported);
    } catch (error) {
      setMessage(String(error));
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

  async function deleteDocument(document: KnowledgeDocument) {
    if (
      window.confirm(
        `永久删除“${displayTitle(document)}”？\n这会删除 source 中的原始文件、索引、书签和批注；仅想调整分类时请拖动文档或删除主题。`
      )
    ) {
      onData(await api.deleteDocument(document.id));
    }
  }

  async function applyRecommended() {
    let next = data;
    for (const group of recommendations) {
      const names = group.values
        .filter((value) => recommendationSelection.has(`${group.document.id}:${value.name}`))
        .map((value) => value.name);
      next = await api.applyRecommendations(group.document.id, names);
    }
    onData(next);
    setRecommendations([]);
  }

  const linked = useMemo(() => new Set(data.documentTopics.map((item) => item.documentId)), [data.documentTopics]);
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
                onDeleteDocument={deleteDocument}
                onData={onData}
              />
            ))}
            {unclassified.length > 0 && (
              <div
                className="tree-group"
                onDragOver={(event) => event.preventDefault()}
                onDrop={async (event) => {
                  event.preventDefault();
                  const payload = parseDrag(event.dataTransfer.getData("application/x-knowledge-document"));
                  if (payload) onData(await api.moveDocument(payload.documentId, payload.sourceTopicId, null));
                }}
              >
                <div className="tree-row folder-row"><Folder size={15} /><span>未分类</span><em>{unclassified.length}</em></div>
                <div className="tree-children">
                  {unclassified.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      sourceTopicId={null}
                      active={document.id === currentDocumentId}
                      onOpen={onOpenDocument}
                      onDelete={deleteDocument}
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

      {webDialog && (
        <div className="modal-backdrop">
          <section className="modal compact">
            <h2>导入网页</h2>
            <p className="muted">网页将以 HTML 原文保存，可阅读、检索并用于 AI 问答。</p>
            <input autoFocus value={webURL} onChange={(event) => setWebURL(event.target.value)} placeholder="https://example.com/article" />
            <div className="modal-actions">
              <button onClick={() => setWebDialog(false)}>取消</button>
              <button className="primary" disabled={!webURL.trim()} onClick={importWeb}>导入</button>
            </div>
          </section>
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="modal-backdrop">
          <section className="modal recommendation-modal">
            <h2><Sparkles size={19} />推荐主题</h2>
            <p className="muted">根据文件名和正文关键词在本机推荐，确认后才建立关联。</p>
            <div className="recommendation-list">
              {recommendations.map(({ document, values }) => (
                <div key={document.id} className="recommendation-document">
                  <strong>{displayTitle(document)}</strong>
                  {values.length ? values.map((value) => {
                    const key = `${document.id}:${value.name}`;
                    return (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={recommendationSelection.has(key)}
                          onChange={(event) => {
                            const next = new Set(recommendationSelection);
                            if (event.target.checked) next.add(key); else next.delete(key);
                            setRecommendationSelection(next);
                          }}
                        />
                        <span>{value.name}<small>{value.reason}</small></span>
                      </label>
                    );
                  }) : <span className="muted">暂无可靠推荐，可保持未分类。</span>}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button onClick={() => setRecommendations([])}>稍后处理</button>
              <button className="primary" onClick={applyRecommended}>应用所选主题</button>
            </div>
          </section>
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
  onDeleteDocument: (document: KnowledgeDocument) => void;
  onData: (data: KnowledgeData) => void;
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
      className="tree-group"
      onDragOver={(event) => event.preventDefault()}
      onDrop={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const payload = parseDrag(event.dataTransfer.getData("application/x-knowledge-document"));
        if (payload) props.onData(await api.moveDocument(payload.documentId, payload.sourceTopicId, topic.id));
      }}
    >
      <div className="tree-row folder-row">
        <button className="chevron" onClick={() => {
          const next = new Set(props.expanded);
          if (isOpen) next.delete(topic.id); else next.add(topic.id);
          props.onExpanded(next);
        }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        <Folder size={15} className="folder-icon" />
        <span>{topic.name}</span>
        <em>{data.documentTopics.filter((item) => item.topicId === topic.id).length}</em>
        <details className="tree-menu" onClick={(event) => event.stopPropagation()}>
          <summary><MoreHorizontal size={15} /></summary>
          <div className="popover-menu">
            <button onClick={() => props.onAdd(topic.id)}>新建子主题</button>
            <button onClick={() => props.onRename(topic)}>重命名</button>
            <button className="danger" onClick={() => props.onDelete(topic)}>删除</button>
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
              onDelete={props.onDeleteDocument}
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
  onDelete: (document: KnowledgeDocument) => void;
}) {
  return (
    <div
      className={`tree-row document-row ${props.active ? "active" : ""}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(
          "application/x-knowledge-document",
          JSON.stringify({ documentId: props.document.id, sourceTopicId: props.sourceTopicId })
        );
      }}
    >
      <button className="document-open" onClick={() => props.onOpen(props.document)}>
        <FileText size={15} />
        <span><strong>{displayTitle(props.document)}</strong><small>{formatBytes(props.document.size)}</small></span>
      </button>
      <details className="tree-menu" onClick={(event) => event.stopPropagation()}>
        <summary><MoreHorizontal size={14} /></summary>
        <div className="popover-menu right">
          <button onClick={() => props.onOpen(props.document)}>打开</button>
          <button className="danger" onClick={() => props.onDelete(props.document)}>永久删除资料</button>
        </div>
      </details>
    </div>
  );
}

function parseDrag(value: string): { documentId: UUID; sourceTopicId: UUID | null } | null {
  try {
    const parsed = JSON.parse(value);
    return parsed?.documentId ? parsed : null;
  } catch {
    return null;
  }
}

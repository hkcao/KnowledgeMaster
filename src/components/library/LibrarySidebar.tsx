import { useState, useEffect } from "react";
import { useStore } from "../../state/store";
import type { KnowledgeDocument, Topic } from "../../types/models";

interface Props {
  currentDocument: KnowledgeDocument | null;
  onOpen: (doc: KnowledgeDocument) => void;
}

export function LibrarySidebar({ currentDocument, onOpen }: Props) {
  const {
    data, selectedTopicId, searchDocuments,
    createTopic, renameTopic, deleteTopic,
    importFiles, deleteDocument,
  } = useStore();

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeDocument[] | null>(null);
  const [showNewTopic, setShowNewTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicParentId, setNewTopicParentId] = useState<string | undefined>();
  const [renamingTopic, setRenamingTopic] = useState<Topic | null>(null);
  const [renameName, setRenameName] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [libraryPath, setLibraryPath] = useState("");

  useEffect(() => {
    const loadPath = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const path = await invoke<string>("get_library_root");
        setLibraryPath(path);
      } catch {}
    };
    loadPath();
  }, []);

  const topics = data?.topics || [];
  const documents = data?.documents || [];
  const allTopicIds = data?.document_topics?.map((dt) => dt.document_id) || [];

  const isCloudPath = libraryPath.includes("CloudDocs") || libraryPath.includes("iCloud");

  const performSearch = async (q: string) => {
    setQuery(q);
    if (q.trim()) {
      const results = await searchDocuments(q, selectedTopicId || undefined);
      setSearchResults(results);
    } else {
      setSearchResults(null);
    }
  };

  // Build topic tree
  const rootTopics = topics.filter((t) => !t.parent_id || !topics.some((p) => p.id === t.parent_id));
  const childrenOf = (parentId: string) => topics.filter((t) => t.parent_id === parentId);

  const handleImport = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({
        multiple: true,
        filters: [{ name: "Document", extensions: ["pdf", "html", "htm", "md", "txt", "doc", "docx"] }],
      });
      if (result) {
        const paths = Array.isArray(result) ? result : [result];
        const msgs = await importFiles(paths);
        setImportMsg(msgs.join(" · "));
      }
    } catch (e: any) {
      setImportMsg(e.toString());
    }
  };

  const handleChangeLibrary = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, multiple: false, title: "选择知识库目录" });
      if (dir && typeof dir === "string") {
        const migrate = documents.length === 0 || confirm("是否将现有资料迁移到新目录？");
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("switch_library_root", { newRoot: dir, migrate });
        await useStore.getState().loadData();
        setLibraryPath(dir);
      }
    } catch (e: any) {
      setImportMsg(`切换失败：${e}`);
    }
  };

  const displayDocs = searchResults || documents;

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Header with title and settings */}
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[var(--color-border)]">
        <span className="text-lg">📚</span>
        <h1 className="text-base font-bold flex-1">知屿</h1>
        <span className="text-xs text-secondary">{documents.length} 份</span>
        <button
          onClick={() => useStore.setState({ showSettings: true })}
          className="p-1.5 text-sm hover:bg-[var(--color-hover)] rounded-md transition-colors"
          title="设置"
        >
          ⚙️
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pt-2 pb-1">
        <input
          type="text"
          placeholder="搜索文件名、正文或主题…"
          className="w-full px-3 py-1.5 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-accent)] transition-colors"
          value={query}
          onChange={(e) => performSearch(e.target.value)}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 px-3 py-2">
        <button onClick={handleImport} className="flex-1 px-2.5 py-1.5 bg-[var(--color-accent)] text-white rounded-md text-xs font-medium hover:opacity-90 transition-opacity">
          📥 导入文件
        </button>
        <button
          onClick={() => { setShowNewTopic(true); setNewTopicParentId(undefined); }}
          className="px-2 py-1.5 border border-[var(--color-border)] rounded-md text-xs hover:bg-[var(--color-hover)] transition-colors"
          title="新建主题"
        >
          📁+
        </button>
      </div>

      {importMsg && (
        <div className="px-3 pb-1.5 text-[11px] text-secondary leading-tight">{importMsg}</div>
      )}

      {/* Topic tree */}
      <div className="flex-1 overflow-y-auto px-1">
        <div className="flex items-center px-3 py-1.5">
          <span className="text-[11px] font-semibold text-secondary uppercase tracking-wide flex-1">知识目录</span>
        </div>

        {rootTopics.map((topic) => (
          <TopicItem
            key={topic.id}
            topic={topic}
            depth={0}
            selectedTopicId={selectedTopicId}
            documents={displayDocs}
            currentDocument={currentDocument}
            topicIds={data?.document_topics || []}
            childrenOf={childrenOf}
            onSelect={() => {
              useStore.setState({ selectedTopicId: topic.id });
              performSearch(query);
            }}
            onRename={() => { setRenamingTopic(topic); setRenameName(topic.name); }}
            onDelete={() => deleteTopic(topic.id)}
            onNewChild={() => { setShowNewTopic(true); setNewTopicParentId(topic.id); }}
            onOpen={onOpen}
            onDeleteDoc={deleteDocument}
          />
        ))}

        {/* Unclassified docs */}
        {(() => {
          const unclassified = documents.filter((d) => !allTopicIds.includes(d.id));
          if (unclassified.length === 0) return null;
          return (
            <div className="mt-1">
              <div className="px-3 py-1 text-[11px] text-secondary font-medium">未分类</div>
              {unclassified.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => onOpen(doc)}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded hover:bg-[var(--color-hover)] transition-colors flex items-center gap-2 ${
                    currentDocument?.id === doc.id ? "bg-[var(--color-accent-light)]" : ""
                  }`}
                >
                  <span className="text-xs opacity-50 shrink-0">
                    {doc.extension === ".pdf" ? "📄" : "📝"}
                  </span>
                  <span className="truncate">{doc.display_name?.trim() || doc.name}</span>
                </button>
              ))}
            </div>
          );
        })()}

        {displayDocs.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-secondary">
            {query ? "没有匹配结果" : "还没有资料，点击导入按钮添加"}
          </div>
        )}
      </div>

      {/* Footer - library path */}
      <div className="border-t border-[var(--color-border)] px-3 py-2 bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-secondary truncate flex-1 leading-tight">
            {isCloudPath ? "☁️ iCloud" : "💾 本地"} · {libraryPath.split("/").slice(-3).join("/") || libraryPath}
          </span>
          <button
            onClick={handleChangeLibrary}
            className="text-[10px] px-1.5 py-0.5 text-[var(--color-accent)] hover:bg-[var(--color-hover)] rounded shrink-0 transition-colors"
            title="更改知识库目录"
          >
            更改
          </button>
        </div>
      </div>

      {/* New topic dialog */}
      {showNewTopic && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/20 z-50" onClick={() => setShowNewTopic(false)}>
          <div className="bg-[var(--color-bg)] rounded-lg shadow-xl p-6 w-[360px]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-4">{newTopicParentId ? "新建子主题" : "新建主题"}</h2>
            <input
              type="text"
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] mb-4 outline-none focus:border-[var(--color-accent)]"
              placeholder="主题名称"
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  createTopic(newTopicName, newTopicParentId);
                  setShowNewTopic(false);
                  setNewTopicName("");
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewTopic(false)} className="px-4 py-1.5 text-sm">取消</button>
              <button
                onClick={() => {
                  createTopic(newTopicName, newTopicParentId);
                  setShowNewTopic(false);
                  setNewTopicName("");
                }}
                className="px-4 py-1.5 bg-[var(--color-accent)] text-white rounded-md text-sm"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename topic dialog */}
      {renamingTopic && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/20 z-50" onClick={() => setRenamingTopic(null)}>
          <div className="bg-[var(--color-bg)] rounded-lg shadow-xl p-6 w-[360px]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-4">重命名主题</h2>
            <input
              type="text"
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] mb-4 outline-none focus:border-[var(--color-accent)]"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  renameTopic(renamingTopic.id, renameName);
                  setRenamingTopic(null);
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRenamingTopic(null)} className="px-4 py-1.5 text-sm">取消</button>
              <button
                onClick={() => { renameTopic(renamingTopic.id, renameName); setRenamingTopic(null); }}
                className="px-4 py-1.5 bg-[var(--color-accent)] text-white rounded-md text-sm"
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

function TopicItem({
  topic, depth, selectedTopicId, documents, currentDocument, topicIds, childrenOf,
  onSelect, onRename, onDelete, onNewChild, onOpen, onDeleteDoc,
}: {
  topic: Topic; depth: number;
  selectedTopicId: string | null;
  documents: KnowledgeDocument[];
  currentDocument: KnowledgeDocument | null;
  topicIds: { document_id: string; topic_id: string }[];
  childrenOf: (parentId: string) => Topic[];
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNewChild: () => void;
  onOpen: (doc: KnowledgeDocument) => void;
  onDeleteDoc: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  const children = childrenOf(topic.id);
  const linkedDocs = documents.filter((d) =>
    topicIds.some((dt) => dt.document_id === d.id && dt.topic_id === topic.id)
  );

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer hover:bg-[var(--color-hover)] transition-colors group ${
          selectedTopicId === topic.id ? "bg-[var(--color-accent-light)]" : ""
        }`}
        style={{ paddingLeft: `${6 + depth * 12}px` }}
        onClick={onSelect}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-[10px] w-4 h-4 flex items-center justify-center opacity-40 hover:opacity-80 shrink-0"
        >
          {expanded ? "▼" : "▶"}
        </button>
        <span className="text-xs mr-1 shrink-0">📁</span>
        <span className="flex-1 text-sm truncate">{topic.name}</span>
        <span className="text-[10px] text-secondary mr-1">{linkedDocs.length}</span>
        <div className="hidden group-hover:flex items-center gap-0.5">
          <button onClick={(e) => { e.stopPropagation(); onNewChild(); }} className="text-[10px] px-0.5 hover:opacity-70" title="新建子主题">+</button>
          <button onClick={(e) => { e.stopPropagation(); onRename(); }} className="text-[10px] px-0.5 hover:opacity-70" title="重命名">✎</button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-[10px] px-0.5 hover:opacity-70 text-red-500" title="删除">×</button>
        </div>
      </div>

      {expanded && (
        <>
          {children.map((child) => (
            <TopicItem
              key={child.id}
              topic={child}
              depth={depth + 1}
              selectedTopicId={selectedTopicId}
              documents={documents}
              currentDocument={currentDocument}
              topicIds={topicIds}
              childrenOf={childrenOf}
              onSelect={() => {}}
              onRename={() => {}}
              onDelete={() => {}}
              onNewChild={() => {}}
              onOpen={onOpen}
              onDeleteDoc={onDeleteDoc}
            />
          ))}
          {linkedDocs.map((doc) => (
            <div
              key={doc.id}
              className={`flex items-center gap-2 rounded cursor-pointer hover:bg-[var(--color-hover)] transition-colors group text-sm ${
                currentDocument?.id === doc.id ? "bg-[var(--color-accent-light)]" : ""
              }`}
              style={{ paddingLeft: `${22 + depth * 12}px` }}
            >
              <span className="text-xs opacity-50 shrink-0">{doc.extension === ".pdf" ? "📄" : "📝"}</span>
              <span className="flex-1 truncate py-1.5" onClick={() => onOpen(doc)}>
                {doc.display_name?.trim() || doc.name}
              </span>
              <button
                onClick={() => onDeleteDoc(doc.id)}
                className="hidden group-hover:block text-[10px] text-red-500 hover:opacity-70 mr-1 shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

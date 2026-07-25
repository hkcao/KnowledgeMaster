import { useState } from "react";
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

  const topics = data?.topics || [];
  const documents = data?.documents || [];

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

  const displayDocs = searchResults || documents;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[var(--color-border)]">
        <h1 className="text-base font-bold">知屿</h1>
        <span className="text-xs text-secondary">{documents.length} 份</span>
        <div className="flex-1" />
      </div>

      {/* Search */}
      <div className="p-3">
        <input
          type="text"
          placeholder="搜索文件名、正文或主题…"
          className="w-full px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-accent)]"
          value={query}
          onChange={(e) => performSearch(e.target.value)}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-3 pb-2">
        <button onClick={handleImport} className="px-3 py-1.5 bg-[var(--color-accent)] text-white rounded-md text-sm font-medium hover:opacity-90">
          导入文件
        </button>
        <button
          onClick={() => { setShowNewTopic(true); setNewTopicParentId(undefined); }}
          className="px-3 py-1.5 border border-[var(--color-border)] rounded-md text-sm hover:bg-[var(--color-hover)]"
        >
          新建主题
        </button>
      </div>

      {importMsg && (
        <div className="px-3 pb-2 text-xs text-secondary">{importMsg}</div>
      )}

      {/* Topic tree */}
      <div className="flex-1 overflow-y-auto px-1">
        <div className="px-3 py-1.5 text-xs font-semibold text-secondary uppercase tracking-wide">
          知识目录
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
        {documents.filter((d) => {
          const linked = data?.document_topics?.map((dt) => dt.document_id) || [];
          return !linked.includes(d.id);
        }).length > 0 && (
          <div className="mt-2">
            <div className="px-3 py-1 text-xs text-secondary font-medium">未分类</div>
            {documents
              .filter((d) => {
                const linked = data?.document_topics?.map((dt) => dt.document_id) || [];
                return !linked.includes(d.id);
              })
              .map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => onOpen(doc)}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded hover:bg-[var(--color-hover)] flex items-center gap-2 ${
                    currentDocument?.id === doc.id ? "bg-[var(--color-accent-light)]" : ""
                  }`}
                >
                  <span className="text-xs opacity-50">
                    {doc.extension === ".pdf" ? "📄" : "📝"}
                  </span>
                  <span className="truncate">{doc.display_name?.trim() || doc.name}</span>
                </button>
              ))}
          </div>
        )}

        {displayDocs.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-secondary">
            {query ? "没有匹配结果" : "还没有资料，点击导入"}
          </div>
        )}
      </div>

      {/* New topic dialog */}
      {showNewTopic && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-50" onClick={() => setShowNewTopic(false)}>
          <div className="bg-[var(--color-bg)] rounded-lg shadow-xl p-6 w-[360px]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">{newTopicParentId ? "新建子主题" : "新建主题"}</h2>
            <input
              type="text"
              className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] mb-4"
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
              <button onClick={() => setShowNewTopic(false)} className="px-4 py-2 text-sm">取消</button>
              <button
                onClick={() => {
                  createTopic(newTopicName, newTopicParentId);
                  setShowNewTopic(false);
                  setNewTopicName("");
                }}
                className="px-4 py-2 bg-[var(--color-accent)] text-white rounded-md text-sm"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename topic dialog */}
      {renamingTopic && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-50" onClick={() => setRenamingTopic(null)}>
          <div className="bg-[var(--color-bg)] rounded-lg shadow-xl p-6 w-[360px]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">重命名主题</h2>
            <input
              type="text"
              className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] mb-4"
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
              <button onClick={() => setRenamingTopic(null)} className="px-4 py-2 text-sm">取消</button>
              <button
                onClick={() => { renameTopic(renamingTopic.id, renameName); setRenamingTopic(null); }}
                className="px-4 py-2 bg-[var(--color-accent)] text-white rounded-md text-sm"
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
        className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer hover:bg-[var(--color-hover)] ${
          selectedTopicId === topic.id ? "bg-[var(--color-accent-light)]" : ""
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs w-4 h-4 flex items-center justify-center opacity-50 hover:opacity-100"
        >
          {expanded ? "▼" : "▶"}
        </button>
        <span onClick={onSelect} className="flex-1 text-sm truncate">
          📁 {topic.name}
        </span>
        <span className="text-xs text-secondary">{linkedDocs.length}</span>
        <button onClick={onNewChild} className="text-xs px-1 hover:opacity-70" title="新子主题">+</button>
        <button onClick={onRename} className="text-xs px-1 hover:opacity-70" title="重命名">✎</button>
        <button onClick={onDelete} className="text-xs px-1 hover:opacity-70 text-red-500" title="删除">×</button>
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
              className={`flex items-center gap-2 pl-3 py-1 rounded cursor-pointer hover:bg-[var(--color-hover)] text-sm ${
                currentDocument?.id === doc.id ? "bg-[var(--color-accent-light)]" : ""
              }`}
              style={{ paddingLeft: `${24 + depth * 12}px` }}
            >
              <span className="text-xs opacity-50">{doc.extension === ".pdf" ? "📄" : "📝"}</span>
              <span className="flex-1 truncate" onClick={() => onOpen(doc)}>
                {doc.display_name?.trim() || doc.name}
              </span>
              <button
                onClick={() => onDeleteDoc(doc.id)}
                className="text-xs opacity-0 hover:opacity-70 text-red-500"
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

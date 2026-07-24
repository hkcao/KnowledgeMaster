# macOS → Windows 功能迁移对照

| macOS 模块 | Windows 实现 | 状态 |
| --- | --- | --- |
| `KnowledgeStore` | Electron 主进程文件服务、版本 5 JSON、原子备份 | 已迁移 |
| `LibraryView` | React 资料库、主题树、检索、递归/拖拽导入 | 已迁移 |
| `PDFReaderView` | Chromium PDF 阅读器、页码与书签 | 基础迁移 |
| `RichTextReaderView` | Markdown/纯文本阅读与选区批注 | 已迁移 |
| `DocumentExtractor` | pdf-parse、Mammoth、HTML/TXT/Markdown 提取 | 已迁移 |
| `DocumentExporter` | 原文件导出 | 部分迁移 |
| `ChatView` / `AIClient` | OpenAI 兼容聊天、相关片段上下文 | 已迁移 |
| `KnowledgeFileTools` | Agent 只读资料副本与 generated 工作区 | 已迁移 |
| `AgentRunner` | Windows 子进程运行 Claude Code/Codex | 已迁移 |
| `AppSettings` / Keychain | JSON 设置 + Windows DPAPI (`safeStorage`) | 已迁移 |
| `ChatMarkdownView` | marked + DOMPurify Markdown 渲染 | 已迁移 |
| `SummaryNote` | Markdown 编辑、预览与 `source/notes/` 文件 | 已迁移 |
| PDFKit 几何批注 | Chromium PDF 内嵌阅读 | 待增强 |
| PDFKit 合并批注导出 | 当前导出原 PDF | 待增强 |

## 数据兼容约束

- `knowledge.json` 保持 `version: 5`。
- Swift 的 `extensionName` 编码键继续使用 JSON 的 `extension`。
- 日期继续使用 ISO 8601 字符串。
- 文档继续存储为 `source/documents/<UUID>--<原文件名>`。
- 全文缓存位于 `source/index/<UUID>.txt`，可删除重建。
- 笔记位于 `source/notes/`；Agent 输出位于 `source/generated/`。

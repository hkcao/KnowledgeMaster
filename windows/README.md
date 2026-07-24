# KnowledgeMaster for Windows

Windows 版本以 `agent/native-macos-only` 为功能与数据基线，采用 Electron、React 和
TypeScript 实现。它保留 macOS 版本的本地资料库结构，可直接打开包含
`knowledge.json` 与 `source/` 的已有资料库。

## 已迁移功能

- PDF、DOCX、HTML、Markdown、TXT 文件导入；支持目录递归、拖拽和网页保存。
- `source/documents/` 扁平存储、SHA-256 内容去重、文件名去重和全文索引。
- 虚拟主题与子主题、跨主题文档关联、文件名与正文关键词检索。
- PDF 内嵌阅读、文本/Markdown 阅读、页码书签、系统应用打开和原文件导出。
- 文本高亮、下划线、批注及 Markdown 研究笔记。
- DeepSeek、智谱 GLM、自定义 OpenAI 兼容接口。
- Claude Code 与 Codex 本地 Agent；原始资料副本只读，生成文件写入
  `source/generated/`。
- 对话、来源片段、主题、批注、书签和笔记继续写入版本 5 的 `knowledge.json`。
- API Key 使用 Electron `safeStorage`，在 Windows 上由 DPAPI 保护。
- 元数据原子写入，并保留 `knowledge.json.bak`。

## Windows 特有实现与边界

- PDF 使用 Chromium/Edge PDF 阅读器。页码书签可持久化；PDF 选区的几何坐标批注
  尚未达到 macOS PDFKit 的同等能力。文本、Markdown、HTML 与 DOCX 提取文本可直接
  建立选区批注。
- 原文件导出已支持；把 PDFKit 批注写回 PDF 的“合并批注导出”尚未实现，因此当前
  导出的 PDF 是原始文件。
- `.docx` 使用 Mammoth 提取文本；旧 `.doc` 可通过系统 Word 打开，但建议先转换为
  `.docx` 以建立全文索引。
- Windows 版不会读取 macOS 钥匙串。首次使用 AI 时需在 Windows 设置中重新保存
  API Key。
- iCloud Drive 可作为资料库目录，但不要让 macOS 与 Windows 同时写同一个
  `knowledge.json`。

## 开发与构建

要求 Windows 10/11 x64、Node.js 20+ 和 npm 10+。

```powershell
cd windows
npm install
npm run dev
npm run test
npm run typecheck
npm run build
```

生成免安装目录或 NSIS 安装包：

```powershell
.\scripts\build-windows.ps1
.\scripts\build-windows.ps1 -Installer
```

构建结果位于 `windows/release/`。

自动化测试或企业部署可通过 `KM_LIBRARY_ROOT` 环境变量覆盖首次启动的默认资料库位置；
用户在设置中选择过资料库后，以已保存设置为准。

## 从 macOS 资料库迁移

1. 在 macOS 版中确认所有写入已完成并退出应用。
2. 将整个资料库目录复制到 Windows，目录必须同时包含 `knowledge.json` 和 `source/`。
3. 启动 Windows 版，打开“设置 → 资料库位置”。
4. 选择复制后的目录；在迁移提示中选择“不复制，直接打开”。
5. 检查主题、文档、书签、批注、对话和笔记数量。

Windows 版不会修改文档 ID、主题 ID 或相对 `storedPath`，因此回滚到资料库备份时无需
做数据库转换。

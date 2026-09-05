# KnowledgeMaster 开发交接

更新日期：2026-09-05（Asia/Shanghai）

本文档供后续 Codex/开发者在新窗口中继续工作。开始前请以实际 `git status`、远端分支、GitHub Actions 和 Release 为准；本文记录的是上述日期核验过的状态。

本项目使用个人 `project-handoff` Skill（`/Users/hank/.codex/skills/project-handoff`）持续维护本文档。发生重要决策、实现、验证、发布或工作区状态变化时更新同一文件，不创建按日期重复的交接文档。

## 1. 项目定位与不可破坏的约束

知屿 KnowledgeMaster 是面向科研论文学习的本地优先桌面知识工作台，正式实现同时支持 macOS 和 Windows。

必须保持以下约束：

- 技术栈是 Tauri 2 + React 19 + TypeScript + Vite + Rust，不使用 Electron。
- PDF 使用 PDF.js 渲染和文字层，不能依赖仅 macOS 可用的 PDFKit。
- 第一阶段使用标题、作者、主题、正文和本地 chunk 的关键词检索，不引入向量数据库。
- 用户可以配置资料库目录；iCloud Drive、OneDrive 等同步依赖用户选择的系统同步路径。
- 一个文档可以属于多个虚拟主题；从主题移除文档只删除关联，不删除原件。
- Agent 不得直接修改或删除知识库原件。选定问答范围后，应用创建隔离临时工作区，并放入只读原件副本和已有解析缓存。
- 未选择文本、文档或主题时默认纯聊天，不主动加载本地资料。
- API Key 只在发送请求、测试连接、保存或清除时访问，不能在应用启动、打开设置或切换模型时提前读取。
- Claude Code/Codex 只有在本机检测到可执行文件时才能选择；应用退出时只终止由本次应用启动的 Agent 进程。
- Agent 下载文件先进入待确认区，用户确认导入后还要确认虚拟主题。
- 不要把 API Key、用户私有资料或本机凭据提交到仓库。

完整产品行为规格见 [REPLICATION_PROMPT.md](REPLICATION_PROMPT.md)，面向用户的功能与安装说明见 [中文 README](../README.md) 和 [English README](../README.en.md)。

## 2. 仓库与当前 Git 状态

- 本地目录：`/Users/hank/Desktop/知识整理器`
- GitHub：`https://github.com/hkcao/KnowledgeMaster`
- 仓库：Public，MIT License
- 当前分支：`main`
- 当前代码/清理基线：`9f4587fc46b978ccb1f0de0c6841399f6e3d3cb8`
- 基线提交：`chore: remove legacy native macOS implementation`
- 当前正式版本/标签：`v0.2.5`
- 本地 `main` 和 `origin/main` 已包含上述清理提交；`v0.2.5` 标签仍停在此前的 `78b4b95b6a5d9a40fa9327839510321411d715af`。
- 本节自身会通过紧随清理提交的文档提交同步到 `origin/main`；精确最新 HEAD 请以 `git rev-parse HEAD` 和 `git ls-remote origin refs/heads/main` 为准。

目录整理已经提交并推送：

- 删除已废弃的 Swift/macOS 旧实现：`Package.swift`、`Sources/`、`Resources/`、`scripts/`、`tests/KnowledgeMasterTests/`。
- 修改 `.github/workflows/tauri-ci.yml`，macOS 从 `.app` ZIP 改为直接构建并发布 `.dmg`。
- 更新 `README.md`、`README.en.md` 和 `docs/REPLICATION_PROMPT.md`，移除旧原生实现/迁移表述并统一为 DMG 安装说明。
- 清理提交共 60 个文件，273 行新增、7757 行删除，其中包含首次加入的本文档。
- 提交前 `git diff --cached --check` 通过；推送后仍需以 GitHub Actions 结果区分“源码已推送”和“安装包已发布”。

## 3. 已发布状态与待发布差异

当前公开 Release：<https://github.com/hkcao/KnowledgeMaster/releases/tag/v0.2.5>

交接时 `v0.2.5` 实际附件为：

- `KnowledgeMaster-macOS.zip`
- `KnowledgeMaster-portable.exe`
- `KnowledgeMaster_0.2.5_x64-setup.exe`

已推送的 CI 配置不再生成 macOS ZIP，改为：

```yaml
- macOS runner: npm run tauri build -- --bundles dmg
- upload path: src-tauri/target/release/bundle/dmg/*.dmg
```

因此“DMG 已在本地验证”不等于“DMG 已出现在公开 Release”。若用户要求更新线上包，推荐发布新版本（例如 `v0.2.6`），不要静默移动已有标签。发布前同步修改以下五处版本号：

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

推送 `main` 和 `v*` 标签会各触发一次 CI；标签流水线才负责创建 Release。若两套相同构建同时运行，可保留标签流水线并取消重复的 `main` 流水线。

## 4. 本地目录清理状态

已删除以下 `.gitignore` 中的本机构建或工具产物：

- `src-tauri/target/`
- `node_modules/`
- `dist/`
- `.build/`
- `.codegraph/`
- `artifacts/`
- `release/`
- `src-tauri/gen/`
- `src-tauri/icons/android/`
- `src-tauri/icons/ios/`
- `test_data/`
- `.DS_Store`

清理前这些内容约占 10GB。当前源码本身不足 1MB；目录仍约 1.1GB，几乎全部来自 `.git/objects` 的可达历史。没有重写历史或执行激进 Git 清理，以免破坏标签、分支或尚未合并的历史。

因为依赖和构建目录已删除，新窗口首次测试前需要重新安装/构建；验证完成后可再次删除这些被忽略的产物：

```bash
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

## 5. 最近一次本地验证结果

当前 Tauri 源码和目录整理变更已完成以下验证：

- 2026-09-05 提交前重新执行 `npm test`：1 个测试文件，12 项测试通过。
- 2026-09-05 提交前重新执行 `npm run build`：通过；Vite 仅提示主 bundle 大于 500kB。
- `cargo test --manifest-path src-tauri/Cargo.toml`：28 项 Rust 测试通过。
- `npm run tauri build -- --bundles dmg`：成功生成 `知屿 KnowledgeMaster_0.2.5_aarch64.dmg`。
- `hdiutil verify`：DMG 校验有效。
- DMG 构建需要调用 macOS `hdiutil`；受限沙箱中脚本可能失败，允许系统级构建后可以成功。

构建产物随后按目录清理要求删除，当前本地不再保留该 DMG。

本次恢复依赖时，直接执行 `npm ci` 因 `~/.npm` 含历史 root-owned 缓存文件而报 `EPERM`。未修改用户目录权限，改用 `npm ci --cache /tmp/knowledgemaster-npm-cache` 后成功；测试结束后重新删除了 `node_modules/`、`dist/` 和临时缓存。

严格执行 `cargo clippy --all-targets -- -D warnings` 时，仓库在此前检查中仍有 5 条既有 warning（位于 `ai.rs`、`store.rs`、`lib.rs` 的旧代码）。它们不是 SQLite/批注修改引入的，但如果后续把 Clippy 加入 CI，需要先单独处理。

## 6. 代码结构与入口

### 前端

- `src/main.tsx`：React 入口。
- `src/App.tsx`：应用顶层状态、三栏布局、标签页和聊天位置编排。
- `src/api.ts`：前端对 Tauri command 的类型化调用封装。
- `src/types.ts`：前端数据类型。
- `src/styles.css`：全局 ReadCube 风格、阅读器、侧栏、聊天和弹窗样式。
- `src/components/LibrarySidebar.tsx`：虚拟目录树、搜索、导入、网页导入、拖放移动、推荐主题确认。
- `src/components/Reader.tsx`：PDF/HTML/Markdown/TXT 阅读、PDF.js 渲染、缩放、选区工具条、批注、书签和导出。
- `src/components/ChatPanel.tsx`：直接 API、Claude Code/Codex、问答范围、执行过程、终止、待确认下载和对话历史。
- `src/components/NotesPanel.tsx`：注释类笔记和总结类 Markdown 笔记。
- `src/components/SettingsModal.tsx`：资料库目录、API、模型和 Agent 设置。
- `src/components/MarkdownView.tsx`：GFM、KaTeX/LaTeX 渲染。
- `src/utils.ts` / `src/utils.test.ts`：前端纯函数及 Vitest 测试。

### Rust/Tauri

- `src-tauri/src/main.rs`：原生入口，调用库层 `run()`。
- `src-tauri/src/lib.rs`：Tauri command、共享状态、命令注册和部分回归测试。
- `src-tauri/src/models.rs`：持久化与传输模型；当前 `KnowledgeData.version = 8`。
- `src-tauri/src/store.rs`：资料库目录、导入/去重、文档提取、论文命名、主题、搜索、chunk、上下文与路径安全。
- `src-tauri/src/database.rs`：SQLite schema、旧 JSON 迁移、关系修复、读取和增量快照保存。
- `src-tauri/src/ai.rs`：直接 API、相关片段模式和自主工具模式。
- `src-tauri/src/agent.rs`：Claude Code/Codex 发现、进程、会话、隔离工作区、流式轨迹和终止。
- `src-tauri/src/export.rs`：原文和带批注版本导出。
- `src-tauri/tauri.conf.json`：窗口、CSP、图标和跨平台打包配置。
- `src-tauri/capabilities/default.json`：Tauri 权限声明。

## 7. 数据目录和持久化

用户选择的是资料库根目录；如果在设置中选择了名为 `source` 的目录，后端会解析为其父目录作为资料库根。

```text
<library>/
├── knowledge.db                   # SQLite 元数据
├── knowledge.json.migrated-v8.bak # 仅旧 JSON 首次迁移时生成
└── source/
    ├── documents/                 # 导入原件，平铺存储
    ├── downloads/pending/         # Agent 下载待确认
    ├── generated/agent-cache/     # PDF/OCR/解析缓存
    ├── index/                     # 原始解析文本和 chunk 缓存
    └── notes/                     # 总结类 Markdown 文件
```

SQLite 使用 `rusqlite` bundled，当前 schema version 为 1，数据版本为 8。主要表：

- `documents`、`document_authors`
- `topics`、`document_topics`
- `bookmarks`
- `annotations`、`annotation_rects`
- `conversations`、`conversation_documents`、`conversation_topics`、`conversation_messages`
- `agent_sessions`
- `topic_summaries`
- `summary_notes`、`summary_note_annotations`
- `entity_fingerprints`

数据库启用外键，使用 rollback journal（`journal_mode=DELETE`）和 `synchronous=FULL`。这是为了避免 WAL sidecar 在 iCloud/OneDrive 等同步目录中造成额外一致性问题。不要未经迁移设计就改用 WAL。

旧 `knowledge.json` 首次启动会迁移到 `knowledge.db`，修复无效关系和重复关联，规范化旧批注矩形，并留下 `knowledge.json.migrated-v8.bak`。不要让新版继续同时写 JSON 和 SQLite。

## 8. 最近完成的关键功能

`v0.2.5` 已发布内容包括：

- 元数据从 JSON 迁移到规范化 SQLite。
- 文件标题/作者提取修复，原始文档名称随识别结果更新。
- PDF 重复/相邻选区矩形合并，减少高亮颜色叠加。
- 已高亮区域阻止再次叠加批注。
- 点击高亮/划线区域可打开编辑器，添加或更新笔记并删除批注。
- 中文和英文 README。
- macOS、Windows 跨平台 Release 流程；`v0.2.5` 当时仍使用 macOS ZIP。

隔离资料库的真实 UI 冒烟测试曾验证：旧 JSON 自动迁移、PDF 导入和打开、划词工具条、高亮、点击高亮、保存笔记、重新打开及删除，SQLite `integrity_check=ok`。

## 9. 发布流程

本地常用命令：

```bash
# 开发
npm ci
npm run tauri dev

# 测试
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build

# macOS DMG
npm run tauri build -- --bundles dmg

# Windows（在 Windows 上）
npm run tauri build -- --bundles nsis
Copy-Item src-tauri\target\release\knowledge-master.exe KnowledgeMaster-portable.exe
```

GitHub Actions 文件：`.github/workflows/tauri-ci.yml`

- macOS runner：测试并构建 DMG。
- Windows runner：测试并构建 NSIS，同时复制免安装 `KnowledgeMaster-portable.exe`。
- `v*` 标签：下载平台 artifact，创建或更新同名 GitHub Release，并上传全部文件。
- 应用未做 Apple 公证或 Windows 代码签名；README 已说明首次打开方式。

## 10. 已知限制和后续关注点

产品级限制：

1. 尚无自动召回的跨会话长期记忆。
2. 模型上下文压缩、缓存复用和 Token 性价比仍需优化。
3. 扫描 PDF、复杂表格、公式和 OCR 的解析/复用仍需优化。
4. 界面视觉细节和动效仍有提升空间。
5. Windows 已进入 CI 和发布，但触控板、输入法、WebView2、PDF 清晰度及 Agent CLI 仍需持续真机验收。

工程级下一步：

1. 查看清理提交后的 GitHub Actions 结果，区分源码推送成功与构建流水线成功。
2. 若用户要求线上 DMG，建议统一升版到 `v0.2.6`，由标签流水线发布，不移动 `v0.2.5` 标签。
3. 发布后用 `gh release view <tag> --json assets,url` 确认 macOS 附件是 `.dmg`，且 Windows 便携版和安装版仍存在。
4. 若 GitHub Actions 的 macOS DMG 脚本失败，先看 `hdiutil`/挂载错误；本机已证明 Tauri 配置本身可以生成有效 DMG。
5. 新功能修改后至少执行前端测试、Rust 测试、生产构建；涉及阅读器/弹窗时还要做真实 UI 冒烟测试。

## 11. 新窗口建议开场提示

可以把下面内容作为新窗口的第一条消息：

> 请先阅读 `/Users/hank/Desktop/知识整理器/docs/HANDOFF.md`，并遵循当前窗口提供的 `AGENTS.md` 指令。核对 `git status`、当前分支、远端 HEAD、GitHub Actions 和 Release 后继续工作；任何提交、推送或发布动作按我当前请求的范围执行。

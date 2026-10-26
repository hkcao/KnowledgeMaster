# KnowledgeMaster 开发交接

更新日期：2026-10-26（Asia/Shanghai）

本文档供后续 Codex/开发者在新窗口中继续工作。开始前请以实际 `git status`、远端分支、GitHub Actions 和 Release 为准；本文记录的是上述日期核验过的状态。

本项目使用个人 `project-handoff` Skill（`/Users/hank/.codex/skills/project-handoff`）持续维护本文档。发生重要决策、实现、验证、发布或工作区状态变化时更新同一文件，不创建按日期重复的交接文档。

## 0. 首轮 Windows PDF 刷新闪退修复（2026-10-26）

- **用户报告**：Windows 11、`0.2.6` portable，把任意 PDF 复制到资料库 `source/` 后点击刷新目录，应用退出。当前开发机为 macOS，仅安装 `aarch64-apple-darwin` Rust target；尚未在 Windows 真机复现或确认修复。
- **确认的代码缺陷**：`reload_library` / `import_files` 原为同步 Tauri command；`extract_path` 直接调用 `pdf-extract 0.10.0`，未隔离解析器 panic。不支持的字体编码可以触发 `pdf-extract/src/lib.rs:359` 的 `unexpected encoding` panic，并沿持有资料库 Mutex 的命令栈传播。新增测试在修复前确实失败，修复后通过。这是已复现的缺陷，不等于已证明用户“任意 PDF”闪退的唯一原因。
- **兼容性核对**：`git diff v0.2.5 v0.2.6` 确认 PDF 解析实现未变、Cargo 依赖及锁定版本未变（Cargo 清单/锁文件仅改应用版本）。当前资料库仍是 data version 8 / SQLite schema 1，本轮未更改数据格式；未发现该次升级造成 PDF 功能不兼容的证据。
- **实现**：`src-tauri/src/lib.rs` 将刷新和文件导入改为 async command + `spawn_blocking`，原刷新逻辑提取为 `reload_library_data`；`src-tauri/src/store.rs::extract_path` 使用独立解析线程（8 MiB 栈），通过 `join` 把解析 panic 转成含文件名的错误，供现有前端“刷新失败”提示显示。失败发生在移动原件/写入索引前，原件与资料库锁保持可用。8 MiB 是统一平台栈预算，尚无证据表明用户的闪退源自栈溢出；线程隔离也不能恢复进程级 OOM、栈溢出或原生访问异常。
- **回归覆盖**：临时资料库和程序生成的 PDF，不接触用户资料；覆盖中文目录/文件名、复制 PDF 后完整刷新、索引与 SQLite 持久化、再次刷新无重复、不支持的字体 panic、普通损坏 PDF 错误、失败后修复文件并再次刷新。原件在失败时保留，无半成品索引或 chunk。
- **验证**：`npm test` 14/14；`npm run build` 成功（既有 >500 kB bundle 提示）；`cargo test --manifest-path src-tauri/Cargo.toml --locked` 32/32；`cargo test --locked --release --manifest-path src-tauri/Cargo.toml --lib pdf_` 7/7；`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`git diff --check` 通过。另在修复前以 `RUST_MIN_STACK=1048576` 运行普通 PDF 用例通过，不能把 Windows 默认栈大小认定为根因。
- **CI**：最初增加生产模式 PDF 测试，后续扩大为全部 Rust 库测试（见 0.1 节）；本轮没有推送，因此尚无这份修复的 Windows CI 结果。
- **当前交付状态**：修复、测试、CI 和本文档仅为工作区未暂存修改；没有提交、推送、标签或新安装包。版本仍为 `0.2.6`，线上旧版不包含修复。下一步先在 Windows 跑这些测试并用 portable EXE 验证用户步骤；发布时使用新版本/新标签，不覆盖 `v0.2.6`。

### 0.1 旧资料库与索引迁移补充

- **用户要求**：继续排查已有索引是否与新版不兼容；需要支持旧数据迁移。保留首轮解析器崩溃修复。
- **历史源码证据**：`9f4587fc^` 的 Swift `KnowledgeStore.swift` 用大写 UUID 命名索引，未填写 `storedPath` 时使用 `source/documents/<UUID>/<name>`；早期 `tauri` 分支也支持缺省嵌套原件路径。历史提取索引均为 `{text, pages: [{number, text}]}`，与当前格式一致。Swift 文档来源字段是 `sourceURL`，当前 Rust 序列化字段是 `sourceUrl`。
- **已复现缺口**：刷新只扫描新文件，不修复已有文档的损坏/缺失索引；`{}` 等无关 JSON 会被默认字段解析为空索引；缺省原件路径在当前实现报“资料缺少存储路径”。三项新增索引用例在修复前均失败。索引不可读时，启动阶段作者迁移还可能用空内容覆盖已有作者。
- **实现边界**：不改变 SQLite schema、数据版本或提取索引结构，不全量重新解析兼容索引。`store::extraction_index_path` 兼容大小写 UUID；`stored_path` 恢复旧版缺省嵌套路径；`models::KnowledgeDocument.source_url` 接受 `sourceURL` 别名。刷新 `reload_library_data` 和切换资料库 `switch_root` 在作者/文件名迁移前调用 `migrate_document_indexes`，将恢复的原件路径写回元数据。
- **恢复规则**：兼容索引复用，并通过现有 chunk 版本/哈希检查重建旧分块缓存；提取索引缺失、损坏或缺少 `text/pages` 字段时才从原件重建。成功解析后保留旧索引为 `<UUID>.json.pre-rebuild.bak`（不覆盖已有备份），先更新分块缓存，再用同目录临时文件原子替换提取索引。文档 ID 不变；解析失败时返回带文件名的错误，原索引、分块、原件和数据库不变，不用空内容覆盖作者。
- **触发时机**：旧 `knowledge.json → knowledge.db` 仍在加载时自动迁移，并保留 `knowledge.json.migrated-v8.bak`；索引修复在用户刷新目录或切换资料库时执行。启动读取兼容旧索引，但不强制解析全部旧原件。
- **当前验证**：`cargo test --locked --manifest-path src-tauri/Cargo.toml` 36/36；`cargo test --locked --release --manifest-path src-tauri/Cargo.toml --lib` 36/36；`npm test` 14/14；`npm run build` 成功；fmt/diff 检查通过。新增覆盖数据版本 5/6/7、缺失 authors、`sourceURL`、完整关系/会话/批注往返、JSON 备份字节不变、重复加载幂等、旧索引直接复用、嵌套原件路径、三种坏/缺索引恢复、重建失败无破坏；现有 chunk 测试补充旧版本号失效重建。大小写路径断言按 canonicalize 比较，以适配 macOS/Windows 常见的大小写不敏感文件系统。
- **当前 CI**：生产构建后执行 `cargo test --locked --release --manifest-path src-tauri/Cargo.toml --lib`，覆盖所有迁移和 PDF 测试；本机成功不代表 Windows UI 验证成功。尚无用户现场资料库或 Windows 异常日志，仍不能认定旧索引是“任意 PDF 闪退”的唯一原因。

### 0.2 v0.2.7 构建发布（进行中）

- 用户已明确授权提交 GitHub、构建并发布新的 Windows 版本，下载后自行测试。
- 版本文件已同步到 `0.2.7`：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。不改动依赖版本、SQLite schema 或数据版本。
- `0.2.7` 提交前重新验证：前端 14/14、Rust Debug 36/36、Release 36/36、生产前端构建、fmt、diff 检查全部通过；六处应用版本字段均为 `0.2.7`。
- 提交前远端 `tauri-codex` 仍为 `566cdff1`，`v0.2.7` 不存在；现有最新正式 Release 为 `v0.2.6`。
- 计划提交并推送修复和版本，创建新 `v0.2.7` 标签触发既有跨平台工作流。Windows 作业生成 portable EXE 与 NSIS 安装包；工作流还会生成 macOS DMG。构建、CI 和公开 Release 尚待执行核验，不能据本地测试认定已发布。

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
- 当前分支：`tauri-codex`；2026-10-26 提交前 `git ls-remote` 确认本地 HEAD 与远端分支均为 `566cdff14c4e6644f9ad1fbcc234f8934c6dd071`（`docs: record v0.2.6 release status`）。本轮修复与 `0.2.7` 版本变更待提交；发布进度见 0.2 节。
- 当前线上发布提交：`c0a52f5f9f1b81c12c6f498bb61b7135c2cc4f86`（`release: prepare v0.2.6 Windows test build`）。
- 当前公开正式版本/标签：`v0.2.6`
- 2026-10-26 再次核验：`refs/tags/v0.2.6^{}` 仍指向 `c0a52f5f`，分支 tip 为后续 docs-only 提交 `566cdff1`，并非发布二进制的提交。
- 2026-09-11 实时核验：本地 `main`、本地 `origin/main` 和远端 `refs/heads/main` 都指向 `ab4ff5a0`。
- `v0.2.5` 是 annotated tag，解引用后的发布提交为 `78b4b95b6a5d9a40fa9327839510321411d715af`。

目录整理已经提交并推送：

- 删除已废弃的 Swift/macOS 旧实现：`Package.swift`、`Sources/`、`Resources/`、`scripts/`、`tests/KnowledgeMasterTests/`。
- 修改 `.github/workflows/tauri-ci.yml`，macOS 从 `.app` ZIP 改为直接构建并发布 `.dmg`。
- 更新 `README.md`、`README.en.md` 和 `docs/REPLICATION_PROMPT.md`，移除旧原生实现/迁移表述并统一为 DMG 安装说明。
- 清理提交共 60 个文件，273 行新增、7757 行删除，其中包含首次加入的本文档。
- 提交前 `git diff --cached --check` 通过；推送后仍需以 GitHub Actions 结果区分“源码已推送”和“安装包已发布”。

## 3. 已发布状态与待发布差异

当前公开 Release：<https://github.com/hkcao/KnowledgeMaster/releases/tag/v0.2.6>

2026-10-26 通过 `gh release view v0.2.6` 再次核验，`v0.2.6` 为非草稿、非预发布版本，实际附件名称、大小与摘要仍为：

- `KnowledgeMaster-portable.exe`：22,312,448 bytes，SHA-256 `5853a98cd0a3969f997602695f49ac68ac4599ccad3e4ee50b821c0bcf4a509f`
- `KnowledgeMaster_0.2.6_x64-setup.exe`：6,983,337 bytes，SHA-256 `41e43094016b8a47984518844ab57e3ee47bd099b82c7998170bfacf2a5d28da`
- `KnowledgeMaster_0.2.6_aarch64.dmg`：9,128,121 bytes，SHA-256 `464165dc29d0f28871405c87c32de05c8d7beda00785430c09647727bcdf8893`

标签工作流 run `34557718931` 全部成功：macOS 作业 2m38s，Windows 作业 4m25s，Release 发布作业 10s。重复的 `tauri-codex` 分支工作流 run `34557689621` 已主动取消，只保留会发布 Release 的标签流水线。CI 有一条非阻塞注记：部分 `actions/*@v4` 内置 Node 20 已弃用并被 Runner 强制用 Node 24 执行，后续应单独升级 Actions 版本。

旧 `v0.2.5` Release 仍保留当时的 macOS ZIP、Windows 便携版和安装版，没有移动或覆盖旧标签。

已推送的 CI 配置不再生成 macOS ZIP，改为：

```yaml
- macOS runner: npm run tauri build -- --bundles dmg
- upload path: src-tauri/target/release/bundle/dmg/*.dmg
```

发布前必须同步修改以下五处版本文件：

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

推送受监听分支和 `v*` 标签会各触发一次 CI；标签流水线才负责创建 Release。若两套相同构建同时运行，可保留标签流水线并取消重复的分支流水线。

## 4. 本地目录清理与依赖状态

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

2026-09-11 为本轮测试恢复了 `node_modules/` 和 `src-tauri/target/`，生产构建还生成了 `dist/` 和 `src-tauri/gen/`。它们都被 `.gitignore` 忽略，当前留在本地以便继续开发，未提交。若后续再次清理，新窗口首次测试前需要重新安装/构建：

```bash
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

## 5. 最近一次本地验证结果

2026-10-26 当前最终修复验证见第 0.1 节。以下为 2026-09-11 发布基线的历史验证：

- 2026-09-11 基线 `npm test`：1 个测试文件，12 项测试通过；测试优化后再次执行为 1 个测试文件、14 项测试通过。
- 2026-09-11 `cargo test --manifest-path src-tauri/Cargo.toml`：29 项 Rust 测试通过（原基线 28 项）。
- 2026-09-11 `npm run build`：通过；Vite 仍只提示主 bundle 大于 500kB，主 JS 为 1,179.00 kB（gzip 356.43 kB）。
- 2026-09-11 版本一致性检查通过：`package.json`、`package-lock.json` 根字段、lock 根包、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 都是 `0.2.6`。
- 新增的前端异常矩形测试先复现了 `width = Infinity` 会污染正常批注合并结果；`src/utils.ts` 现在同时过滤非有限的 `x`、`y`、`width` 和 `height`。
- 新增 Rust 回归测试验证 chunk 缓存三条路径：相同源哈希命中复用、源哈希变化后失效重建、损坏 JSON 后重建并修复磁盘缓存。
- 本轮本地工具版本为 Node `v25.6.0`、npm `11.8.0`、Cargo `1.97.1`、rustc `1.97.1`；CI 仍固定 Node 22，并使用 Rust stable。
- 2026-09-11 标签 CI 在 macOS 和 Windows 上都重新通过 `npm test` 与 Rust 测试，并分别成功构建 DMG 和 NSIS；公开 Release 附件已按上节再次读取核验。

以下打包证据来自 2026-09-05 已提交基线，本轮没有重新执行 Tauri DMG 打包：

- `npm run tauri build -- --bundles dmg` 成功生成 `知屿 KnowledgeMaster_0.2.5_aarch64.dmg`。
- `hdiutil verify` 确认该 DMG 校验有效。
- DMG 构建需要调用 macOS `hdiutil`；受限沙箱中脚本可能失败，允许系统级构建后可以成功。

构建产物随后按目录清理要求删除，当前本地不再保留该 DMG。

本轮先在受限网络中执行 `npm ci --cache /tmp/knowledgemaster-npm-cache`，因代理连接被沙箱拒绝而报 `connect EPERM 127.0.0.1:7892`；允许网络后同一命令成功。安装报告 3 个 moderate、1 个 high 依赖漏洞，尚未执行可能改变依赖版本的 `npm audit fix`。

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

建议按以下优先级优化，先建立可量化基线，再扩展功能：

1. **上下文和缓存（P0）**：先记录每次问答的候选 chunk 数、实际发送字符/估算 Token、缓存命中和摘要覆盖消息数；在现有 256 Token chunk、48 Token overlap、最多 8 个上下文片段和每批 30 条增量摘要基础上，再做去重、总 Token 预算和按需摘要。验收要求是固定语料上的引用命中不下降，同时输入 Token、重复文本比例和二次查询耗时可比较。
2. **解析/OCR（P1）**：以“页面无文本或文本密度过低”为条件触发 OCR，不对所有 PDF 默认 OCR；缓存键应至少包含源文件 SHA-256、提取器/OCR 版本和语言配置，并保留页码、表格/公式占位及原文位置。先建立扫描页、双栏、表格和公式小型 fixture，再决定 OCR 引擎，避免先绑定供应商。
3. **跨会话记忆（P2）**：遵守“不引入向量数据库”的当前约束，先把用户确认的结论、待办和来源写入本地 SQLite，并用关键词和时间/主题过滤召回；必须可查看、编辑、删除和关闭自动召回，回答中保留来源会话。不要直接把全部历史对话塞进上下文。
4. **界面与 Windows（持续项）**：视觉调整应在核心交互稳定后按组件做；自动化优先覆盖输入法组合键、弹窗层级、PDF 缩放/选区和 Agent 不可用回退，真实 Windows 验收覆盖触控板、中文输入法、WebView2、PDF 清晰度及 `.cmd` Agent CLI。CI 通过不能替代真机结果。
5. **发布（已完成）**：`0.2.6` 已先推送到 `tauri-codex`，再由 `v0.2.6` 标签流水线发布；DMG、Windows 便携版和安装版均已核验存在，`v0.2.5` 标签未移动。

新功能修改后至少执行前端测试、Rust 测试和生产构建；涉及阅读器、弹窗、输入法或平台差异时，还要补组件测试和真实 UI 冒烟测试。

## 11. 当前工作树和本轮变更

2026-10-26 开始时工作树干净；发布准备阶段有十一个未暂存修改，无暂存或未跟踪文件：

- `src-tauri/src/lib.rs`：后台刷新/导入及可测试刷新函数。
- `src-tauri/src/store.rs`：PDF 解析线程与错误转换，旧原件/索引兼容、刷新恢复、作者保护，六项 PDF 回归测试及 chunk 旧版本测试。
- `src-tauri/src/models.rs`：兼容旧 `sourceURL` 字段。
- `src-tauri/src/database.rs`：数据版本 5/6/7 的完整关系与备份迁移测试。
- `.github/workflows/tauri-ci.yml`：生产模式 Rust 库测试（含迁移/PDF）。
- `docs/HANDOFF.md`：本轮证据、未确认事项与后续步骤；本文档自身也未提交、未暂存。
- 五处版本文件（见 0.2 节）：应用版本同步到 `0.2.7`。

当前本地 `dist/`、`src-tauri/target/` 等仍被忽略；本轮重新构建了前端和 macOS Rust debug/release 测试程序，未生成 Windows EXE、NSIS 或新 DMG。

以下是 2026-09-11 发布变更的历史记录。代码、测试、README 和版本变更已提交为 `c0a52f5f`，推送到远端 `tauri-codex`，并由 `v0.2.6` 标签发布：

- `README.md` / `README.en.md`：增加 P0 上下文与缓存、P1 解析/OCR、P2 跨会话记忆和持续 Windows 验收的优化顺序，并明确路线图不等于已完成功能。
- `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`：版本同步到 `0.2.6`。
- `src/utils.test.ts`：测试数据改为固定 ID/时间；增加摘要计数、PDF 缩放和无效/跨页批注矩形边界。
- `src/utils.ts`：过滤非有限的批注矩形宽高，修复测试复现的问题。
- `src-tauri/src/store.rs`：增加 chunk 缓存命中、失效和损坏恢复回归测试。
- `docs/HANDOFF.md`：同步本轮实时状态、验证证据和 README 遗留项优化顺序。

当时发布后的交接更新已提交为 `566cdff1`；标签继续固定在已构建的 `c0a52f5f`。

当前下一步是 Windows 11 portable 验收第 0/0.1 节修复：在旧资料库副本中确认 JSON 自动迁移、批注/主题/书签保留；损坏索引刷新后产生备份并恢复检索；再把普通 PDF 复制到 `source/`，刷新后确认入库、可阅读、再次刷新无重复；不支持字体的测试文件应显示错误且窗口仍可操作。如仍闪退，收集 Windows 事件查看器中的异常代码、故障模块及 WebView2 版本，以区分 Rust panic、栈溢出和 WebView2 进程退出；目前尚未取得这些现场证据。

## 12. 新窗口建议开场提示

可以把下面内容作为新窗口的第一条消息：

> 请先阅读 `/Users/hank/Desktop/知识整理器/docs/HANDOFF.md`，并遵循当前窗口提供的 `AGENTS.md` 指令。核对 `git status`、当前分支、远端 HEAD、GitHub Actions 和 Release 后继续工作；任何提交、推送或发布动作按我当前请求的范围执行。

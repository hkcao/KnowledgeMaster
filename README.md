# 知屿 KnowledgeMaster

[简体中文](README.md) | [English](README.en.md)

> 面向科研论文学习的本地优先知识工作台，Tauri 版本同时面向 macOS 与 Windows。

知屿把“收集论文 → 精读与批注 → 研究笔记 → 跨文档问答 → 沉淀理解”放在一个桌面应用中。资料和元数据默认留在用户自己的磁盘；AI 只在用户发起请求时访问明确授权的范围。

## 主要能力

### 论文资料管理

- 文件选择、目录递归、拖放和网址导入。
- 支持 PDF、HTML、Markdown、TXT、DOC、DOCX。
- 文件名和 SHA-256 双重去重，原件平铺保存。
- 论文展示名优先采用“一作 et al., 论文标题”。
- 层级虚拟主题；同一文档可归属多个主题。
- 导入后在本机推荐主题，用户确认后才建立关联。
- 文件名、主题和正文关键词检索，不使用向量数据库。
- 资料库目录可配置；放进 iCloud Drive、OneDrive 等同步目录时依赖系统同步。

### 阅读、批注与笔记

- PDF.js 连续阅读、可选文字层、触控板/滚轮缩放、书签和目录导航。
- HTML、Markdown、文本只读预览；Markdown 支持 GFM 与 LaTeX。
- 多标签阅读，左右侧栏隐藏/恢复不改变当前文档。
- PDF 与文本内容支持鼠标划词；选择完成后在选区旁显示 Ask AI、引用、高亮、划线和笔记。
- AI 选区上下文同时携带原文；开启多模态时携带选区截图。
- 批注入口位于对应正文旁的空白区域，点击后可查看和编辑。
- 总结笔记以 Markdown 文件保存，可关联多条原文批注。
- 支持导出原文和带批注版本。

### AI 与本地 Agent

- 直接 API 支持 DeepSeek、智谱 GLM 和自定义 OpenAI 兼容接口。
- API 模式可选“相关片段”或带文件工具的“自主检索”。
- 支持本机 Claude Code 与 Codex CLI，保留可折叠执行过程并允许手动终止。
- 右侧可同时选择多份文档或主题作为问答范围；Agent 会为该范围建立隔离的临时虚拟工作区。
- Agent 读取只读原始资料副本，可复用已有 PDF/OCR/解析缓存，不依赖预切分文本。
- 不选择文本、文件或主题时默认纯聊天，不自动加载本地资料。
- Agent 下载资料先进入待确认区；用户确认文件后，再人工确认虚拟主题。
- 保存对话历史并增量生成 Markdown 摘要。

### 本地优先与安全

- 资料、主题、全文索引、批注、笔记和对话保存在用户选择的资料库。
- API Key 使用 macOS Keychain 或 Windows Credential Manager。
- 启动应用、打开设置和切换服务商不会读取 Key；发送请求或测试连接时才按需访问。
- Agent 只能写入隔离工作区；原始资料副本和解析缓存只读。
- 元数据使用带外键和索引的 SQLite；旧版 `knowledge.json` 首次启动时自动迁移并保留一份后续不再写入的备份。
- 前端不具有任意文件系统权限，文件操作统一由 Rust 命令校验。

## 平台与技术

| 项目 | macOS | Windows |
|---|---|---|
| 最低目标 | macOS 14+ | Windows 10/11 |
| WebView | 系统 WebKit | WebView2 |
| 凭据 | Keychain | Credential Manager |
| Agent 终止 | 终止进程 | `taskkill /T` 终止进程树 |
| 发布包 | `.dmg` | 便携版 `.exe` / NSIS 安装版 `.exe` |

共享技术栈：

- Tauri 2
- React 19 + TypeScript + Vite
- Rust
- PDF.js
- React Markdown + GFM + KaTeX

不使用 Electron，不依赖云端业务服务，不引入 embedding 或向量数据库。

## 安装与首次使用

### Windows

1. 在 [GitHub Releases](https://github.com/hkcao/KnowledgeMaster/releases) 下载 `KnowledgeMaster-portable.exe`。这是免安装版本，放在任意普通目录后双击即可运行。
2. 如果希望自动创建开始菜单入口，也可以下载文件名以 `-setup.exe` 结尾的 NSIS 安装版。不要下载 macOS 的 `.dmg`。
3. 便携版依赖系统 WebView2。较新的 Windows 10/11 通常已经自带；如果程序无法打开，请先安装 Microsoft Edge WebView2 Runtime。安装版会在缺失时联网补充安装。
4. 未签名版本可能触发 Windows SmartScreen；请先确认文件来自本仓库的 Release，再选择“更多信息 → 仍要运行”。
5. 第一次启动后，在“设置”中选择资料库目录。需要多设备同步时，可以选择 OneDrive 内的目录，但不要让两台设备同时修改同一个资料库。
6. 只有使用 AI 时才需要在设置中填写 DeepSeek、智谱 GLM 或自定义 OpenAI 兼容接口的 API Key。Key 按需读取，并保存在 Windows Credential Manager。

如果 Release 中暂时没有 Windows 安装程序，可以按下方“Windows 编译”从源码生成。

### macOS

从 [GitHub Releases](https://github.com/hkcao/KnowledgeMaster/releases) 下载 `.dmg`，打开后把知屿拖入“应用程序”并启动。未经过 Apple 公证的版本首次打开时，需要在“系统设置 → 隐私与安全性”中确认允许打开。

## 从源码编译

### Windows 编译

准备 Windows 10/11 x64 环境，并安装：

- [Node.js 22 LTS](https://nodejs.org/)。
- [Rust stable](https://www.rust-lang.org/tools/install)，使用默认的 `x86_64-pc-windows-msvc` 工具链。
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，安装时勾选“使用 C++ 的桌面开发”和 Windows 10/11 SDK。
- Microsoft Edge WebView2 Runtime。较新的 Windows 10/11 通常已经自带；缺失时可从 [Microsoft WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) 安装 Evergreen Runtime。

在 PowerShell 中执行：

```powershell
git clone https://github.com/hkcao/KnowledgeMaster.git
cd KnowledgeMaster
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

生成应用后，原始可执行文件位于 `src-tauri\target\release\knowledge-master.exe`。复制并改名即可得到免安装便携版：

```powershell
npm run tauri build -- --bundles nsis
Copy-Item src-tauri\target\release\knowledge-master.exe KnowledgeMaster-portable.exe
```

同一次构建也会生成 Windows NSIS 安装程序：

```powershell
Get-ChildItem src-tauri\target\release\bundle\nsis\*-setup.exe
```

Windows 包应在 Windows 上构建。仓库的 GitHub Actions 会在 Windows Runner 中同时验证便携版和安装版；推送 `v*` 标签时，两种 `.exe` 会自动附加到对应 GitHub Release。

### macOS 编译

需要 macOS 14+、Xcode Command Line Tools、Node.js 22 LTS 和 Rust stable：

```bash
git clone https://github.com/hkcao/KnowledgeMaster.git
cd KnowledgeMaster
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

生成 `.app` 和 `.dmg`：

```bash
npm run tauri build -- --bundles app,dmg
```

构建结果位于 `src-tauri/target/release/bundle/macos/` 与 `src-tauri/target/release/bundle/dmg/`。

macOS 与 Windows 的正式安装包应在各自系统上构建。仓库提供 `.github/workflows/tauri-ci.yml`，会在两种系统上分别运行前端测试、Rust 测试，并验证 macOS `.dmg`、Windows 便携版和 NSIS `.exe` 构建。

## 本地资料结构

```text
<资料库目录>/
├── knowledge.db                   # SQLite 元数据
├── knowledge.json.migrated-v8.bak # 仅旧版首次迁移时生成
└── source/
    ├── documents/                 # 导入原件
    ├── downloads/pending/         # Agent 下载待确认
    ├── generated/agent-cache/     # 可复用解析/OCR结果
    ├── index/                     # 本地提取文本
    └── notes/                     # 总结类 Markdown 笔记
```

macOS 与 Windows 使用相同的相对路径和 SQLite schema。资料库可随同步盘迁移，但不建议两台设备同时打开并修改同一个资料库。

## Agent 接入

先在本机终端安装并登录对应 CLI，再在知屿设置中测试连接：

- Claude Code：应用查找 `claude`；Windows 同时识别 npm 生成的 `claude.cmd`。
- Codex：应用查找 `codex`；macOS 也识别 ChatGPT 应用内置 Codex，Windows 同时识别 `codex.cmd`。

退出知屿会终止由本次应用启动且仍在运行的 Agent 进程，不会退出用户在其他终端中独立运行的 Agent。

选择文档或主题后，应用会按授权范围创建独立的系统临时目录。Agent 只看到其中的资料副本、解析缓存和可写的生成/下载目录，不会获得资料库原始路径；问答范围发生变化时会切换到新的工作区和会话。

## 当前遗留功能

1. 尚未实现可自动召回的跨会话长期记忆。
2. 模型上下文压缩、缓存复用和 Token 性价比仍需优化。
3. 扫描 PDF、复杂表格、公式和 OCR 的解析与复用策略仍需优化。
4. 界面视觉细节和动效仍可继续提升。
5. Windows 已纳入本实现和 CI 构建目标，但仍需要在真实 Windows 设备上持续做触控板、输入法、WebView2 和 Agent CLI 兼容性验收。

## 许可证

本项目采用 [MIT License](LICENSE)。

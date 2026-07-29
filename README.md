# 知屿 KnowledgeMaster

> 面向科研论文学习的本地优先知识工作台，Tauri 版本同时面向 macOS 与 Windows。

知屿把“收集论文 → 精读与批注 → 研究笔记 → 跨文档问答 → 沉淀理解”放在一个桌面应用中。资料和元数据默认留在用户自己的磁盘；AI 只在用户发起请求时访问明确授权的范围。

当前 `tauri-codex` 分支是根据原生 macOS 版本重新迁移的独立 Tauri 2 实现。迁移规格来自 `agent/native-macos-only` 的实际源码和 70 个原生回归测试，没有复用仓库中曾存在的旧 Tauri 方案。完整复刻规格见 [docs/REPLICATION_PROMPT.md](docs/REPLICATION_PROMPT.md)。

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
- 划词后紧邻选区显示 Ask AI、引用、高亮、下划线和笔记。
- AI 选区上下文同时携带原文；开启多模态时携带选区截图。
- 批注入口位于对应正文旁的空白区域，点击后可查看和编辑。
- 总结笔记以 Markdown 文件保存，可关联多条原文批注。
- 支持导出原文和带批注版本。

### AI 与本地 Agent

- 直接 API 支持 DeepSeek、智谱 GLM 和自定义 OpenAI 兼容接口。
- API 模式可选“相关片段”或带文件工具的“自主检索”。
- 支持本机 Claude Code 与 Codex CLI，保留可折叠执行过程并允许手动终止。
- Agent 读取只读原始资料副本，可复用已有 PDF/OCR/解析缓存，不依赖预切分文本。
- 不选择文本、文件或主题时默认纯聊天，不自动加载本地资料。
- Agent 下载资料先进入待确认区；用户确认文件后，再人工确认虚拟主题。
- 保存对话历史并增量生成 Markdown 摘要。

### 本地优先与安全

- 资料、主题、全文索引、批注、笔记和对话保存在用户选择的资料库。
- API Key 使用 macOS Keychain 或 Windows Credential Manager。
- 启动应用、打开设置和切换服务商不会读取 Key；发送请求或测试连接时才按需访问。
- Agent 只能写入隔离工作区；原始资料副本和解析缓存只读。
- `knowledge.json` 原子更新并保留上一版备份。
- 前端不具有任意文件系统权限，文件操作统一由 Rust 命令校验。

## 平台与技术

| 项目 | macOS | Windows |
|---|---|---|
| 最低目标 | macOS 14+ | Windows 10/11 |
| WebView | 系统 WebKit | WebView2 |
| 凭据 | Keychain | Credential Manager |
| Agent 终止 | 终止进程 | `taskkill /T` 终止进程树 |
| 安装包 | `.app` / `.dmg` | NSIS `.exe` |

共享技术栈：

- Tauri 2
- React 19 + TypeScript + Vite
- Rust
- PDF.js
- React Markdown + GFM + KaTeX

不使用 Electron，不依赖云端业务服务，不引入 embedding 或向量数据库。

## 开发与验证

需要 Node.js 22、Rust stable 和对应平台的 Tauri 系统依赖。

```bash
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

生成当前系统的可安装版本：

```bash
npm run tauri build
```

macOS 与 Windows 不能在本地互相交叉打包，因此仓库提供 `.github/workflows/tauri-ci.yml`，在两种系统上分别运行相同的前端测试、Rust 测试，并验证 macOS `.app` 与 Windows NSIS `.exe` 构建。本地 macOS 仍可直接生成 `.dmg`。

## 本地资料结构

```text
<资料库目录>/
├── knowledge.json
├── knowledge.json.bak
└── source/
    ├── documents/                 # 导入原件
    ├── downloads/pending/         # Agent 下载待确认
    ├── generated/agent-cache/     # 可复用解析/OCR结果
    ├── index/                     # 本地提取文本
    └── notes/                     # 总结类 Markdown 笔记
```

macOS 与 Windows 使用相同的相对路径和 JSON 格式。资料库可随同步盘迁移，但不建议两台设备同时修改同一个资料库。

## Agent 接入

先在本机终端安装并登录对应 CLI，再在知屿设置中测试连接：

- Claude Code：应用查找 `claude`；Windows 同时识别 npm 生成的 `claude.cmd`。
- Codex：应用查找 `codex`；macOS 也识别 ChatGPT 应用内置 Codex，Windows 同时识别 `codex.cmd`。

退出知屿会终止由本次应用启动且仍在运行的 Agent 进程，不会退出用户在其他终端中独立运行的 Agent。

## 当前遗留功能

1. 尚未实现可自动召回的跨会话长期记忆。
2. 模型上下文压缩、缓存复用和 Token 性价比仍需优化。
3. 扫描 PDF、复杂表格、公式和 OCR 的解析与复用策略仍需优化。
4. 界面视觉细节和动效仍可继续提升。
5. Windows 已纳入本实现和 CI 构建目标，但仍需要在真实 Windows 设备上持续做触控板、输入法、WebView2 和 Agent CLI 兼容性验收。

## 原生 macOS 参考实现

原生 SwiftUI/AppKit 代码仍保留在 `Sources/` 与 `Tests/`，用于核对既有行为；Tauri 应用入口为 `src/` 与 `src-tauri/`。两个应用使用不同 Bundle Identifier，可以在 macOS 上并存。

## 许可证

本项目采用 [MIT License](LICENSE)。

# KnowledgeMaster（知屿）

KnowledgeMaster 是使用 SwiftUI、AppKit 与 PDFKit 编写的原生 macOS 个人知识库应用，当前检索不依赖向量数据库。

## 当前能力

- 原生三栏 macOS 界面、菜单、设置窗口和多文档标签
- 通过按钮或从 Finder 拖拽导入 PDF、HTML、Markdown、TXT，也可递归导入目录
- 原始文件统一复制到知识库 `source/documents/`，界面仅呈现虚拟视图
- 同名文件默认丢弃，并使用 SHA-256 识别内容重复
- PDFKit 原稿阅读、原生选区和页码定位
- HTML 富文本、Markdown 排版预览和纯文本阅读
- 划词 Ask AI、引用、高亮、划线与笔记
- 批注集中查看、编辑和删除；批注不修改 source 原文件
- 一个文档可属于多个主题，支持拖拽到主题建立关联
- 本地关键词搜索和导入后的主题推荐
- 支持直接调用 DeepSeek、智谱 GLM、自定义 OpenAI 兼容接口，也可调用本机 Claude Code 或 Codex Agent
- 直接 API 使用应用管理的 ReAct 工具循环，具备受限的文件列表、读取、检索和生成文件能力
- AI 回复直接按 Markdown 排版显示；设置页可检测并测试本机 Agent CLI
- API Key 保存在 macOS 钥匙串
- 可同时选择多份文件和多个主题进行跨文档问答，并支持对话历史、单次对话摘要和批注上下文
- 设置中切换或迁移知识库目录；选择 iCloud Drive 路径即可由系统同步

## 开发运行

要求 macOS 14 或更高版本，并安装 Xcode。

```bash
swift run KnowledgeMaster
```

运行测试：

```bash
swift test
```

## 生成原生 `.app`

```bash
./scripts/build-app.sh
```

产物位于：

```text
release/KnowledgeMaster.app
```

脚本使用 ad-hoc 签名，适用于本机运行。面向其他用户分发时仍需配置 Apple Developer ID 签名与 notarization。

## 本地数据

默认知识库位于：

```text
~/Library/Application Support/KnowledgeMaster/library/
├── knowledge.json
├── knowledge.json.bak
└── source/
    ├── documents/
    ├── downloads/
    ├── generated/
    └── index/
```

模型配置存放在 UserDefaults，API Key 单独存放在 macOS 钥匙串。将知识库目录切换到 iCloud Drive 后，原始资料、索引、主题、批注和对话历史会随目录同步。

## AI 如何读取资料

直接 API 模式不会在首个请求中全量加载大型文档：

1. 根据手动选择的文件、主题和“自动包含当前文档”开关确定范围。
2. 从本地索引读取正文；PDF 保留页码。
3. 正文按约 1400 字、180 字重叠切块并进行本地关键词评分。
4. 每份选中文档先保留一个最佳片段，再按全局相关性补足，首轮最多发送 10 个片段和最近 12 条对话消息。
5. 模型可在最多 8 轮的 ReAct 循环中调用 `list_files`、`search_files` 和 `read_file`，继续核实所选范围内的完整提取文本；支持一次返回多个工具调用。
6. 模型不能访问任意本机路径：所选资料仅映射为内存中的只读 `documents/` 虚拟文件。工具参数由应用校验，绝对路径、`~`、`.` 和 `..` 均被拒绝。
7. 用户明确要求生成报告等文件时，模型可调用 `write_file`，但只能写入当前对话专属的 `source/generated/<会话ID>/`；生成文件会随知识库目录和 iCloud 同步，并在聊天消息中提供 Finder 入口。
8. “包含所选范围内的批注”开启时，相关高亮、划线和用户笔记也会进入上下文；系统提示会明确区分文档事实与用户笔记。

Claude Code / Codex Agent 模式会为每轮问答创建临时隔离目录，将选中文档的提取文本副本、批注和最近对话放入其中：

- Claude Code 使用非交互模式，只开放 Read、Grep、Glob，只读且不保存会话。
- Codex 使用 `read-only` 沙箱、`--ephemeral` 临时会话，并忽略用户配置和项目规则。
- Agent 最多接收 1000 万字符的文档副本，最长执行 3 分钟；结束、失败或取消后清理临时目录。
- Agent 登录、订阅和凭据由对应 CLI 自己管理，知屿不会复制或保存这些凭据。
- 退出知屿时，所有仍在运行的 Claude Code / Codex 子进程都会收到终止信号；正常完成的每轮调用本来也会立即退出，不保留 Agent 会话。

## Claude Code / Codex 接入步骤

CLI 与知屿位于同一台 Mac 时：

1. 安装所需 CLI。Claude Code 的标准安装命令为：

   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

   Codex 在 macOS 上可以使用 Homebrew 安装：

   ```bash
   brew install --cask codex
   ```

2. 在终端运行 `claude` 或 `codex`，按 CLI 提示完成账号登录，并先确认可以正常回答。Codex 可选择“Sign in with ChatGPT”。
3. 完全退出并重新打开知屿。
4. 打开“设置 → 聊天执行后端”，选择 Claude Code 或 Codex。
5. 点击对应的“测试”；成功后即可在聊天栏切换到该 Agent。

安装命令参考：[Claude Code 官方设置文档](https://docs.anthropic.com/en/docs/claude-code/getting-started)、[OpenAI Codex CLI 官方仓库](https://github.com/openai/codex)。

CLI 位于另一台机器时，当前版本不直接通过 SSH 调用。远程 Agent 不只是执行一条命令，还需要把本轮选中文档安全传到远端、隔离运行、取回答案、删除临时资料，并在取消或退出时终止远端进程。当前可选方案：

1. 如果远端也是 Mac，在远端安装并运行知屿与 Agent CLI，通过 iCloud Drive 同步知识库，再使用远程桌面操作。
2. 如果知屿必须运行在本机，切换到“直接 API”，配置 DeepSeek、GLM 或 OpenAI 兼容服务。

不要仅创建一个名为 `claude` 或 `codex` 的 SSH 包装脚本：知屿创建的临时文档路径只存在于本机，这样既无法正确读取资料，也无法保证远端清理和退出行为。

## 第一版边界

- 当前检索为本地线性关键词检索，适用于个人知识库的几千份资料。
- 扫描版 PDF 尚未集成 OCR。
- 暂未支持 Word、PowerPoint、网页链接下载和批注导出。
- 批注主要通过页码、PDF 选区矩形和选中文字锚定；纯文本中存在完全相同句子时优先匹配第一次出现的位置。

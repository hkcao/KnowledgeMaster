# KnowledgeMaster（知屿）

KnowledgeMaster 是使用 SwiftUI、AppKit 与 PDFKit 编写的原生 macOS 个人知识库应用，当前检索不依赖向量数据库。

## 当前能力

- 原生 macOS 界面、菜单、设置窗口和多文档标签；知识问答可停靠在右侧、底部、左侧或完全隐藏
- 通过按钮或从 Finder 拖拽导入 PDF、HTML、Markdown、TXT，也可递归导入目录
- 原始文件扁平复制到知识库 `source/documents/`（不为每份资料创建子目录），界面仅呈现虚拟视图；旧版目录结构继续兼容
- 导入论文 PDF 时优先读取 PDF 元数据，将虚拟名称显示为“一作 et al., 论文标题”；对旧文件名或错误元数据可点击“AI 整理论文名”，只发送第一页文本并仅修改虚拟名称
- 同名文件默认丢弃，并使用 SHA-256 识别内容重复
- PDFKit 原稿阅读、原生选区和页码定位
- HTML 富文本、Markdown 排版预览和纯文本阅读
- 划词 Ask AI、引用、高亮、划线与笔记
- PDF 划词会自动授权本轮读取对应原文，并生成临时选区截图；输入区只显示“基于已选中区域回答”状态条，不暴露内部提示词；文字模型继续使用文字，支持视觉输入的直接 API 和 Agent 可同时查看截图
- 文档右侧以批注气泡集中提示，点击即可定位并展开笔记；批注不修改 source 原文件
- 左侧可在“目录 / 笔记”间切换：笔记视图可跳转全部批注，也可创建、编辑和删除总结笔记，并把总结关联到多条批注
- 左侧使用“主题目录 → 文档”的目录树；一个文档可同时显示在多个主题目录，支持拖拽建立关联
- 本地关键词搜索和导入后的主题推荐
- 支持直接调用 DeepSeek、智谱 GLM、自定义 OpenAI 兼容接口，也可调用本机 Claude Code 或 Codex Agent
- 直接 API 可选“相关片段”或“自主检索”；自主检索使用应用管理的 ReAct 工具循环，具备受限的文件列表、读取、检索和生成文件能力
- Claude Code / Codex 的工具、文件和状态事件会实时显示在可折叠执行过程面板中；历史对话保留过程记录，但过滤内部推理事件
- Agent 调研下载的 PDF、HTML、Markdown、TXT 会先进入 `source/downloads/pending/` 隔离区；用户勾选确认后才导入，并在第二步人工确认一个或多个虚拟主题
- AI 回复使用应用内置的离线 Markdown 与 KaTeX 预览，保留标题、段落、列表、表格、代码块和换行，并渲染 `$...$`、`$$...$$` 等 LaTeX 公式
- Markdown 回复区域把触摸板纵向滚动交给外层对话列表，代码块和表格仍保留横向滚动
- API Key 保存在 macOS 钥匙串；每次启动只读取一次，切换服务商或模型不会重复请求钥匙串权限
- 可同时选择多份文件和多个主题进行跨文档问答，并支持对话历史、单次对话摘要和批注上下文；历史列表会显示每段对话涉及的文档；默认不包含当前文档，未选范围时就是不加载本地资料的纯聊天
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
    │   └── agent-cache/
    └── index/
```

模型配置存放在 UserDefaults，API Key 单独存放在 macOS 钥匙串。将知识库目录切换到 iCloud Drive 后，原始资料、索引、主题、批注和对话历史会随目录同步。

## AI 如何读取资料

直接 API 模式提供两种资料策略，都只在用户明确选择的文件、主题和“自动包含当前文档”范围内工作。该开关默认关闭；没有选择范围或划词引用时不会加载任何本地文档、索引或批注：

1. “相关片段”从本地索引读取正文，按约 1400 字、180 字重叠切块并进行关键词评分；每份选中文档先保留一个最佳片段，再按全局相关性补足，一次最多发送 10 个片段和最近 12 条对话。这一模式只进行一次模型请求，不开放文件工具。
2. “自主检索”不预先发送相关片段。应用把所选文档的完整提取文本映射成内存中的只读 `documents/` 虚拟文件，由模型在最多 8 轮 ReAct 循环中按需调用 `list_files`、`search_files` 和 `read_file`。
3. 自主检索不能访问任意本机路径；工具参数由应用校验，绝对路径、`~`、`.` 和 `..` 均被拒绝。
4. 用户明确要求生成报告等文件时，自主检索可调用 `write_file`，但只能写入当前对话专属的 `source/generated/<会话ID>/`；生成文件会随知识库目录和 iCloud 同步，并在聊天消息中提供 Finder 入口。
5. “包含所选范围内的批注”开启时，相关高亮、划线和用户笔记也会进入上下文；系统提示会明确区分文档事实与用户笔记。
6. 划词属于用户明确选择，因此即使“自动包含当前文档”关闭，本轮也会自动包含该文档。PDF 选区会同时生成内存中的临时 PNG；在设置中开启“模型支持图片输入”后，直接 API 使用 OpenAI 兼容的 `image_url` 数据格式发送文字和图片。PNG 不写入对话历史或知识库。

Claude Code / Codex Agent 模式不会使用应用预先提取或切块的文本。每轮问答会创建临时隔离目录，并把选中的原格式文件逐字节复制进去；Agent 得到的是 PDF、HTML、Markdown 或 TXT 临时副本，不是真实 `source/documents/` 路径：

- 临时 `documents/` 与已有的 `cache/` 副本设为只读；Agent 只允许把工作结果写到本轮 `work/`。即使 Agent 删除或损坏临时副本，也不会影响知识库原件。
- Codex 使用 `workspace-write` 沙箱，写权限限制在本轮 `work/`，并使用 `--ephemeral` 临时会话；关闭当前问答不需要的 Apps/远程插件目录加载，仍保留用户 Skill、实时网页搜索和本轮下载所需的出站网络。
- Claude Code 使用非交互模式、默认工具和用户级配置，以便按需调用用户已经安装的 PDF/OCR Skill；它看到的资料路径仍只有临时副本，不会收到知识库原件路径。
- Agent 可先查看已有解析缓存，再决定是否重新解析。可复用的 OCR、全文解析或结构化结果只有写到 `work/generated/<文档ID>/` 才会被应用同步到 `source/generated/agent-cache/<文档ID>/`，下次运行以只读缓存副本提供。
- 应用导入 PDF 时生成的基础提取结果也会作为 `cache/<文档ID>/_app/extracted.json` 告知 Agent；Agent 可先复用它，再按版式或 OCR 需要读取原始 PDF。
- PDF 划词截图会作为本轮只读的 `documents/_selection/selection.png` 提供给 Claude Code/Codex，并在提示中标明；Agent 可结合选中文字、截图、已有解析缓存和原始 PDF 判断是否需要进一步解析。
- 缓存同步只接受本轮所选文档 ID 下的普通文件，忽略符号链接和未知文档目录，单轮上限 200 个文件、500 MB；同步只新增或覆盖同名缓存，不清理原文件或旧缓存。
- Agent 要求下载知识资料时只能写入本轮 `work/downloads/`；应用只接收受支持的普通文件，最多 100 个、总计 500 MB，并复制到 `source/downloads/pending/`。聊天中会显示“审阅并导入”，确认文件后再确认推荐或已有主题；未确认文件不会出现在知识目录。
- Agent 不设置固定执行超时，长时间 PDF 解析或 OCR 可以继续运行；执行过程面板提供“停止”按钮，只终止当前这一轮。设置页的连接测试也可单独停止。
- Codex 的 JSONL 与 Claude Code 的 stream-json 输出会归一化为状态、工具、文件、缓存、完成和错误事件；内部 reasoning 事件不会进入界面或对话历史。
- Claude Code 保留默认 WebSearch/WebFetch 工具；Codex 每轮显式启用内置 live web search。涉及新闻、价格、政策或版本等时效问题时，Agent 会被要求联网核实、标明日期和 URL。Codex 的 shell 出站网络仅在本轮隔离工作区中开放，以便下载用户要求的资料；直接 API 模式当前没有网页搜索工具。
- 从 Finder 启动应用时，知屿会读取 macOS 系统 HTTP/HTTPS/SOCKS 代理并注入 Agent 子进程，避免 CLI 只在终端中可联网；用户显式设置的代理环境优先。
- Agent 正常结束、失败或由用户停止后都会清理整份临时目录。
- Agent 登录、订阅和凭据由对应 CLI 自己管理，知屿不会复制或保存这些凭据。
- 退出知屿时，所有仍在运行的 Claude Code / Codex 子进程都会收到终止信号；正常完成的每轮调用本来也会立即退出，不保留 Agent 会话。
- 每条 Agent 消息都会启动一个新的隔离 CLI 进程，不会拉起手机或 GUI 应用。首次模型连接、用户级 Skill/配置加载以及 PDF/OCR 工具执行都可能耗时；这种无会话复用的设计换取了临时资料授权边界清晰，执行过程会持续显示，且没有三分钟固定超时。

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
- 应用自身尚未内置 OCR；Agent 模式可调用用户环境中已有的 PDF/OCR Skill，并缓存其生成的解析文件。
- 暂未支持 Word、PowerPoint、在主界面直接粘贴网页链接导入和批注导出；Agent 模式可调研并下载受支持的资料后走人工确认导入流程。
- 批注主要通过页码、PDF 选区矩形和选中文字锚定；纯文本中存在完全相同句子时优先匹配第一次出现的位置。

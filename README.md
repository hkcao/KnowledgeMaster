# KnowledgeMaster（知屿）

这是一个不使用向量数据库的第一版桌面原型。原始资料统一复制到应用数据目录的 `source/`，界面只呈现虚拟主题和文档关联。

## 当前能力

- 导入 PDF、HTML、Markdown、TXT，或递归导入目录
- 文件名相同默认丢弃，同时按 SHA-256 识别同内容副本
- PDF 原稿预览与可划词文本阅读
- HTML/Markdown/文本阅读、划词 Ask AI 和引用
- 一个文档关联多个虚拟主题，拖到主题即可添加关联
- 支持从 Finder 直接拖入文件或目录
- 支持主题改名/删除、解除文档关联和删除原始资料
- 文件名、主题、正文关键词检索，无向量依赖
- 可选择当前文件或主题作为 AI 问答范围
- DeepSeek、智谱 GLM 和自定义 OpenAI 兼容接口
- API Key 使用 Electron `safeStorage` 加密后保存在本机
- 永久保留对话历史，支持单次对话摘要和主题累计摘要
- macOS 原生菜单与快捷键、Finder 数据目录入口
- 元数据原子写入并保留上一版本备份
- 可在设置中切换或迁移整个知识库目录；选择 iCloud Drive 路径即可使用系统同步
- 阅读区支持多标签打开文档
- 对话可选择是否自动包含当前激活的文档页面

## 启动

```bash
npm install --cache /private/tmp/knowledge-organizer-npm-cache
npm start
```

首次使用时点击左上角设置按钮，选择服务商并填写 API Key。DeepSeek 默认使用 `deepseek-v4-flash`，智谱默认使用 `glm-5.2`；Base URL 和模型名均可编辑。

## 本地数据

应用数据存放在 Electron 的用户数据目录中，其下包含：

```text
library/
├── knowledge.json
└── source/
    ├── documents/
    ├── downloads/
    ├── generated/
    └── index/
```

模型地址和加密后的 API Key 存放在本机应用设置目录，不会写入可同步的知识库目录。将知识库切换到 iCloud Drive 后，macOS 会同步 `source/`、主题、索引和对话历史；请避免在两台 Mac 上同时编辑同一个知识库。

删除项目代码不会删除知识库数据。开发阶段若要清空数据，请从界面规划的数据管理功能处理；当前版本不要直接修改 `knowledge.json`。

## macOS 打包

生成 Apple Silicon 本地应用目录：

```bash
npm run pack:mac
```

生成未签名的 DMG 和 ZIP：

```bash
npm run build:mac
```

面向其他用户分发前，仍需配置 Apple Developer ID 签名与 notarization。构建产物默认写入 `dist/`，不会提交到 Git。

## 第一版边界

- PDF 在原稿预览中无法把插件内的划词事件传给应用；切换到“文本阅读”后可以划词。
- 关键词检索是本地线性检索，适用于个人知识库的几千份资料；后续可替换为 SQLite FTS，而不改变主题和文档关系。
- 扫描版 PDF 尚未集成本地 OCR。
- 暂未实现网页链接下载、Word/PPT、批注和导出。

## 测试

```bash
npm test
```

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: KnowledgeStore
    @EnvironmentObject private var settings: AppSettings
    @State private var apiKey = ""
    @State private var status = ""
    @State private var agentStatus = ""
    @State private var agentTestRunID: UUID?
    @State private var agentTestBackend: ChatBackend?

    var body: some View {
        Form {
            Section("聊天执行后端") {
                Picker("默认回答方式", selection: $settings.chatBackend) {
                    ForEach(ChatBackend.allCases) { backend in
                        Label(backend.name, systemImage: backend.icon).tag(backend)
                    }
                }
                ForEach([ChatBackend.claudeCode, .codex]) { backend in
                    HStack(alignment: .top) {
                        Text(backend.name).frame(width: 90, alignment: .leading)
                        Text(AgentRunner.availabilityText(for: backend))
                            .font(.caption)
                            .foregroundStyle(AgentRunner.executableURL(for: backend) == nil ? Color.red : Color.secondary)
                            .textSelection(.enabled)
                        Spacer()
                        if agentTestBackend == backend, let runID = agentTestRunID {
                            Button("停止", role: .destructive) {
                                AgentProcessRegistry.shared.terminate(runID: runID)
                                agentStatus = "正在停止 \(backend.name)…"
                            }
                        } else {
                            Button("测试") { Task { await testAgent(backend) } }
                                .disabled(AgentRunner.executableURL(for: backend) == nil || agentTestRunID != nil)
                        }
                    }
                }
                if !agentStatus.isEmpty { Text(agentStatus).font(.caption).foregroundStyle(.secondary) }
                Text("Agent 模式只会收到本轮选中原格式文件的独立临时副本；执行过程可实时展开并手动停止。Agent 下载的资料先隔离暂存，需人工确认导入与虚拟主题。登录和订阅由对应 CLI 管理。")
                    .font(.caption).foregroundStyle(.secondary)
                DisclosureGroup("Claude Code / Codex 接入步骤") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("同一台 Mac")
                            .font(.caption.bold())
                        Text("Claude Code：npm install -g @anthropic-ai/claude-code\nCodex：brew install --cask codex")
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                        Text("1. 安装后在终端运行 claude 或 codex。\n2. 按 CLI 提示完成账号登录，并先确认可正常回答。\n3. 完全退出并重新打开知屿。\n4. 在这里选择对应后端，点击“测试”。")
                            .font(.caption)
                        Text("CLI 在另一台机器")
                            .font(.caption.bold())
                        Text("当前版本不直接通过 SSH 调用远程 CLI，因为每轮还需要安全传输选中文档、回收临时文件并终止远程进程。可选择：① 在装有 CLI 的远程 Mac 上运行知屿，并通过 iCloud 同步知识库；② 本机改用“直接 API”。不要只把 ssh 命令伪装成 claude/codex，可见的本地临时路径在远程并不存在。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 4)
                }
            }
            Section("模型连接") {
                Picker("服务商", selection: Binding(get: { settings.provider }, set: { settings.applyDefaults(for: $0) })) {
                    Text("DeepSeek").tag("deepseek")
                    Text("智谱 GLM").tag("glm")
                    Text("其他 OpenAI 兼容服务").tag("custom")
                }
                TextField("API Base URL", text: $settings.baseURL)
                TextField("模型名称", text: $settings.model)
                Toggle("模型支持图片输入（发送 PDF 划词截图）", isOn: $settings.visionEnabled)
                Text("仅影响直接 API。Claude Code/Codex 会直接获得只读选区截图；若当前 API 模型不支持视觉输入，请关闭此项。")
                    .font(.caption).foregroundStyle(.secondary)
                SecureField("API Key（输入后可保存或替换）", text: $apiKey)
                HStack {
                    Button("保存 API Key") { saveKey() }.disabled(apiKey.isEmpty)
                    Button("清除", role: .destructive) { clearKey() }
                    Button("测试连接") { Task { await testConnection() } }
                }
                Text("只有在发起直接 API 请求、测试连接或保存/清除时才访问 macOS 钥匙串。")
                    .font(.caption).foregroundStyle(.secondary)
                if !status.isEmpty { Text(status).font(.caption).foregroundStyle(.secondary) }
            }
            Section("知识库与 source 目录") {
                Text(store.rootURL.path).font(.caption).textSelection(.enabled)
                HStack {
                    Button("更改目录") { chooseRoot() }
                    Button("在 Finder 中打开") { NSWorkspace.shared.activateFileViewerSelecting([store.rootURL]) }
                }
                Text(store.rootURL.path.contains("CloudDocs") ? "当前目录由 iCloud Drive 同步" : "当前为本地目录")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped).padding().frame(width: 660, height: 650)
    }

    private func saveKey() {
        do { try settings.setAPIKey(apiKey); apiKey = ""; status = "API Key 已保存到 macOS 钥匙串" }
        catch { status = error.localizedDescription }
    }
    private func clearKey() {
        do { try settings.setAPIKey(""); status = "API Key 已清除" }
        catch { status = error.localizedDescription }
    }
    private func testConnection() async {
        do {
            let answer = try await AIClient.completion(settings: settings, messages: [.init(role: "user", content: "只回复：连接成功")])
            status = answer
        } catch { status = error.localizedDescription }
    }
    private func testAgent(_ backend: ChatBackend) async {
        let runID = UUID()
        agentTestRunID = runID
        agentTestBackend = backend
        agentStatus = "正在测试 \(backend.name)…"
        do {
            let answer = try await AgentRunner.answer(backend: backend, request: AgentRunRequest(
                question: "只回复：Agent 连接成功",
                quote: nil, history: [], documents: [], annotations: []
            ), runID: runID) { event in
                agentStatus = "\(backend.name)：\(event.title)"
            }.answer
            agentStatus = "\(backend.name)：\(answer)"
        } catch {
            if case AgentRunnerError.cancelled = error { agentStatus = "已停止 \(backend.name) 测试" }
            else { agentStatus = error.localizedDescription }
        }
        agentTestRunID = nil
        agentTestBackend = nil
    }
    private func chooseRoot() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            let migrate = store.data.documents.isEmpty || NSAlert.confirmMigration()
            do { try store.switchRoot(to: url, migrate: migrate); status = "知识库目录已切换" }
            catch { status = error.localizedDescription }
        }
    }
}

private extension NSAlert {
    static func confirmMigration() -> Bool {
        let alert = NSAlert()
        alert.messageText = "迁移现有知识库？"
        alert.informativeText = "选择“迁移”会复制 source、主题、批注和对话；选择“不迁移”将打开或创建目标知识库。"
        alert.addButton(withTitle: "迁移")
        alert.addButton(withTitle: "不迁移")
        return alert.runModal() == .alertFirstButtonReturn
    }
}

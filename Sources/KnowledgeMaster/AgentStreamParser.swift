import Foundation

struct AgentStreamUpdate: Hashable {
    var events: [AgentTraceEvent] = []
    var finalAnswer: String?
}

struct AgentStreamParser {
    let backend: ChatBackend
    let workspacePath: String
    private var buffer = Data()
    private(set) var finalAnswer: String?

    init(backend: ChatBackend, workspacePath: String) {
        self.backend = backend
        self.workspacePath = workspacePath
    }

    mutating func consume(_ data: Data) -> [AgentTraceEvent] {
        buffer.append(data)
        var events: [AgentTraceEvent] = []
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = String(decoding: buffer[..<newline], as: UTF8.self)
            buffer.removeSubrange(...newline)
            let update = Self.parse(line: line, backend: backend, workspacePath: workspacePath)
            events.append(contentsOf: update.events)
            if let answer = update.finalAnswer { finalAnswer = answer }
        }
        return events
    }

    mutating func finish() -> [AgentTraceEvent] {
        guard !buffer.isEmpty else { return [] }
        let line = String(decoding: buffer, as: UTF8.self)
        buffer.removeAll(keepingCapacity: false)
        let update = Self.parse(line: line, backend: backend, workspacePath: workspacePath)
        if let answer = update.finalAnswer { finalAnswer = answer }
        return update.events
    }

    static func parse(line: String, backend: ChatBackend, workspacePath: String = "") -> AgentStreamUpdate {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return AgentStreamUpdate() }
        return backend == .codex
            ? parseCodex(json, workspacePath: workspacePath)
            : parseClaude(json, workspacePath: workspacePath)
    }

    private static func parseCodex(_ json: [String: Any], workspacePath: String) -> AgentStreamUpdate {
        let type = json["type"] as? String ?? ""
        switch type {
        case "thread.started":
            return event(.status, "Codex 会话已建立")
        case "turn.started":
            return event(.status, "开始分析问题")
        case "turn.completed":
            let usage = json["usage"] as? [String: Any]
            let detail = usage.flatMap { usageText($0) }
            return event(.completed, "Codex 执行完成", detail)
        case "turn.failed":
            return event(.error, "Codex 执行失败", nestedMessage(json))
        case "error":
            let message = nestedMessage(json)
            if message?.localizedCaseInsensitiveContains("reconnecting") == true {
                return event(.warning, "网络超时，Codex 正在重连", message)
            }
            return event(.error, "Codex 返回错误", message)
        case "item.started", "item.updated", "item.completed":
            guard let item = json["item"] as? [String: Any] else { return AgentStreamUpdate() }
            return parseCodexItem(item, phase: type, workspacePath: workspacePath)
        default:
            return AgentStreamUpdate()
        }
    }

    private static func parseCodexItem(_ item: [String: Any], phase: String, workspacePath: String) -> AgentStreamUpdate {
        let itemType = item["type"] as? String ?? ""
        let completed = phase == "item.completed"
        let failed = item["status"] as? String == "failed"
        switch itemType {
        case "reasoning":
            return AgentStreamUpdate() // 不展示内部推理或推理摘要。
        case "agent_message":
            guard completed, let text = nonempty(item["text"] as? String) else { return AgentStreamUpdate() }
            return event(.status, "Agent 更新", limited(redact(text, workspacePath: workspacePath), 600))
        case "command_execution":
            let command = limited(redact(item["command"] as? String ?? "", workspacePath: workspacePath), 500)
            if failed { return event(.error, "命令执行失败", command) }
            return event(.tool, completed ? "命令执行完成" : "正在执行命令", command)
        case "file_change":
            let path = item["path"] as? String ?? item["file_path"] as? String ?? ""
            return event(.file, completed ? "文件处理完成" : "正在处理文件",
                         limited(redact(path, workspacePath: workspacePath), 500))
        case "mcp_tool_call":
            let server = item["server"] as? String ?? "MCP"
            let tool = item["tool"] as? String ?? "工具"
            if failed { return event(.error, "工具调用失败", "\(server) · \(tool)") }
            return event(.tool, completed ? "工具调用完成" : "正在调用工具", "\(server) · \(tool)")
        case "web_search":
            return event(.tool, completed ? "网页检索完成" : "正在检索网页",
                         limited(item["query"] as? String ?? "", 400))
        case "todo_list":
            return event(.status, "任务计划已更新")
        case "error":
            return event(.error, "Codex 返回错误", nestedMessage(item))
        default:
            return AgentStreamUpdate()
        }
    }

    private static func parseClaude(_ json: [String: Any], workspacePath: String) -> AgentStreamUpdate {
        let type = json["type"] as? String ?? ""
        switch type {
        case "system":
            let subtype = json["subtype"] as? String ?? ""
            if subtype == "init" { return event(.status, "Claude Code 会话已建立") }
            if subtype.contains("hook") {
                let hook = json["hook_name"] as? String ?? json["name"] as? String
                return event(.tool, "正在运行 Hook", hook)
            }
            return AgentStreamUpdate()
        case "assistant":
            guard let message = json["message"] as? [String: Any],
                  let content = message["content"] as? [[String: Any]] else { return AgentStreamUpdate() }
            var events: [AgentTraceEvent] = []
            for block in content {
                switch block["type"] as? String {
                case "tool_use":
                    if let value = claudeToolEvent(block, workspacePath: workspacePath) { events.append(value) }
                case "text":
                    if let text = nonempty(block["text"] as? String) {
                        events.append(AgentTraceEvent(kind: .status, title: "Agent 更新",
                                                      detail: limited(redact(text, workspacePath: workspacePath), 600)))
                    }
                default: break
                }
            }
            return AgentStreamUpdate(events: events)
        case "result":
            let answer = nonempty(json["result"] as? String)
            if json["is_error"] as? Bool == true {
                return AgentStreamUpdate(events: [AgentTraceEvent(kind: .error, title: "Claude Code 执行失败",
                                                                  detail: limited(answer ?? nestedMessage(json) ?? "", 600))],
                                         finalAnswer: answer)
            }
            let turns = (json["num_turns"] as? NSNumber)?.intValue
            let duration = (json["duration_ms"] as? NSNumber).map { String(format: "%.1f 秒", $0.doubleValue / 1_000) }
            let detail = [turns.map { "\($0) 轮" }, duration].compactMap { $0 }.joined(separator: " · ")
            return AgentStreamUpdate(events: [AgentTraceEvent(kind: .completed, title: "Claude Code 执行完成",
                                                              detail: detail.isEmpty ? nil : detail)],
                                     finalAnswer: answer)
        case "rate_limit_event":
            return event(.warning, "Claude Code 请求受限", nestedMessage(json))
        default:
            return AgentStreamUpdate()
        }
    }

    private static func claudeToolEvent(_ block: [String: Any], workspacePath: String) -> AgentTraceEvent? {
        let name = block["name"] as? String ?? "工具"
        let input = block["input"] as? [String: Any] ?? [:]
        let rawDetail = ["file_path", "path", "command", "query", "pattern", "skill"]
            .compactMap { input[$0] as? String }.first
        let detail = rawDetail.map { limited(redact($0, workspacePath: workspacePath), 500) }
        switch name.lowercased() {
        case "read": return AgentTraceEvent(kind: .file, title: "正在读取文件", detail: detail)
        case "grep", "glob": return AgentTraceEvent(kind: .tool, title: "正在检索资料", detail: detail)
        case "websearch", "webfetch": return AgentTraceEvent(kind: .tool, title: "正在联网查询", detail: detail)
        case "bash": return AgentTraceEvent(kind: .tool, title: "正在执行命令", detail: detail)
        case "write", "edit": return AgentTraceEvent(kind: .file, title: "正在写入工作区", detail: detail)
        case "skill": return AgentTraceEvent(kind: .tool, title: "正在调用 Skill", detail: detail)
        default: return AgentTraceEvent(kind: .tool, title: "正在调用 \(name)", detail: detail)
        }
    }

    private static func event(_ kind: AgentTraceKind, _ title: String, _ detail: String? = nil) -> AgentStreamUpdate {
        AgentStreamUpdate(events: [AgentTraceEvent(kind: kind, title: title, detail: nonempty(detail))])
    }

    private static func usageText(_ usage: [String: Any]) -> String? {
        let input = (usage["input_tokens"] as? NSNumber)?.intValue
        let cached = (usage["cached_input_tokens"] as? NSNumber)?.intValue
        let output = (usage["output_tokens"] as? NSNumber)?.intValue
        let parts = [input.map { "输入 \($0)" }, cached.map { "缓存 \($0)" }, output.map { "输出 \($0)" }].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private static func nestedMessage(_ json: [String: Any]) -> String? {
        if let value = nonempty(json["message"] as? String) { return limited(value, 600) }
        if let error = json["error"] as? [String: Any], let value = nonempty(error["message"] as? String) {
            return limited(value, 600)
        }
        return nil
    }

    private static func redact(_ value: String, workspacePath: String) -> String {
        var result = value
        if !workspacePath.isEmpty { result = result.replacingOccurrences(of: workspacePath, with: "<本轮工作区>") }
        let home = NSHomeDirectory()
        if !home.isEmpty { result = result.replacingOccurrences(of: home, with: "~") }
        return result
    }

    private static func limited(_ value: String, _ count: Int) -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.count <= count ? normalized : String(normalized.prefix(count)) + "…"
    }

    private static func nonempty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

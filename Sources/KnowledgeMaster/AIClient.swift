import Foundation

enum AIClient {
    struct Request: Encodable {
        var model: String
        var messages: [Message]
        var temperature: Double = 0.2
    }

    struct VisionRequest: Encodable {
        var model: String
        var messages: [VisionMessage]
        var temperature: Double = 0.2
    }

    struct VisionMessage: Encodable {
        struct Part: Encodable {
            struct ImageURL: Encodable { var url: String }
            var type: String
            var text: String?
            var imageURL: ImageURL?

            enum CodingKeys: String, CodingKey {
                case type, text
                case imageURL = "image_url"
            }
        }

        var role: String
        var content: Content

        enum Content: Encodable {
            case text(String)
            case image(text: String, data: Data)

            func encode(to encoder: Encoder) throws {
                var container = encoder.singleValueContainer()
                switch self {
                case .text(let value):
                    try container.encode(value)
                case .image(let text, let data):
                    try container.encode([
                        Part(type: "text", text: text, imageURL: nil),
                        Part(type: "image_url", text: nil,
                             imageURL: .init(url: "data:image/png;base64,\(data.base64EncodedString())"))
                    ])
                }
            }
        }
    }

    struct Message: Codable, Hashable {
        var role: String
        var content: String
    }

    struct Response: Decodable {
        struct Choice: Decodable {
            var message: Message
        }
        var choices: [Choice]
    }

    struct ToolCall: Codable, Hashable {
        struct Function: Codable, Hashable {
            var name: String
            var arguments: String
        }

        var id: String
        var type: String
        var function: Function
    }

    struct ReActMessage: Codable, Hashable {
        var role: String
        var content: String?
        var reasoningContent: String?
        var toolCalls: [ToolCall]?
        var toolCallID: String?

        enum CodingKeys: String, CodingKey {
            case role, content
            case reasoningContent = "reasoning_content"
            case toolCalls = "tool_calls"
            case toolCallID = "tool_call_id"
        }

        init(role: String, content: String? = nil, reasoningContent: String? = nil,
             toolCalls: [ToolCall]? = nil, toolCallID: String? = nil) {
            self.role = role
            self.content = content
            self.reasoningContent = reasoningContent
            self.toolCalls = toolCalls
            self.toolCallID = toolCallID
        }
    }

    struct ToolDefinition: Encodable, Hashable {
        struct Function: Encodable, Hashable {
            var name: String
            var description: String
            var parameters: Parameters
        }

        struct Parameters: Encodable, Hashable {
            var type = "object"
            var properties: [String: Property]
            var required: [String]?
            var additionalProperties = false

            enum CodingKeys: String, CodingKey {
                case type, properties, required
                case additionalProperties = "additionalProperties"
            }
        }

        struct Property: Encodable, Hashable {
            var type: String
            var description: String
            var minimum: Int?
            var maximum: Int?
        }

        var type = "function"
        var function: Function
    }

    struct ReActRequest: Encodable {
        var model: String
        var messages: [ReActMessage]
        var tools: [ToolDefinition]
        var toolChoice = "auto"
        var temperature: Double = 0.2

        enum CodingKeys: String, CodingKey {
            case model, messages, tools, temperature
            case toolChoice = "tool_choice"
        }
    }

    struct ReActVisionRequest: Encodable {
        var model: String
        var messages: [ReActVisionMessage]
        var tools: [ToolDefinition]
        var toolChoice = "auto"
        var temperature: Double = 0.2

        enum CodingKeys: String, CodingKey {
            case model, messages, tools, temperature
            case toolChoice = "tool_choice"
        }
    }

    struct ReActVisionMessage: Encodable {
        var role: String
        var content: VisionMessage.Content?
        var reasoningContent: String?
        var toolCalls: [ToolCall]?
        var toolCallID: String?

        enum CodingKeys: String, CodingKey {
            case role, content
            case reasoningContent = "reasoning_content"
            case toolCalls = "tool_calls"
            case toolCallID = "tool_call_id"
        }
    }

    struct ReActResponse: Decodable {
        struct Choice: Decodable { var message: ReActMessage }
        var choices: [Choice]
    }

    struct ReActResult: Hashable {
        var answer: String
        var generatedFiles: [String]
    }

    static let toolDefinitions: [ToolDefinition] = [
        ToolDefinition(function: .init(
            name: "list_files",
            description: "列出已授权的知识库文件。documents/ 是只读资料，generated/ 是生成文件目录。",
            parameters: .init(properties: [
                "path": .init(type: "string", description: "可选的相对目录，如 documents、generated 或 .", minimum: nil, maximum: nil)
            ], required: nil)
        )),
        ToolDefinition(function: .init(
            name: "read_file",
            description: "按字符区间读取一个已授权文件。长文档应分段读取。",
            parameters: .init(properties: [
                "path": .init(type: "string", description: "list_files 返回的相对文件路径", minimum: nil, maximum: nil),
                "offset": .init(type: "integer", description: "从第几个字符开始，默认 0", minimum: 0, maximum: nil),
                "limit": .init(type: "integer", description: "最多读取的字符数，最大 50000", minimum: 1, maximum: 50_000)
            ], required: ["path"])
        )),
        ToolDefinition(function: .init(
            name: "search_files",
            description: "在已授权文件中做不区分大小写的文本搜索，返回文件、行号和片段。",
            parameters: .init(properties: [
                "query": .init(type: "string", description: "要查找的关键词或短语", minimum: nil, maximum: nil),
                "path": .init(type: "string", description: "可选的相对文件或目录，默认搜索全部", minimum: nil, maximum: nil)
            ], required: ["query"])
        )),
        ToolDefinition(function: .init(
            name: "write_file",
            description: "仅在用户要求生成文件时，将 UTF-8 文本写入 generated/。不能覆盖知识库原文或访问其他目录。",
            parameters: .init(properties: [
                "path": .init(type: "string", description: "必须以 generated/ 开头的相对路径", minimum: nil, maximum: nil),
                "content": .init(type: "string", description: "要写入的完整文本内容", minimum: nil, maximum: nil)
            ], required: ["path", "content"])
        ))
    ]

    static func completion(settings: AppSettings, messages: [Message], imagePNG: Data? = nil) async throws -> String {
        let data: Data
        if let imagePNG {
            data = try await perform(settings: settings, body: VisionRequest(
                model: await settings.model,
                messages: visionMessages(from: messages, imagePNG: imagePNG)
            ))
        } else {
            data = try await perform(settings: settings, body: Request(model: await settings.model, messages: messages))
        }
        guard let answer = try JSONDecoder().decode(Response.self, from: data).choices.first?.message.content else {
            throw AIError.emptyResponse
        }
        return answer
    }

    static func reactCompletion(settings: AppSettings, messages: [Message], workspace: KnowledgeFileTools,
                                imagePNG: Data? = nil, maxSteps: Int = 8) async throws -> ReActResult {
        var transcript = messages.map { ReActMessage(role: $0.role, content: $0.content) }
        let model = await settings.model
        for step in 0..<max(1, maxSteps) {
            let data: Data
            if step == 0, let imagePNG {
                data = try await perform(settings: settings, body: ReActVisionRequest(
                    model: model,
                    messages: reactVisionMessages(from: transcript, imagePNG: imagePNG),
                    tools: toolDefinitions
                ))
            } else {
                data = try await perform(settings: settings,
                                         body: ReActRequest(model: model, messages: transcript, tools: toolDefinitions))
            }
            guard let assistant = try JSONDecoder().decode(ReActResponse.self, from: data).choices.first?.message else {
                throw AIError.emptyResponse
            }
            transcript.append(assistant)
            if let calls = assistant.toolCalls, !calls.isEmpty {
                for call in calls {
                    let output = workspace.execute(name: call.function.name, arguments: call.function.arguments)
                    transcript.append(ReActMessage(role: "tool", content: output, toolCallID: call.id))
                }
                continue
            }
            if let answer = assistant.content?.trimmingCharacters(in: .whitespacesAndNewlines), !answer.isEmpty {
                return ReActResult(answer: answer, generatedFiles: workspace.generatedFiles.sorted())
            }
            throw AIError.emptyResponse
        }
        throw AIError.maxToolSteps
    }

    static func visionMessages(from messages: [Message], imagePNG: Data) -> [VisionMessage] {
        guard let target = messages.lastIndex(where: { $0.role == "user" }) else {
            return messages.map { VisionMessage(role: $0.role, content: .text($0.content)) }
        }
        return messages.enumerated().map { index, message in
            VisionMessage(role: message.role,
                          content: index == target ? .image(text: message.content, data: imagePNG) : .text(message.content))
        }
    }

    private static func reactVisionMessages(from messages: [ReActMessage], imagePNG: Data) -> [ReActVisionMessage] {
        let target = messages.lastIndex(where: { $0.role == "user" })
        return messages.enumerated().map { index, message in
            let content = message.content.map { value in
                index == target ? VisionMessage.Content.image(text: value, data: imagePNG) : .text(value)
            }
            return ReActVisionMessage(role: message.role, content: content,
                                      reasoningContent: message.reasoningContent, toolCalls: message.toolCalls,
                                      toolCallID: message.toolCallID)
        }
    }

    private static func perform<Body: Encodable>(settings: AppSettings, body: Body) async throws -> Data {
        let key = await settings.apiKey
        guard !key.isEmpty else { throw AIError.missingKey }
        let base = await settings.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let endpoint = base.hasSuffix("/chat/completions") ? base : base + "/chat/completions"
        guard let url = URL(string: endpoint) else { throw AIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw AIError.server(String(data: data, encoding: .utf8) ?? "模型服务返回错误")
        }
        return data
    }
}

enum AIError: LocalizedError {
    case missingKey, invalidURL, emptyResponse, maxToolSteps, server(String)
    var errorDescription: String? {
        switch self {
        case .missingKey: "请先在设置中填写 API Key"
        case .invalidURL: "模型地址无效"
        case .emptyResponse: "模型没有返回内容"
        case .maxToolSteps: "模型连续调用工具次数过多，已停止本次任务"
        case .server(let message): message
        }
    }
}

import Foundation

final class KnowledgeFileTools {
    private let documents: [String: String]
    private let generatedRoot: URL
    private let manager: FileManager
    private(set) var generatedFiles = Set<String>()

    init(documents: [AgentDocument], generatedRoot: URL, manager: FileManager = .default) throws {
        self.manager = manager
        self.generatedRoot = generatedRoot
        var values: [String: String] = [:]
        for (index, document) in documents.enumerated() {
            values["documents/\(index + 1)-\(Self.safeFilename(document.name)).md"] = document.content
        }
        self.documents = values
        try manager.createDirectory(at: generatedRoot, withIntermediateDirectories: true)
    }

    var manifest: String {
        let documentLines = documents.keys.sorted().map { "- `\($0)`（只读）" }
        let generatedLines = listGeneratedFiles().map { "- `\($0)`（可读）" }
        return (documentLines + generatedLines + ["- `generated/`（仅此目录可写）"]).joined(separator: "\n")
    }

    func execute(name: String, arguments: String) -> String {
        guard let values = Self.decodeArguments(arguments) else { return error("工具参数不是有效的 JSON 对象") }
        do {
            switch name {
            case "list_files":
                return try listFiles(path: values["path"] as? String ?? ".")
            case "read_file":
                guard let path = values["path"] as? String else { return error("缺少 path") }
                return try readFile(path: path, offset: Self.integer(values["offset"]) ?? 0,
                                    limit: Self.integer(values["limit"]) ?? 20_000)
            case "search_files":
                guard let query = values["query"] as? String, !query.isEmpty else { return error("缺少 query") }
                return try searchFiles(query: query, path: values["path"] as? String ?? ".")
            case "write_file":
                guard let path = values["path"] as? String, let content = values["content"] as? String else {
                    return error("缺少 path 或 content")
                }
                return try writeFile(path: path, content: content)
            default:
                return error("未知工具：\(name)")
            }
        } catch {
            return self.error(error.localizedDescription)
        }
    }

    private func listFiles(path: String) throws -> String {
        let normalized = try normalize(path, allowRoot: true)
        let all = documents.keys.sorted() + listGeneratedFiles()
        let matches = normalized.isEmpty ? all : all.filter { $0 == normalized || $0.hasPrefix(normalized + "/") }
        return matches.isEmpty ? "（没有匹配的文件）" : matches.joined(separator: "\n")
    }

    private func readFile(path: String, offset: Int, limit: Int) throws -> String {
        let normalized = try normalize(path)
        let content = try content(at: normalized)
        let safeOffset = max(0, offset)
        let safeLimit = min(max(1, limit), 50_000)
        guard safeOffset < content.count else { return "（offset 已超过文件末尾，共 \(content.count) 字符）" }
        let start = content.index(content.startIndex, offsetBy: safeOffset)
        let end = content.index(start, offsetBy: safeLimit, limitedBy: content.endIndex) ?? content.endIndex
        return "[\(normalized) 字符 \(safeOffset)..<\(safeOffset + content.distance(from: start, to: end)) / \(content.count)]\n" + String(content[start..<end])
    }

    private func searchFiles(query: String, path: String) throws -> String {
        let normalized = try normalize(path, allowRoot: true)
        let candidates = documents.keys.sorted() + listGeneratedFiles()
        let matchingPaths = normalized.isEmpty ? candidates : candidates.filter { $0 == normalized || $0.hasPrefix(normalized + "/") }
        let needle = query.lowercased()
        var matches: [String] = []
        for file in matchingPaths {
            let lines = try content(at: file).split(separator: "\n", omittingEmptySubsequences: false)
            for (index, line) in lines.enumerated() where line.lowercased().contains(needle) {
                matches.append("\(file):\(index + 1): \(line.prefix(500))")
                if matches.count == 20 { return matches.joined(separator: "\n") }
            }
        }
        return matches.isEmpty ? "（未找到“\(query)”）" : matches.joined(separator: "\n")
    }

    private func writeFile(path: String, content: String) throws -> String {
        guard content.count <= 1_000_000 else { throw ToolFileError.contentTooLarge }
        let normalized = try normalize(path)
        guard normalized.hasPrefix("generated/"), normalized.count > "generated/".count else {
            throw ToolFileError.writeOutsideGenerated
        }
        let relative = String(normalized.dropFirst("generated/".count))
        let destination = try generatedURL(relative: relative)
        try manager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        _ = try generatedURL(relative: relative)
        try content.write(to: destination, atomically: true, encoding: .utf8)
        generatedFiles.insert(normalized)
        return "已写入 `\(normalized)`，共 \(content.count) 字符"
    }

    private func content(at path: String) throws -> String {
        if let content = documents[path] { return content }
        guard path.hasPrefix("generated/"), path.count > "generated/".count else { throw ToolFileError.fileNotFound(path) }
        let relative = String(path.dropFirst("generated/".count))
        let url = try generatedURL(relative: relative)
        guard manager.fileExists(atPath: url.path) else { throw ToolFileError.fileNotFound(path) }
        return try String(contentsOf: url, encoding: .utf8)
    }

    private func listGeneratedFiles() -> [String] {
        guard let enumerator = manager.enumerator(at: generatedRoot, includingPropertiesForKeys: [.isRegularFileKey]) else { return [] }
        return enumerator.compactMap { item -> String? in
            guard let url = item as? URL,
                  let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
                  values.isRegularFile == true, values.isSymbolicLink != true else { return nil }
            let rootPath = generatedRoot.standardizedFileURL.path + "/"
            guard url.standardizedFileURL.path.hasPrefix(rootPath) else { return nil }
            let resolvedRoot = generatedRoot.resolvingSymlinksInPath().standardizedFileURL.path + "/"
            guard url.resolvingSymlinksInPath().standardizedFileURL.path.hasPrefix(resolvedRoot) else { return nil }
            return "generated/" + String(url.standardizedFileURL.path.dropFirst(rootPath.count))
        }.sorted()
    }

    private func generatedURL(relative: String) throws -> URL {
        let candidate = generatedRoot.appendingPathComponent(relative).standardizedFileURL
        let lexicalRoot = generatedRoot.standardizedFileURL.path + "/"
        guard candidate.path.hasPrefix(lexicalRoot) else { throw ToolFileError.invalidPath }
        var componentURL = generatedRoot
        for component in relative.split(separator: "/") {
            componentURL.appendPathComponent(String(component))
            let attributes = try? manager.attributesOfItem(atPath: componentURL.path)
            if attributes?[.type] as? FileAttributeType == .typeSymbolicLink {
                throw ToolFileError.invalidPath
            }
        }
        let resolvedRoot = generatedRoot.resolvingSymlinksInPath().standardizedFileURL.path + "/"
        let resolvedCandidate = candidate.resolvingSymlinksInPath().standardizedFileURL.path
        guard resolvedCandidate.hasPrefix(resolvedRoot) else { throw ToolFileError.invalidPath }
        return candidate
    }

    private func normalize(_ path: String, allowRoot: Bool = false) throws -> String {
        let value = path.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\\", with: "/")
        if allowRoot && (value.isEmpty || value == ".") { return "" }
        guard !value.isEmpty, !value.hasPrefix("/"), !value.hasPrefix("~") else { throw ToolFileError.invalidPath }
        let components = value.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard !components.isEmpty, !components.contains("."), !components.contains("..") else { throw ToolFileError.invalidPath }
        return components.joined(separator: "/")
    }

    private func error(_ message: String) -> String {
        let value = ["ok": false, "error": message] as [String: Any]
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let result = String(data: data, encoding: .utf8) else { return "工具执行失败：\(message)" }
        return result
    }

    private static func decodeArguments(_ value: String) -> [String: Any]? {
        guard let data = value.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object
    }

    private static func integer(_ value: Any?) -> Int? {
        if let value = value as? Int { return value }
        return (value as? NSNumber)?.intValue
    }

    private static func safeFilename(_ value: String) -> String {
        let cleaned = value.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" }
        let result = String(cleaned).trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        return result.isEmpty ? "document" : String(result.prefix(100))
    }
}

enum ToolFileError: LocalizedError {
    case invalidPath
    case writeOutsideGenerated
    case fileNotFound(String)
    case contentTooLarge

    var errorDescription: String? {
        switch self {
        case .invalidPath: "路径无效；不允许绝对路径、~、. 或 .."
        case .writeOutsideGenerated: "写入被拒绝；只能写入 generated/ 目录"
        case .fileNotFound(let path): "文件不存在或不可读取：\(path)"
        case .contentTooLarge: "单次写入不能超过 100 万字符"
        }
    }
}

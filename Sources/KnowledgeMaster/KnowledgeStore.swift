import Foundation
import CryptoKit

@MainActor
final class KnowledgeStore: ObservableObject {
    @Published private(set) var data = KnowledgeData()
    @Published private(set) var rootURL: URL
    @Published var lastError: String?

    private let manager = FileManager.default
    private let encoder: JSONEncoder = {
        let value = JSONEncoder()
        value.outputFormatting = [.prettyPrinted, .sortedKeys]
        value.dateEncodingStrategy = .iso8601
        return value
    }()
    private let decoder: JSONDecoder = {
        let value = JSONDecoder()
        value.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: text) { return date }
            let standard = ISO8601DateFormatter()
            if let date = standard.date(from: text) { return date }
            throw DecodingError.dataCorruptedError(in: try decoder.singleValueContainer(), debugDescription: "无效日期：\(text)")
        }
        return value
    }()

    init(rootURL: URL? = nil) {
        let defaultRoot = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("KnowledgeMaster/library", isDirectory: true)
        let saved = UserDefaults.standard.string(forKey: "libraryRoot").map(URL.init(fileURLWithPath:))
        self.rootURL = rootURL ?? saved ?? defaultRoot
        do {
            try prepareDirectories()
            try load()
        } catch {
            lastError = error.localizedDescription
        }
    }

    var sourceURL: URL { rootURL.appendingPathComponent("source", isDirectory: true) }
    var documentsURL: URL { sourceURL.appendingPathComponent("documents", isDirectory: true) }
    var indexURL: URL { sourceURL.appendingPathComponent("index", isDirectory: true) }
    var metadataURL: URL { rootURL.appendingPathComponent("knowledge.json") }

    func generatedDirectory(for conversationID: UUID) -> URL {
        sourceURL.appendingPathComponent("generated", isDirectory: true)
            .appendingPathComponent(conversationID.uuidString, isDirectory: true)
    }

    var agentCacheURL: URL {
        sourceURL.appendingPathComponent("generated", isDirectory: true)
            .appendingPathComponent("agent-cache", isDirectory: true)
    }

    func generatedFileURL(for storedPath: String) -> URL? {
        guard storedPath.hasPrefix("source/generated/") else { return nil }
        let url = rootURL.appendingPathComponent(storedPath).standardizedFileURL
        let generatedRoot = sourceURL.appendingPathComponent("generated", isDirectory: true).standardizedFileURL.path + "/"
        guard url.path.hasPrefix(generatedRoot), manager.fileExists(atPath: url.path) else { return nil }
        return url
    }

    func prepareDirectories() throws {
        for url in [rootURL, documentsURL, indexURL, sourceURL.appendingPathComponent("downloads"), sourceURL.appendingPathComponent("generated")] {
            try manager.createDirectory(at: url, withIntermediateDirectories: true)
        }
    }

    func load() throws {
        guard manager.fileExists(atPath: metadataURL.path) else {
            try save()
            return
        }
        data = try decoder.decode(KnowledgeData.self, from: Data(contentsOf: metadataURL))
    }

    func save() throws {
        try prepareDirectories()
        let encoded = try encoder.encode(data)
        let backup = rootURL.appendingPathComponent("knowledge.json.bak")
        if manager.fileExists(atPath: metadataURL.path) {
            try? manager.removeItem(at: backup)
            try? manager.copyItem(at: metadataURL, to: backup)
        }
        try encoded.write(to: metadataURL, options: .atomic)
    }

    func switchRoot(to newRoot: URL, migrate: Bool) throws {
        if migrate && newRoot.standardizedFileURL != rootURL.standardizedFileURL {
            try manager.createDirectory(at: newRoot, withIntermediateDirectories: true)
            for name in ["knowledge.json", "knowledge.json.bak", "source"] {
                let source = rootURL.appendingPathComponent(name)
                let target = newRoot.appendingPathComponent(name)
                if manager.fileExists(atPath: source.path) && !manager.fileExists(atPath: target.path) {
                    try manager.copyItem(at: source, to: target)
                }
            }
        }
        rootURL = newRoot
        UserDefaults.standard.set(newRoot.path, forKey: "libraryRoot")
        data = KnowledgeData()
        try prepareDirectories()
        try load()
    }

    func storedURL(for document: KnowledgeDocument) -> URL {
        if let storedPath = document.storedPath {
            let url = URL(fileURLWithPath: storedPath)
            if url.isFileURL && storedPath.hasPrefix("/") { return url }
            return rootURL.appendingPathComponent(storedPath)
        }
        return documentsURL.appendingPathComponent(document.id.uuidString).appendingPathComponent(document.name)
    }

    func extractedContent(for documentID: UUID) -> ExtractedDocument {
        let url = indexURL.appendingPathComponent("\(documentID.uuidString).json")
        guard let content = try? Data(contentsOf: url), let value = try? decoder.decode(ExtractedDocument.self, from: content) else {
            return ExtractedDocument(text: "", pages: [])
        }
        return value
    }

    @discardableResult
    func importFiles(_ urls: [URL]) -> [String] {
        var messages: [String] = []
        for source in urls {
            let ext = source.pathExtension.lowercased()
            guard DocumentExtractor.supportedExtensions.contains(ext) else {
                messages.append("不支持：\(source.lastPathComponent)")
                continue
            }
            if data.documents.contains(where: { $0.name.localizedCaseInsensitiveCompare(source.lastPathComponent) == .orderedSame }) {
                messages.append("同名丢弃：\(source.lastPathComponent)")
                continue
            }
            do {
                let fileData = try Data(contentsOf: source)
                let digest = SHA256.hash(data: fileData).map { String(format: "%02x", $0) }.joined()
                if data.documents.contains(where: { $0.sha256 == digest }) {
                    messages.append("内容重复：\(source.lastPathComponent)")
                    continue
                }
                let id = UUID()
                let relative = "source/documents/\(id.uuidString)/\(source.lastPathComponent)"
                let destination = rootURL.appendingPathComponent(relative)
                try manager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                try manager.copyItem(at: source, to: destination)
                let extracted = try DocumentExtractor.extract(destination)
                try encoder.encode(extracted).write(to: indexURL.appendingPathComponent("\(id.uuidString).json"), options: .atomic)
                let size = (try manager.attributesOfItem(atPath: source.path)[.size] as? NSNumber)?.int64Value ?? 0
                data.documents.append(KnowledgeDocument(
                    id: id, name: source.lastPathComponent, extensionName: ".\(ext)", size: size,
                    sha256: digest, storedPath: relative, pageCount: extracted.pages.isEmpty ? nil : extracted.pages.count
                ))
                try save()
                messages.append("已导入：\(source.lastPathComponent)")
            } catch {
                messages.append("导入失败：\(source.lastPathComponent)（\(error.localizedDescription)）")
            }
        }
        return messages
    }

    func deleteDocument(_ id: UUID) {
        guard let document = data.documents.first(where: { $0.id == id }) else { return }
        try? manager.removeItem(at: storedURL(for: document).deletingLastPathComponent())
        try? manager.removeItem(at: indexURL.appendingPathComponent("\(id.uuidString).json"))
        data.documents.removeAll { $0.id == id }
        data.documentTopics.removeAll { $0.documentId == id }
        data.annotations.removeAll { $0.documentId == id }
        for index in data.conversations.indices {
            data.conversations[index].documentIds.removeAll { $0 == id }
            if data.conversations[index].currentDocumentId == id { data.conversations[index].currentDocumentId = nil }
        }
        try? save()
    }

    func createTopic(_ name: String) {
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        data.topics.append(Topic(name: value))
        try? save()
    }

    func link(documentID: UUID, topicID: UUID) {
        guard !data.documentTopics.contains(where: { $0.documentId == documentID && $0.topicId == topicID }) else { return }
        data.documentTopics.append(DocumentTopic(documentId: documentID, topicId: topicID, createdAt: Date()))
        try? save()
    }

    func unlink(documentID: UUID, topicID: UUID) {
        data.documentTopics.removeAll { $0.documentId == documentID && $0.topicId == topicID }
        try? save()
    }

    func documents(for topicID: UUID?) -> [KnowledgeDocument] {
        guard let topicID else { return data.documents }
        let ids = Set(data.documentTopics.filter { $0.topicId == topicID }.map(\.documentId))
        return data.documents.filter { ids.contains($0.id) }
    }

    func search(_ query: String, topicID: UUID?) -> [KnowledgeDocument] {
        let terms = Self.queryTerms(query)
        guard !terms.isEmpty else { return documents(for: topicID) }
        return documents(for: topicID).filter { document in
            let text = extractedContent(for: document.id).text.lowercased()
            let name = document.name.lowercased()
            return terms.contains { text.contains($0) || name.contains($0) }
        }
    }

    func addAnnotation(documentID: UUID, selection: ReaderSelection, kind: String, note: String = "") -> KnowledgeAnnotation {
        let annotation = KnowledgeAnnotation(documentId: documentID, page: selection.page, quote: selection.text,
                                             kind: kind, note: note, rects: selection.rects)
        data.annotations.append(annotation)
        try? save()
        return annotation
    }

    func updateAnnotation(_ id: UUID, note: String) {
        guard let index = data.annotations.firstIndex(where: { $0.id == id }) else { return }
        data.annotations[index].note = note
        data.annotations[index].updatedAt = Date()
        try? save()
    }

    func deleteAnnotation(_ id: UUID) {
        data.annotations.removeAll { $0.id == id }
        try? save()
    }

    func annotations(for documentID: UUID) -> [KnowledgeAnnotation] {
        data.annotations.filter { $0.documentId == documentID }
    }

    func recommendTopics(for document: KnowledgeDocument) -> [TopicRecommendation] {
        let material = (document.name + "\n" + extractedContent(for: document.id).text.prefix(3_000)).lowercased()
        let rules: [(String, [String])] = [
            ("RAG与知识库", ["rag", "知识库", "检索增强", "rerank"]),
            ("Agent", ["agent", "智能体", "工具调用"]),
            ("大模型", ["大模型", "llm", "transformer", "prompt"]),
            ("向量数据库", ["向量数据库", "embedding", "milvus", "pgvector"]),
            ("存储系统", ["存储系统", "文件系统", "对象存储", "nvme"]),
            ("AI Infra", ["ai infra", "gpu", "推理集群", "模型服务"]),
            ("软件开发", ["软件开发", "编程", "api", "架构设计"])
        ]
        return rules.compactMap { name, keywords in
            let matches = keywords.filter { material.contains($0) }
            return matches.isEmpty ? nil : TopicRecommendation(name: name, reason: "命中：\(matches.prefix(3).joined(separator: "、"))")
        }.prefix(3).map { $0 }
    }

    func applyRecommendations(_ values: [TopicRecommendation], documentID: UUID) {
        for value in values {
            let topic = data.topics.first(where: { $0.name.localizedCaseInsensitiveCompare(value.name) == .orderedSame }) ?? Topic(name: value.name)
            if !data.topics.contains(where: { $0.id == topic.id }) { data.topics.append(topic) }
            link(documentID: documentID, topicID: topic.id)
        }
        try? save()
    }

    func context(query: String, documentIDs: [UUID], topicIDs: [UUID]) -> [ContextChunk] {
        let topicDocumentIDs = data.documentTopics.filter { topicIDs.contains($0.topicId) }.map(\.documentId)
        let selectedIDs = Set(documentIDs + topicDocumentIDs)
        let selectedDocuments = data.documents.filter { selectedIDs.contains($0.id) }
        var candidates: [(Int, KnowledgeDocument, Int?, String)] = []
        for document in selectedDocuments {
            let extracted = extractedContent(for: document.id)
            if extracted.pages.isEmpty {
                for chunk in Self.chunks(extracted.text) { candidates.append((Self.score(query, in: chunk, title: document.name), document, nil, chunk)) }
            } else {
                for page in extracted.pages {
                    for chunk in Self.chunks(page.text) { candidates.append((Self.score(query, in: chunk, title: document.name), document, page.number, chunk)) }
                }
            }
        }
        let ranked = candidates.sorted { lhs, rhs in
            lhs.0 == rhs.0 ? lhs.1.name < rhs.1.name : lhs.0 > rhs.0
        }
        var selected: [(Int, KnowledgeDocument, Int?, String)] = []
        var used = Set<String>()
        func append(_ item: (Int, KnowledgeDocument, Int?, String)) {
            let key = "\(item.1.id.uuidString):\(item.2 ?? 0):\(item.3)"
            guard used.insert(key).inserted else { return }
            selected.append(item)
        }
        // 先为每份选中的文档保留一个最佳片段，避免跨文档提问被单一长文档垄断。
        for document in selectedDocuments.prefix(10) {
            if let best = ranked.first(where: { $0.1.id == document.id }) { append(best) }
        }
        for item in ranked where selected.count < 10 { append(item) }
        return selected.prefix(10).enumerated().map { index, item in
            ContextChunk(label: "资料\(index + 1)", documentId: item.1.id, documentName: item.1.name, page: item.2, text: item.3)
        }
    }

    func agentDocuments(documentIDs: [UUID], topicIDs: [UUID]) -> [AgentDocument] {
        let topicDocumentIDs = data.documentTopics.filter { topicIDs.contains($0.topicId) }.map(\.documentId)
        let selectedIDs = Set(documentIDs + topicDocumentIDs)
        return data.documents.filter { selectedIDs.contains($0.id) }.map { document in
            let extracted = extractedContent(for: document.id)
            let content: String
            if extracted.pages.isEmpty {
                content = extracted.text
            } else {
                content = extracted.pages.map { "## 第 \($0.number) 页\n\n\($0.text)" }.joined(separator: "\n\n")
            }
            return AgentDocument(id: document.id, name: document.name, content: content)
        }
    }

    func agentSourceDocuments(documentIDs: [UUID], topicIDs: [UUID]) -> [AgentSourceDocument] {
        let topicDocumentIDs = data.documentTopics.filter { topicIDs.contains($0.topicId) }.map(\.documentId)
        let selectedIDs = Set(documentIDs + topicDocumentIDs)
        return data.documents.filter { selectedIDs.contains($0.id) }.map { document in
            AgentSourceDocument(
                id: document.id,
                name: document.name,
                sourceURL: storedURL(for: document),
                cacheURL: agentCacheURL.appendingPathComponent(document.id.uuidString, isDirectory: true)
            )
        }
    }

    func annotationContext(query: String, documentIDs: [UUID], topicIDs: [UUID]) -> [KnowledgeAnnotation] {
        let topicDocumentIDs = data.documentTopics.filter { topicIDs.contains($0.topicId) }.map(\.documentId)
        let selected = Set(documentIDs + topicDocumentIDs)
        return data.annotations.filter { selected.contains($0.documentId) }
            .sorted { Self.score(query, in: $0.quote + "\n" + $0.note, title: "") > Self.score(query, in: $1.quote + "\n" + $1.note, title: "") }
            .prefix(30).map { $0 }
    }

    func saveConversation(_ conversation: Conversation) {
        if let index = data.conversations.firstIndex(where: { $0.id == conversation.id }) { data.conversations[index] = conversation }
        else { data.conversations.insert(conversation, at: 0) }
        try? save()
    }

    static func queryTerms(_ query: String) -> [String] {
        query.lowercased().split { $0.isWhitespace || $0.isPunctuation }.map(String.init).filter { !$0.isEmpty }
    }

    static func score(_ query: String, in text: String, title: String) -> Int {
        let terms = queryTerms(query)
        let body = text.lowercased()
        let name = title.lowercased()
        return terms.reduce(0) { $0 + (body.contains($1) ? 2 : 0) + (name.contains($1) ? 8 : 0) }
    }

    static func chunks(_ text: String, size: Int = 1_400, overlap: Int = 180) -> [String] {
        guard !text.isEmpty else { return [] }
        var result: [String] = []
        var start = text.startIndex
        while start < text.endIndex {
            let end = text.index(start, offsetBy: size, limitedBy: text.endIndex) ?? text.endIndex
            result.append(String(text[start..<end]))
            if end == text.endIndex { break }
            start = text.index(end, offsetBy: -min(overlap, text.distance(from: start, to: end)))
        }
        return result
    }
}

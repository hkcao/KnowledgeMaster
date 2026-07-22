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
    var notesURL: URL { sourceURL.appendingPathComponent("notes", isDirectory: true) }
    var metadataURL: URL { rootURL.appendingPathComponent("knowledge.json") }

    func generatedDirectory(for conversationID: UUID) -> URL {
        sourceURL.appendingPathComponent("generated", isDirectory: true)
            .appendingPathComponent(conversationID.uuidString, isDirectory: true)
    }

    var agentCacheURL: URL {
        sourceURL.appendingPathComponent("generated", isDirectory: true)
            .appendingPathComponent("agent-cache", isDirectory: true)
    }

    func pendingAgentDownloadsDirectory(for runID: UUID) -> URL {
        sourceURL.appendingPathComponent("downloads", isDirectory: true)
            .appendingPathComponent("pending", isDirectory: true)
            .appendingPathComponent(runID.uuidString, isDirectory: true)
    }

    func relativePendingDownloadPath(for url: URL) -> String? {
        let root = rootURL.standardizedFileURL.path + "/"
        let path = url.standardizedFileURL.path
        guard path.hasPrefix(root + "source/downloads/pending/") else { return nil }
        return String(path.dropFirst(root.count))
    }

    func pendingDownloadURL(for storedPath: String) -> URL? {
        guard storedPath.hasPrefix("source/downloads/pending/") else { return nil }
        let url = rootURL.appendingPathComponent(storedPath).standardizedFileURL
        let pendingRoot = sourceURL.appendingPathComponent("downloads/pending", isDirectory: true)
            .standardizedFileURL.path + "/"
        guard url.path.hasPrefix(pendingRoot), manager.fileExists(atPath: url.path) else { return nil }
        return url
    }

    func discardPendingDownload(at storedPath: String) {
        guard let url = pendingDownloadURL(for: storedPath) else { return }
        try? manager.removeItem(at: url)
        var directory = url.deletingLastPathComponent()
        let pendingRoot = sourceURL.appendingPathComponent("downloads/pending", isDirectory: true).standardizedFileURL
        while directory.path.hasPrefix(pendingRoot.path + "/"), directory != pendingRoot,
              (try? manager.contentsOfDirectory(atPath: directory.path).isEmpty) == true {
            try? manager.removeItem(at: directory)
            directory.deleteLastPathComponent()
        }
    }

    func generatedFileURL(for storedPath: String) -> URL? {
        guard storedPath.hasPrefix("source/generated/") else { return nil }
        let url = rootURL.appendingPathComponent(storedPath).standardizedFileURL
        let generatedRoot = sourceURL.appendingPathComponent("generated", isDirectory: true).standardizedFileURL.path + "/"
        guard url.path.hasPrefix(generatedRoot), manager.fileExists(atPath: url.path) else { return nil }
        return url
    }

    func prepareDirectories() throws {
        for url in [rootURL, documentsURL, indexURL, notesURL,
                    sourceURL.appendingPathComponent("downloads"), sourceURL.appendingPathComponent("generated")] {
            try manager.createDirectory(at: url, withIntermediateDirectories: true)
        }
    }

    func load() throws {
        guard manager.fileExists(atPath: metadataURL.path) else {
            try save()
            return
        }
        data = try decoder.decode(KnowledgeData.self, from: Data(contentsOf: metadataURL))
        data.version = 4
        if try migrateSummaryNotesToMarkdown() { try save() }
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
                let storedName = Self.flatStoredFilename(id: id, originalName: source.lastPathComponent)
                let relative = "source/documents/\(storedName)"
                let destination = rootURL.appendingPathComponent(relative)
                try manager.copyItem(at: source, to: destination)
                let extracted = try DocumentExtractor.extract(destination)
                try encoder.encode(extracted).write(to: indexURL.appendingPathComponent("\(id.uuidString).json"), options: .atomic)
                let displayName = ext == "pdf" ? DocumentExtractor.paperDisplayName(at: destination) : nil
                let size = (try manager.attributesOfItem(atPath: source.path)[.size] as? NSNumber)?.int64Value ?? 0
                data.documents.append(KnowledgeDocument(
                    id: id, name: source.lastPathComponent, displayName: displayName, extensionName: ".\(ext)", size: size,
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
        let fileURL = storedURL(for: document)
        try? manager.removeItem(at: fileURL)
        let parent = fileURL.deletingLastPathComponent()
        if parent.deletingLastPathComponent().standardizedFileURL == documentsURL.standardizedFileURL,
           (try? manager.contentsOfDirectory(atPath: parent.path).isEmpty) == true {
            try? manager.removeItem(at: parent)
        }
        try? manager.removeItem(at: indexURL.appendingPathComponent("\(id.uuidString).json"))
        data.documents.removeAll { $0.id == id }
        data.documentTopics.removeAll { $0.documentId == id }
        let removedAnnotationIDs = Set(data.annotations.filter { $0.documentId == id }.map(\.id))
        data.annotations.removeAll { $0.documentId == id }
        for index in data.summaryNotes.indices {
            data.summaryNotes[index].annotationIDs.removeAll { removedAnnotationIDs.contains($0) }
        }
        for index in data.conversations.indices {
            data.conversations[index].documentIds.removeAll { $0 == id }
            if data.conversations[index].currentDocumentId == id { data.conversations[index].currentDocumentId = nil }
        }
        try? save()
    }

    func updateDocumentDisplayName(_ id: UUID, displayName: String?) {
        guard let index = data.documents.firstIndex(where: { $0.id == id }) else { return }
        let value = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        data.documents[index].displayName = value?.isEmpty == false ? value : nil
        try? save()
    }

    @discardableResult
    func createTopic(_ name: String, parentID: UUID? = nil) -> Topic? {
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        let topic = Topic(name: value, parentId: parentID)
        data.topics.append(topic)
        try? save()
        return topic
    }

    func renameTopic(_ id: UUID, name: String) {
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, let index = data.topics.firstIndex(where: { $0.id == id }) else { return }
        data.topics[index].name = value
        try? save()
    }

    func deleteTopic(_ id: UUID) {
        guard data.topics.contains(where: { $0.id == id }) else { return }
        var removed: Set<UUID> = [id]
        var added = true
        while added {
            let children = data.topics.filter { topic in
                topic.parentId.map { removed.contains($0) } ?? false
            }.map(\.id)
            let previousCount = removed.count
            removed.formUnion(children)
            added = removed.count != previousCount
        }
        data.topics.removeAll { removed.contains($0.id) }
        data.documentTopics.removeAll { removed.contains($0.topicId) }
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
            let name = (document.name + "\n" + document.displayTitle).lowercased()
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
        for index in data.summaryNotes.indices {
            data.summaryNotes[index].annotationIDs.removeAll { $0 == id }
        }
        try? save()
    }

    func annotations(for documentID: UUID) -> [KnowledgeAnnotation] {
        data.annotations.filter { $0.documentId == documentID }
    }

    @discardableResult
    func createSummaryNote(title: String, content: String = "", annotationIDs: [UUID] = []) -> SummaryNote? {
        let value = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        let validIDs = Set(data.annotations.map(\.id))
        let body = content.trimmingCharacters(in: .whitespacesAndNewlines)
        var note = SummaryNote(title: value, content: body,
                               annotationIDs: annotationIDs.filter { validIDs.contains($0) })
        note.storedPath = "source/notes/\(note.id.uuidString).md"
        do { try writeSummaryNote(note, title: value, content: body) }
        catch { lastError = "无法创建 Markdown 笔记：\(error.localizedDescription)"; return nil }
        data.summaryNotes.insert(note, at: 0)
        try? save()
        return note
    }

    func updateSummaryNote(_ id: UUID, title: String, content: String, annotationIDs: [UUID]) {
        guard let index = data.summaryNotes.firstIndex(where: { $0.id == id }) else { return }
        let value = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        let validIDs = Set(data.annotations.map(\.id))
        let body = content.trimmingCharacters(in: .whitespacesAndNewlines)
        do { try writeSummaryNote(data.summaryNotes[index], title: value, content: body) }
        catch { lastError = "无法保存 Markdown 笔记：\(error.localizedDescription)"; return }
        data.summaryNotes[index].title = value
        data.summaryNotes[index].content = body
        if data.summaryNotes[index].storedPath == nil {
            data.summaryNotes[index].storedPath = "source/notes/\(id.uuidString).md"
        }
        data.summaryNotes[index].annotationIDs = annotationIDs.filter { validIDs.contains($0) }
        data.summaryNotes[index].updatedAt = Date()
        try? save()
    }

    func deleteSummaryNote(_ id: UUID) {
        if let note = data.summaryNotes.first(where: { $0.id == id }), let url = summaryNoteURL(for: note) {
            try? manager.removeItem(at: url)
        }
        data.summaryNotes.removeAll { $0.id == id }
        try? save()
    }

    func summaryNoteMarkdown(for note: SummaryNote) -> String {
        if let url = summaryNoteURL(for: note), let value = try? String(contentsOf: url, encoding: .utf8) {
            return value
        }
        return Self.summaryNoteMarkdown(title: note.title, content: note.content)
    }

    func summaryNoteContent(for note: SummaryNote) -> String {
        Self.parseSummaryNoteMarkdown(summaryNoteMarkdown(for: note), fallbackTitle: note.title).content
    }

    func summaryNoteURL(for note: SummaryNote) -> URL? {
        let storedPath = note.storedPath ?? "source/notes/\(note.id.uuidString).md"
        guard storedPath.hasPrefix("source/notes/") else { return nil }
        let url = rootURL.appendingPathComponent(storedPath).standardizedFileURL
        guard url.path.hasPrefix(notesURL.standardizedFileURL.path + "/") else { return nil }
        return url
    }

    static func summaryNoteMarkdown(title: String, content: String) -> String {
        "# \(title.trimmingCharacters(in: .whitespacesAndNewlines))\n\n" +
            content.trimmingCharacters(in: .whitespacesAndNewlines) + "\n"
    }

    static func parseSummaryNoteMarkdown(_ markdown: String, fallbackTitle: String) -> (title: String, content: String) {
        var lines = markdown.components(separatedBy: .newlines)
        let firstNonempty = lines.firstIndex { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard let index = firstNonempty else { return (fallbackTitle, "") }
        let first = lines[index].trimmingCharacters(in: .whitespaces)
        guard first.hasPrefix("# ") else {
            return (fallbackTitle, markdown.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        let title = String(first.dropFirst(2)).trimmingCharacters(in: .whitespacesAndNewlines)
        lines.removeSubrange(0...index)
        return (title.isEmpty ? fallbackTitle : title,
                lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func writeSummaryNote(_ note: SummaryNote, title: String, content: String) throws {
        let path = note.storedPath ?? "source/notes/\(note.id.uuidString).md"
        let target = rootURL.appendingPathComponent(path).standardizedFileURL
        guard target.path.hasPrefix(notesURL.standardizedFileURL.path + "/") else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        try manager.createDirectory(at: notesURL, withIntermediateDirectories: true)
        try Self.summaryNoteMarkdown(title: title, content: content)
            .write(to: target, atomically: true, encoding: .utf8)
    }

    private func migrateSummaryNotesToMarkdown() throws -> Bool {
        var changed = false
        for index in data.summaryNotes.indices {
            let expected = "source/notes/\(data.summaryNotes[index].id.uuidString).md"
            if data.summaryNotes[index].storedPath == nil {
                data.summaryNotes[index].storedPath = expected
                changed = true
            }
            guard let url = summaryNoteURL(for: data.summaryNotes[index]) else { continue }
            if manager.fileExists(atPath: url.path) {
                if let markdown = try? String(contentsOf: url, encoding: .utf8) {
                    let parsed = Self.parseSummaryNoteMarkdown(markdown, fallbackTitle: data.summaryNotes[index].title)
                    if data.summaryNotes[index].title != parsed.title || data.summaryNotes[index].content != parsed.content {
                        data.summaryNotes[index].title = parsed.title
                        data.summaryNotes[index].content = parsed.content
                        changed = true
                    }
                }
            } else {
                try writeSummaryNote(data.summaryNotes[index], title: data.summaryNotes[index].title,
                                     content: data.summaryNotes[index].content)
            }
        }
        return changed
    }

    func recommendTopics(for document: KnowledgeDocument) -> [TopicRecommendation] {
        let material = (document.displayTitle + "\n" + extractedContent(for: document.id).text.prefix(3_000)).lowercased()
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
                for chunk in Self.chunks(extracted.text) { candidates.append((Self.score(query, in: chunk, title: document.displayTitle), document, nil, chunk)) }
            } else {
                for page in extracted.pages {
                    for chunk in Self.chunks(page.text) { candidates.append((Self.score(query, in: chunk, title: document.displayTitle), document, page.number, chunk)) }
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
            ContextChunk(label: "资料\(index + 1)", documentId: item.1.id, documentName: item.1.displayTitle, page: item.2, text: item.3)
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
            return AgentDocument(id: document.id, name: document.displayTitle, content: content)
        }
    }

    func agentSourceDocuments(documentIDs: [UUID], topicIDs: [UUID]) -> [AgentSourceDocument] {
        let topicDocumentIDs = data.documentTopics.filter { topicIDs.contains($0.topicId) }.map(\.documentId)
        let selectedIDs = Set(documentIDs + topicDocumentIDs)
        return data.documents.filter { selectedIDs.contains($0.id) }.map { document in
            AgentSourceDocument(
                id: document.id,
                name: document.name,
                displayName: document.displayTitle,
                sourceURL: storedURL(for: document),
                cacheURL: agentCacheURL.appendingPathComponent(document.id.uuidString, isDirectory: true),
                baselineExtractionURL: manager.fileExists(atPath: indexURL.appendingPathComponent("\(document.id.uuidString).json").path)
                    ? indexURL.appendingPathComponent("\(document.id.uuidString).json") : nil
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

    static func flatStoredFilename(id: UUID, originalName: String) -> String {
        let safeName = originalName.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        return "\(id.uuidString)--\(safeName.isEmpty ? "document" : safeName)"
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

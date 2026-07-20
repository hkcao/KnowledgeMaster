import Foundation
import CoreGraphics

enum ChatBackend: String, Codable, CaseIterable, Identifiable {
    case direct
    case claudeCode
    case codex

    var id: String { rawValue }
    var name: String {
        switch self {
        case .direct: "直接 API"
        case .claudeCode: "Claude Code"
        case .codex: "Codex"
        }
    }
    var icon: String {
        switch self {
        case .direct: "bolt.horizontal.circle"
        case .claudeCode: "terminal"
        case .codex: "apple.terminal"
        }
    }
}

enum ChatPlacement: String, Codable, CaseIterable, Identifiable {
    case right
    case bottom
    case sidebar
    case hidden

    var id: String { rawValue }
    var name: String {
        switch self {
        case .right: "右侧"
        case .bottom: "底部"
        case .sidebar: "左侧合并"
        case .hidden: "隐藏"
        }
    }
    var icon: String {
        switch self {
        case .right: "rectangle.righthalf.inset.filled"
        case .bottom: "rectangle.bottomhalf.inset.filled"
        case .sidebar: "sidebar.left"
        case .hidden: "eye.slash"
        }
    }
}

enum APIContextMode: String, Codable, CaseIterable, Identifiable {
    case relevantFragments
    case autonomous

    var id: String { rawValue }
    var name: String {
        switch self {
        case .relevantFragments: "相关片段"
        case .autonomous: "自主检索"
        }
    }
}

struct KnowledgeData: Codable {
    var version: Int = 3
    var documents: [KnowledgeDocument] = []
    var topics: [Topic] = []
    var documentTopics: [DocumentTopic] = []
    var annotations: [KnowledgeAnnotation] = []
    var conversations: [Conversation] = []
    var topicSummaries: [TopicSummary] = []
    var summaryNotes: [SummaryNote] = []

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 3
        documents = try container.decodeIfPresent([KnowledgeDocument].self, forKey: .documents) ?? []
        topics = try container.decodeIfPresent([Topic].self, forKey: .topics) ?? []
        documentTopics = try container.decodeIfPresent([DocumentTopic].self, forKey: .documentTopics) ?? []
        annotations = try container.decodeIfPresent([KnowledgeAnnotation].self, forKey: .annotations) ?? []
        conversations = try container.decodeIfPresent([Conversation].self, forKey: .conversations) ?? []
        topicSummaries = try container.decodeIfPresent([TopicSummary].self, forKey: .topicSummaries) ?? []
        summaryNotes = try container.decodeIfPresent([SummaryNote].self, forKey: .summaryNotes) ?? []
    }
}

struct KnowledgeDocument: Codable, Identifiable, Hashable {
    var id: UUID
    var name: String
    var displayName: String?
    var extensionName: String
    var size: Int64
    var sha256: String
    var storedPath: String?
    var importedAt: Date
    var status: String
    var pageCount: Int?
    var error: String?

    enum CodingKeys: String, CodingKey {
        case id, name, displayName, size, sha256, storedPath, importedAt, status, pageCount, error
        case extensionName = "extension"
    }

    init(id: UUID = UUID(), name: String, displayName: String? = nil, extensionName: String, size: Int64, sha256: String,
         storedPath: String?, importedAt: Date = Date(), status: String = "ready", pageCount: Int? = nil) {
        self.id = id
        self.name = name
        self.displayName = displayName
        self.extensionName = extensionName
        self.size = size
        self.sha256 = sha256
        self.storedPath = storedPath
        self.importedAt = importedAt
        self.status = status
        self.pageCount = pageCount
    }

    var displayTitle: String {
        let value = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? name : value
    }
}

struct Topic: Codable, Identifiable, Hashable {
    var id: UUID
    var name: String
    var parentId: UUID?
    var createdAt: Date

    init(id: UUID = UUID(), name: String, parentId: UUID? = nil, createdAt: Date = Date()) {
        self.id = id
        self.name = name
        self.parentId = parentId
        self.createdAt = createdAt
    }
}

struct DocumentTopic: Codable, Hashable {
    var documentId: UUID
    var topicId: UUID
    var createdAt: Date
}

struct AnnotationRect: Codable, Hashable {
    var page: Int
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    var cgRect: CGRect { CGRect(x: x, y: y, width: width, height: height) }
}

struct KnowledgeAnnotation: Codable, Identifiable, Hashable {
    var id: UUID
    var documentId: UUID
    var page: Int?
    var quote: String
    var kind: String
    var note: String
    var rects: [AnnotationRect]
    var createdAt: Date
    var updatedAt: Date

    init(id: UUID = UUID(), documentId: UUID, page: Int?, quote: String, kind: String,
         note: String = "", rects: [AnnotationRect] = [], createdAt: Date = Date(), updatedAt: Date = Date()) {
        self.id = id
        self.documentId = documentId
        self.page = page
        self.quote = quote
        self.kind = kind
        self.note = note
        self.rects = rects
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey { case id, documentId, page, quote, kind, note, rects, createdAt, updatedAt }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        documentId = try container.decode(UUID.self, forKey: .documentId)
        page = try container.decodeIfPresent(Int.self, forKey: .page)
        quote = try container.decode(String.self, forKey: .quote)
        kind = try container.decode(String.self, forKey: .kind)
        note = try container.decodeIfPresent(String.self, forKey: .note) ?? ""
        rects = try container.decodeIfPresent([AnnotationRect].self, forKey: .rects) ?? []
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
    }
}

enum KnowledgeAnnotationReference {
    private static let pdfPrefix = "KM:"
    private static let linkScheme = "knowledgemaster-annotation"

    static func pdfContents(for id: UUID) -> String { pdfPrefix + id.uuidString }

    static func id(fromPDFContents contents: String?) -> UUID? {
        guard let contents, contents.hasPrefix(pdfPrefix) else { return nil }
        return UUID(uuidString: String(contents.dropFirst(pdfPrefix.count)))
    }

    static func link(for id: UUID) -> URL {
        URL(string: "\(linkScheme)://\(id.uuidString)")!
    }

    static func id(fromLink value: Any) -> UUID? {
        let url: URL?
        if let value = value as? URL { url = value }
        else if let value = value as? String { url = URL(string: value) }
        else { url = nil }
        guard let url, url.scheme == linkScheme else { return nil }
        return UUID(uuidString: url.host ?? "")
    }
}

enum AgentTraceKind: String, Codable, Hashable {
    case status
    case tool
    case file
    case warning
    case error
    case completed
}

struct AgentTraceEvent: Codable, Identifiable, Hashable {
    var id: UUID
    var kind: AgentTraceKind
    var title: String
    var detail: String?
    var createdAt: Date

    init(id: UUID = UUID(), kind: AgentTraceKind, title: String, detail: String? = nil, createdAt: Date = Date()) {
        self.id = id
        self.kind = kind
        self.title = title
        self.detail = detail
        self.createdAt = createdAt
    }
}

struct ChatMessage: Codable, Identifiable, Hashable {
    var id: UUID
    var role: String
    var content: String
    var quote: ReaderQuote?
    var sources: [ContextChunk]?
    var backend: String?
    var generatedFiles: [String]?
    var traceEvents: [AgentTraceEvent]?
    var createdAt: Date

    init(id: UUID = UUID(), role: String, content: String, quote: ReaderQuote? = nil,
         sources: [ContextChunk]? = nil, backend: String? = nil, generatedFiles: [String]? = nil,
         traceEvents: [AgentTraceEvent]? = nil,
         createdAt: Date = Date()) {
        self.id = id
        self.role = role
        self.content = content
        self.quote = quote
        self.sources = sources
        self.backend = backend
        self.generatedFiles = generatedFiles
        self.traceEvents = traceEvents
        self.createdAt = createdAt
    }
}

struct Conversation: Codable, Identifiable, Hashable {
    var id: UUID
    var title: String
    var documentIds: [UUID]
    var topicIds: [UUID]
    var includeCurrentPage: Bool
    var includeAnnotations: Bool
    var currentDocumentId: UUID?
    var messages: [ChatMessage]
    var summary: String
    var createdAt: Date
    var updatedAt: Date

    init(id: UUID = UUID(), title: String = "新对话", documentIds: [UUID] = [], topicIds: [UUID] = [],
         includeCurrentPage: Bool = false, includeAnnotations: Bool = true, currentDocumentId: UUID? = nil,
         messages: [ChatMessage] = [], summary: String = "", createdAt: Date = Date(), updatedAt: Date = Date()) {
        self.id = id
        self.title = title
        self.documentIds = documentIds
        self.topicIds = topicIds
        self.includeCurrentPage = includeCurrentPage
        self.includeAnnotations = includeAnnotations
        self.currentDocumentId = currentDocumentId
        self.messages = messages
        self.summary = summary
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, title, documentIds, topicIds, includeCurrentPage, includeAnnotations, currentDocumentId
        case messages, summary, createdAt, updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? "新对话"
        documentIds = try c.decodeIfPresent([UUID].self, forKey: .documentIds) ?? []
        topicIds = try c.decodeIfPresent([UUID].self, forKey: .topicIds) ?? []
        includeCurrentPage = try c.decodeIfPresent(Bool.self, forKey: .includeCurrentPage) ?? false
        includeAnnotations = try c.decodeIfPresent(Bool.self, forKey: .includeAnnotations) ?? true
        currentDocumentId = try c.decodeIfPresent(UUID.self, forKey: .currentDocumentId)
        messages = try c.decodeIfPresent([ChatMessage].self, forKey: .messages) ?? []
        summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
    }
}

struct TopicSummary: Codable, Hashable {
    var topicId: UUID
    var summary: String
    var updatedAt: Date
}

struct SummaryNote: Codable, Identifiable, Hashable {
    var id: UUID
    var title: String
    var content: String
    var annotationIDs: [UUID]
    var createdAt: Date
    var updatedAt: Date

    init(id: UUID = UUID(), title: String, content: String = "", annotationIDs: [UUID] = [],
         createdAt: Date = Date(), updatedAt: Date = Date()) {
        self.id = id
        self.title = title
        self.content = content
        self.annotationIDs = annotationIDs
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

struct ExtractedPage: Codable, Hashable {
    var number: Int
    var text: String
}

struct ExtractedDocument: Codable, Hashable {
    var text: String
    var pages: [ExtractedPage]
}

struct AgentDocument: Hashable {
    var id: UUID
    var name: String
    var content: String
}

struct AgentSourceDocument: Hashable {
    var id: UUID
    var name: String
    var displayName: String? = nil
    var sourceURL: URL
    var cacheURL: URL
    var baselineExtractionURL: URL? = nil
}

struct AgentRunRequest: Hashable {
    var question: String
    var quote: ReaderQuote?
    var history: [ChatMessage]
    var documents: [AgentSourceDocument]
    var annotations: [KnowledgeAnnotation]
}

struct AgentRunResult: Hashable {
    var answer: String
    var generatedFiles: [String]
    var traceEvents: [AgentTraceEvent]
}

struct ReaderSelection: Hashable {
    var text: String
    var page: Int?
    var rects: [AnnotationRect] = []
    var anchorX: Double?
    var anchorY: Double?
}

struct ReaderQuote: Codable, Hashable {
    var text: String
    var documentId: UUID?
    var documentName: String
    var page: Int?
}

struct ContextChunk: Codable, Identifiable, Hashable {
    var id: UUID = UUID()
    var label: String
    var documentId: UUID
    var documentName: String
    var page: Int?
    var text: String
}

struct TopicRecommendation: Identifiable, Hashable {
    var id: String { name }
    var name: String
    var reason: String
}

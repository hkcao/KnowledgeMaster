import Foundation

enum PaperNamingService {
    struct Result: Decodable, Hashable {
        var isPaper: Bool
        var title: String
        var firstAuthor: String
        var multipleAuthors: Bool

        enum CodingKeys: String, CodingKey {
            case isPaper = "is_paper"
            case title
            case firstAuthor = "first_author"
            case multipleAuthors = "multiple_authors"
        }
    }

    static func suggestName(document: KnowledgeDocument, extracted: ExtractedDocument,
                            settings: AppSettings) async throws -> String? {
        let firstPage = extracted.pages.first?.text ?? String(extracted.text.prefix(10_000))
        guard !firstPage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let response = try await AIClient.completion(settings: settings, messages: [
            .init(role: "system", content: """
            你负责识别学术论文元数据。只返回一个 JSON 对象，不要 Markdown、解释或代码围栏：
            {"is_paper":true,"title":"完整论文标题","first_author":"第一作者姓名","multiple_authors":true}
            不要把页眉、期刊名、会议状态、arXiv 编号、机构或 ABSTRACT 当作标题。无法确认时将 is_paper 设为 false。
            """),
            .init(role: "user", content: "原文件名：\(document.name)\n\nPDF 第一页文本：\n\(String(firstPage.prefix(12_000)))")
        ])
        guard let metadata = parse(response), metadata.isPaper else { return nil }
        return displayName(from: metadata)
    }

    static func needsRefinement(_ document: KnowledgeDocument) -> Bool {
        guard document.extensionName == ".pdf" else { return false }
        guard let value = document.displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return true }
        let lower = value.lowercased()
        return value == document.name || value.count < 12 || lower.contains("published as") ||
            lower.contains("conference paper") || lower.contains("arxiv:") || lower.hasPrefix("networks,")
    }

    static func parse(_ value: String) -> Result? {
        guard let start = value.firstIndex(of: "{"), let end = value.lastIndex(of: "}"), start <= end else { return nil }
        let json = String(value[start...end])
        return try? JSONDecoder().decode(Result.self, from: Data(json.utf8))
    }

    static func displayName(from result: Result) -> String? {
        let title = result.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard result.isPaper, title.count >= 6 else { return nil }
        guard let surname = DocumentExtractor.firstAuthorSurname(from: result.firstAuthor) else { return title }
        return result.multipleAuthors ? "\(surname) et al., \(title)" : "\(surname), \(title)"
    }
}

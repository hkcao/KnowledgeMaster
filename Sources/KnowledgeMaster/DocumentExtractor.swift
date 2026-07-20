import Foundation
import PDFKit
import AppKit

enum DocumentExtractor {
    static let supportedExtensions = Set(["pdf", "html", "htm", "md", "markdown", "txt"])

    static func importableFiles(from urls: [URL], manager: FileManager = .default) -> [URL] {
        var result: [URL] = []
        for url in urls {
            let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey])
            if values?.isDirectory == true,
               let enumerator = manager.enumerator(at: url, includingPropertiesForKeys: [.isRegularFileKey]) {
                result += enumerator.compactMap { $0 as? URL }.filter {
                    supportedExtensions.contains($0.pathExtension.lowercased())
                }
            } else if values?.isRegularFile == true, supportedExtensions.contains(url.pathExtension.lowercased()) {
                result.append(url)
            }
        }
        return result
    }

    static func extract(_ url: URL) throws -> ExtractedDocument {
        switch url.pathExtension.lowercased() {
        case "pdf":
            guard let pdf = PDFDocument(url: url) else { throw CocoaError(.fileReadCorruptFile) }
            let pages = (0..<pdf.pageCount).map { index in
                ExtractedPage(number: index + 1, text: pdf.page(at: index)?.string ?? "")
            }
            return ExtractedDocument(text: pages.map(\.text).joined(separator: "\n\n"), pages: pages)
        case "html", "htm":
            let data = try Data(contentsOf: url)
            let attributed = try NSAttributedString(
                data: data,
                options: [.documentType: NSAttributedString.DocumentType.html,
                          .characterEncoding: String.Encoding.utf8.rawValue],
                documentAttributes: nil
            )
            return ExtractedDocument(text: attributed.string, pages: [])
        default:
            return ExtractedDocument(text: try String(contentsOf: url, encoding: .utf8), pages: [])
        }
    }

    static func paperDisplayName(at url: URL) -> String? {
        guard let pdf = PDFDocument(url: url), let firstPage = pdf.page(at: 0)?.string else { return nil }
        let normalized = firstPage.replacingOccurrences(of: "\r\n", with: "\n")
        let lower = normalized.lowercased()
        guard lower.contains("\nabstract") || normalized.contains("摘要") else { return nil }

        let attributes = pdf.documentAttributes ?? [:]
        let rawMetadataTitle = cleanMetadata(attributes[PDFDocumentAttribute.titleAttribute] as? String)
        let fileStem = url.deletingPathExtension().lastPathComponent
        let metadataTitle = rawMetadataTitle.flatMap {
            $0.localizedCaseInsensitiveCompare(url.lastPathComponent) == .orderedSame ||
            $0.localizedCaseInsensitiveCompare(fileStem) == .orderedSame ? nil : $0
        }
        let metadataAuthor = cleanMetadata(attributes[PDFDocumentAttribute.authorAttribute] as? String)
        let lines = normalized.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        let title = metadataTitle ?? inferredTitle(from: lines)
        guard let title else { return nil }
        let author = metadataAuthor ?? inferredAuthor(from: lines, title: title)
        return paperDisplayName(title: title, authors: author)
    }

    static func paperDisplayName(title: String, authors: String?) -> String? {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleanTitle.count >= 6 else { return nil }
        guard let authors, let first = firstAuthorSurname(from: authors) else { return cleanTitle }
        let multiple = authors.contains(",") || authors.contains(";") || authors.range(of: " and ", options: .caseInsensitive) != nil
        return multiple ? "\(first) et al., \(cleanTitle)" : "\(first), \(cleanTitle)"
    }

    static func firstAuthorSurname(from authors: String) -> String? {
        let firstBlock = authors.components(separatedBy: ";").first?
            .components(separatedBy: ",").first?
            .components(separatedBy: " and ").first?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let words = firstBlock.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard let value = words.last?.trimmingCharacters(in: .punctuationCharacters), !value.isEmpty else { return nil }
        return value.prefix(1).uppercased() + value.dropFirst()
    }

    private static func cleanMetadata(_ value: String?) -> String? {
        guard let value else { return nil }
        let clean = value.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        guard clean.count >= 3, clean.localizedCaseInsensitiveCompare("untitled") != .orderedSame else { return nil }
        return clean
    }

    private static func inferredTitle(from lines: [String]) -> String? {
        guard !lines.isEmpty else { return nil }
        let candidates = lines.prefix(5).filter { line in
            line.count >= 12 && line.count <= 300 && !line.lowercased().contains("arxiv:") && !line.lowercased().hasPrefix("doi")
        }
        return candidates.first
    }

    private static func inferredAuthor(from lines: [String], title: String) -> String? {
        guard let titleIndex = lines.firstIndex(of: title) else { return nil }
        let next = lines.index(after: titleIndex)
        guard next < lines.endIndex else { return nil }
        let candidate = lines[next]
        guard candidate.count < 240, !candidate.lowercased().contains("abstract") else { return nil }
        return candidate
    }
}

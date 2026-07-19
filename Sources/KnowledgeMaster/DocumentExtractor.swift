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
}

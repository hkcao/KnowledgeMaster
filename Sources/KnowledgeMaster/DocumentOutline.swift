import Foundation
import AppKit
import PDFKit

enum DocumentNavigationTarget: Hashable {
    case pdf(pageIndex: Int, point: CGPoint?)
    case text(location: Int)
}

struct DocumentNavigationRequest: Equatable {
    var id = UUID()
    var target: DocumentNavigationTarget
}

struct DocumentOutlineEntry: Identifiable, Hashable {
    var id: String
    var title: String
    var level: Int
    var target: DocumentNavigationTarget
}

enum DocumentOutlineBuilder {
    static func entries(document: KnowledgeDocument, sourceURL: URL,
                        extracted: ExtractedDocument, renderedText: String) -> [DocumentOutlineEntry] {
        if document.extensionName == ".pdf" {
            return pdfEntries(sourceURL: sourceURL, extracted: extracted)
        }
        let source = (try? String(contentsOf: sourceURL, encoding: .utf8)) ?? extracted.text
        return textEntries(source: source, extensionName: document.extensionName, renderedText: renderedText)
    }

    static func textEntries(source: String, extensionName: String,
                            renderedText: String) -> [DocumentOutlineEntry] {
        let headings: [(String, Int)]
        if [".html", ".htm"].contains(extensionName) {
            headings = htmlHeadings(source)
        } else {
            headings = plainTextHeadings(source)
        }
        return entries(for: headings, in: renderedText)
    }

    private static func pdfEntries(sourceURL: URL, extracted: ExtractedDocument) -> [DocumentOutlineEntry] {
        guard let pdf = PDFDocument(url: sourceURL) else { return [] }
        if let root = pdf.outlineRoot {
            var result: [DocumentOutlineEntry] = []
            appendPDFChildren(of: root, level: 1, path: "root", document: pdf, result: &result)
            if !result.isEmpty { return result }
        }

        let detected = extracted.pages.compactMap { page -> DocumentOutlineEntry? in
            guard let title = page.text.components(separatedBy: .newlines)
                .map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) })
                .first(where: isLikelyHeading) else { return nil }
            return DocumentOutlineEntry(id: "pdf-page-\(page.number)-\(title)", title: title,
                                        level: headingLevel(title), target: .pdf(pageIndex: page.number - 1, point: nil))
        }
        if !detected.isEmpty { return detected }
        return (0..<pdf.pageCount).map { index in
            DocumentOutlineEntry(id: "pdf-page-\(index)", title: "第 \(index + 1) 页", level: 1,
                                 target: .pdf(pageIndex: index, point: nil))
        }
    }

    private static func appendPDFChildren(of parent: PDFOutline, level: Int, path: String, document: PDFDocument,
                                          result: inout [DocumentOutlineEntry]) {
        for index in 0..<parent.numberOfChildren {
            guard let item = parent.child(at: index) else { continue }
            let itemPath = "\(path)-\(index)"
            if let destination = item.destination ?? (item.action as? PDFActionGoTo)?.destination,
               let page = destination.page {
                let pageIndex = document.index(for: page)
                let title = item.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if pageIndex != NSNotFound, !title.isEmpty {
                    result.append(DocumentOutlineEntry(
                        id: "pdf-outline-\(itemPath)", title: title, level: level,
                        target: .pdf(pageIndex: pageIndex, point: destination.point)
                    ))
                }
            }
            appendPDFChildren(of: item, level: level + 1, path: itemPath, document: document, result: &result)
        }
    }

    private static func plainTextHeadings(_ source: String) -> [(String, Int)] {
        source.components(separatedBy: .newlines).compactMap { rawLine in
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            let markerCount = line.prefix(while: { $0 == "#" }).count
            if (1...6).contains(markerCount), line.dropFirst(markerCount).first?.isWhitespace == true {
                let title = line.dropFirst(markerCount)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .trimmingCharacters(in: CharacterSet(charactersIn: "#"))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !title.isEmpty { return (title, markerCount) }
            }
            guard isLikelyHeading(line) else { return nil }
            return (line, headingLevel(line))
        }
    }

    private static func htmlHeadings(_ source: String) -> [(String, Int)] {
        guard let regex = try? NSRegularExpression(
            pattern: #"<h([1-6])\b[^>]*>(.*?)</h\1>"#,
            options: [.caseInsensitive, .dotMatchesLineSeparators]
        ) else { return [] }
        let value = source as NSString
        return regex.matches(in: source, range: NSRange(location: 0, length: value.length)).compactMap { match in
            guard match.numberOfRanges == 3,
                  let level = Int(value.substring(with: match.range(at: 1))) else { return nil }
            let fragment = value.substring(with: match.range(at: 2))
            let wrapped = "<html><body>\(fragment)</body></html>"
            guard let data = wrapped.data(using: .utf8),
                  let attributed = try? NSAttributedString(
                    data: data,
                    options: [.documentType: NSAttributedString.DocumentType.html,
                              .characterEncoding: String.Encoding.utf8.rawValue],
                    documentAttributes: nil
                  ) else { return nil }
            let title = attributed.string.trimmingCharacters(in: .whitespacesAndNewlines)
            return title.isEmpty ? nil : (title, level)
        }
    }

    private static func entries(for headings: [(String, Int)], in renderedText: String) -> [DocumentOutlineEntry] {
        let rendered = renderedText as NSString
        var searchStart = 0
        return headings.enumerated().compactMap { index, heading in
            let remaining = NSRange(location: min(searchStart, rendered.length),
                                    length: max(0, rendered.length - searchStart))
            var range = rendered.range(of: heading.0, options: [.caseInsensitive], range: remaining)
            if range.location == NSNotFound {
                range = rendered.range(of: heading.0, options: [.caseInsensitive])
            }
            guard range.location != NSNotFound else { return nil }
            searchStart = NSMaxRange(range)
            return DocumentOutlineEntry(id: "text-heading-\(index)-\(range.location)", title: heading.0,
                                        level: heading.1, target: .text(location: range.location))
        }
    }

    private static func isLikelyHeading(_ line: String) -> Bool {
        guard (2...120).contains(line.count) else { return false }
        if line.range(of: #"^\d+(?:\.\d+)*\.?\s+\S+"#, options: .regularExpression) != nil { return true }
        let normalized = line.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ":："))
        return ["abstract", "introduction", "conclusion", "conclusions", "references",
                "摘要", "引言", "结论", "参考文献"].contains(normalized)
            || line.range(of: #"^第[\p{Han}0-9]+章\s*\S*"#, options: .regularExpression) != nil
    }

    private static func headingLevel(_ title: String) -> Int {
        guard let range = title.range(of: #"^\d+(?:\.\d+)*"#, options: .regularExpression) else { return 1 }
        return min(6, title[range].filter { $0 == "." }.count + 1)
    }
}

import Foundation
import PDFKit

enum PDFKnowledgeAnnotationRenderer {
    static func render(_ annotations: [KnowledgeAnnotation], in document: PDFDocument,
                       interactive: Bool) {
        if interactive {
            for index in 0..<document.pageCount {
                guard let page = document.page(at: index) else { continue }
                for annotation in page.annotations
                where KnowledgeAnnotationReference.id(fromPDFContents: annotation.contents) != nil {
                    page.removeAnnotation(annotation)
                }
            }
        }

        for item in annotations {
            let rects = resolvedRects(for: item, in: document)
            for rect in rects {
                guard let page = document.page(at: rect.page - 1) else { continue }
                let subtype: PDFAnnotationSubtype = item.kind == "underline" ? .underline : .highlight
                let annotation = PDFAnnotation(bounds: rect.cgRect, forType: subtype, withProperties: nil)
                configure(annotation, for: item, interactive: interactive)
                annotation.color = item.kind == "note"
                    ? NSColor.systemGreen.withAlphaComponent(0.35)
                    : NSColor.systemYellow.withAlphaComponent(0.45)
                page.addAnnotation(annotation)
            }

            guard !interactive, !item.note.isEmpty, let anchor = rects.last,
                  let page = document.page(at: anchor.page - 1) else { continue }
            let pageBounds = page.bounds(for: .mediaBox)
            let size: CGFloat = 20
            let preferredX = anchor.cgRect.maxX + 5
            let x = min(max(pageBounds.minX + 2, preferredX), pageBounds.maxX - size - 2)
            let y = min(max(pageBounds.minY + 2, anchor.cgRect.midY - size / 2), pageBounds.maxY - size - 2)
            let bubble = PDFAnnotation(bounds: CGRect(x: x, y: y, width: size, height: size),
                                       forType: .text, withProperties: nil)
            configure(bubble, for: item, interactive: interactive)
            bubble.color = NSColor.systemGreen
            bubble.iconType = .comment
            page.addAnnotation(bubble)
        }
    }

    static func resolvedRects(for item: KnowledgeAnnotation, in document: PDFDocument) -> [AnnotationRect] {
        if !item.rects.isEmpty { return item.rects }
        guard let match = document.findString(item.quote, withOptions: [.caseInsensitive]).first,
              let page = match.pages.first else { return [] }
        let pageIndex = document.index(for: page) + 1
        guard item.page == nil || item.page == pageIndex else { return [] }
        let bounds = match.bounds(for: page)
        return [AnnotationRect(page: pageIndex, x: bounds.origin.x, y: bounds.origin.y,
                               width: bounds.width, height: bounds.height)]
    }

    private static func configure(_ annotation: PDFAnnotation, for item: KnowledgeAnnotation,
                                  interactive: Bool) {
        annotation.contents = interactive
            ? KnowledgeAnnotationReference.pdfContents(for: item.id)
            : (item.note.isEmpty ? item.quote : item.note)
        if !interactive {
            annotation.userName = "知屿"
            annotation.modificationDate = item.updatedAt
        }
    }
}

enum DocumentExporter {
    static func exportOriginal(from source: URL, to destination: URL,
                               manager: FileManager = .default) throws {
        if source.standardizedFileURL == destination.standardizedFileURL { return }
        if manager.fileExists(atPath: destination.path) { try manager.removeItem(at: destination) }
        try manager.copyItem(at: source, to: destination)
    }

    static func exportAnnotated(document: KnowledgeDocument, source: URL,
                                annotations: [KnowledgeAnnotation], to destination: URL) throws {
        if document.extensionName == ".pdf" {
            guard let pdf = PDFDocument(url: source) else { throw ExportError.invalidPDF }
            PDFKnowledgeAnnotationRenderer.render(annotations, in: pdf, interactive: false)
            guard pdf.write(to: destination) else { throw ExportError.writeFailed }
            return
        }

        let sourceText = try String(contentsOf: source, encoding: .utf8)
        let output: String
        if [".html", ".htm"].contains(document.extensionName) {
            output = annotatedHTML(sourceHTML: sourceText, title: document.displayTitle, annotations: annotations)
        } else {
            output = annotatedMarkdown(sourceText: sourceText, title: document.displayTitle, annotations: annotations)
        }
        try output.write(to: destination, atomically: true, encoding: .utf8)
    }

    static func annotatedFilename(for document: KnowledgeDocument) -> String {
        let source = URL(fileURLWithPath: document.name)
        let stem = source.deletingPathExtension().lastPathComponent
        let ext = document.extensionName == ".pdf" ? "pdf"
            : ([".html", ".htm"].contains(document.extensionName) ? "html" : "md")
        return "\(stem)-带批注.\(ext)"
    }

    static func annotatedMarkdown(sourceText: String, title: String,
                                  annotations: [KnowledgeAnnotation]) -> String {
        sourceText + annotationAppendix(title: title, annotations: annotations)
    }

    static func annotatedHTML(sourceHTML: String, title: String,
                              annotations: [KnowledgeAnnotation]) -> String {
        let rows = annotations.enumerated().map { index, item in
            let page = item.page.map { " · 第 \($0) 页" } ?? ""
            let note = item.note.isEmpty ? "" : "<p><strong>笔记：</strong>\(escapeHTML(item.note))</p>"
            return "<article><h3>\(index + 1). \(kindName(item.kind))\(page)</h3>" +
                "<blockquote>\(escapeHTML(item.quote))</blockquote>\(note)</article>"
        }.joined(separator: "\n")
        let appendix = """
        <section id="knowledgemaster-annotations" style="margin:3rem auto;padding:1.5rem;max-width:900px;border-top:2px solid #58a66a;font:16px/1.6 -apple-system,BlinkMacSystemFont,sans-serif">
        <h2>知屿批注 · \(escapeHTML(title))</h2>\(rows)</section>
        """
        if let range = sourceHTML.range(of: "</body>", options: .caseInsensitive) {
            var value = sourceHTML
            value.insert(contentsOf: appendix, at: range.lowerBound)
            return value
        }
        return sourceHTML + appendix
    }

    private static func annotationAppendix(title: String, annotations: [KnowledgeAnnotation]) -> String {
        let items = annotations.enumerated().map { index, item in
            let page = item.page.map { " · 第 \($0) 页" } ?? ""
            let quote = item.quote.split(separator: "\n", omittingEmptySubsequences: false)
                .map { "> \($0)" }.joined(separator: "\n")
            let note = item.note.isEmpty ? "" : "\n\n**笔记：** \(item.note)"
            return "### \(index + 1). \(kindName(item.kind))\(page)\n\n\(quote)\(note)"
        }.joined(separator: "\n\n")
        return "\n\n---\n\n## 知屿批注 · \(title)\n\n\(items)\n"
    }

    private static func kindName(_ kind: String) -> String {
        switch kind {
        case "underline": "划线"
        case "note": "笔记"
        default: "高亮"
        }
    }

    private static func escapeHTML(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}

enum ExportError: LocalizedError {
    case invalidPDF
    case writeFailed

    var errorDescription: String? {
        switch self {
        case .invalidPDF: "无法读取 PDF 文档"
        case .writeFailed: "无法写入导出文件"
        }
    }
}

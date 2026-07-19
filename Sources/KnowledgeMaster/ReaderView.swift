import SwiftUI
import AppKit

enum SelectionToolbarLayout {
    static let width: CGFloat = 410

    static func position(anchorX: Double?, anchorY: Double?, in size: CGSize) -> CGPoint {
        let sourceX = CGFloat(anchorX ?? Double(size.width / 2))
        let sourceY = CGFloat(anchorY ?? 50)
        let x = min(max(width / 2 + 8, sourceX - width / 2 + 12),
                    max(width / 2 + 8, size.width - width / 2 - 8))
        let y = min(max(25, sourceY - 28), max(25, size.height - 25))
        return CGPoint(x: x, y: y)
    }
}

struct ReaderView: View {
    @EnvironmentObject private var store: KnowledgeStore
    var document: KnowledgeDocument?
    var onAsk: (ReaderQuote, String) -> Void

    @State private var selection: ReaderSelection?
    @State private var noteText = ""
    @State private var noteSelection: ReaderSelection?
    @State private var editingAnnotation: KnowledgeAnnotation?
    @State private var showNoteEditor = false
    @State private var showAnnotations = false

    var body: some View {
        VStack(spacing: 0) {
            if let document {
                header(document)
                Divider()
                reader(document)
                    .overlay {
                        GeometryReader { geometry in
                            selectionBar(document, in: geometry.size)
                        }
                    }
            } else {
                ContentUnavailableView("选择一份资料", systemImage: "doc.text.magnifyingglass",
                                       description: Text("导入或从左侧打开 PDF、HTML、Markdown 和文本文件。"))
            }
        }
        .sheet(isPresented: $showNoteEditor) { noteEditor }
        .sheet(isPresented: $showAnnotations) { annotationList }
    }

    private func header(_ document: KnowledgeDocument) -> some View {
        HStack {
            Image(systemName: icon(for: document.extensionName))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(document.name).font(.headline).lineLimit(1)
                Text(metadata(document)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("批注 \(store.annotations(for: document.id).count)") { showAnnotations = true }
        }
        .padding(.horizontal, 14).frame(height: 58)
    }

    @ViewBuilder private func reader(_ document: KnowledgeDocument) -> some View {
        let annotations = store.annotations(for: document.id)
        if document.extensionName == ".pdf" {
            PDFReaderView(url: store.storedURL(for: document), annotations: annotations,
                          onSelection: { selection = $0 }, onAnnotationClick: openAnnotation)
        } else {
            RichTextReaderView(content: attributedContent(document), annotations: annotations,
                               onSelection: { selection = $0 }, onAnnotationClick: openAnnotation)
                .background(Color(nsColor: .textBackgroundColor))
        }
    }

    @ViewBuilder private func selectionBar(_ document: KnowledgeDocument, in size: CGSize) -> some View {
        if let selection {
            let position = SelectionToolbarLayout.position(anchorX: selection.anchorX, anchorY: selection.anchorY, in: size)
            HStack(spacing: 4) {
                Button("Ask AI", systemImage: "sparkles") { ask(document, selection, prompt: "请结合上下文回答我关于这段内容的问题：") }
                Button("引用", systemImage: "quote.opening") { ask(document, selection, prompt: "") }
                Divider().frame(height: 18)
                Button("高亮") { addAnnotation(document, selection, kind: "highlight") }
                Button("划线") { addAnnotation(document, selection, kind: "underline") }
                Button("笔记", systemImage: "note.text.badge.plus") {
                    noteText = ""; noteSelection = selection; editingAnnotation = nil; showNoteEditor = true
                }
            }
            .buttonStyle(.borderless)
            .padding(8)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 9))
            .shadow(radius: 8, y: 3)
            .fixedSize()
            .position(position)
        }
    }

    private var noteEditor: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(editingAnnotation == nil ? "添加笔记" : "编辑笔记").font(.title2.bold())
            Text(editingAnnotation?.quote ?? noteSelection?.text ?? "")
                .font(.callout).foregroundStyle(.secondary).padding(10)
                .frame(maxWidth: .infinity, alignment: .leading).background(.quaternary, in: RoundedRectangle(cornerRadius: 7))
            TextEditor(text: $noteText).font(.body).frame(minHeight: 150).border(.separator)
            HStack {
                Spacer()
                Button("取消") { showNoteEditor = false }
                Button("保存") { saveNote() }.buttonStyle(.borderedProminent).disabled(noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(22).frame(width: 520)
    }

    private var annotationList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("文档批注").font(.title2.bold())
            if let document, store.annotations(for: document.id).isEmpty {
                ContentUnavailableView("还没有批注", systemImage: "highlighter")
            } else if let document {
                List(store.annotations(for: document.id)) { annotation in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack { Text(kindName(annotation.kind)).font(.caption.bold()); if let page = annotation.page { Text("第 \(page) 页").font(.caption).foregroundStyle(.secondary) } }
                        Text(annotation.quote).lineLimit(3)
                        if !annotation.note.isEmpty { Text(annotation.note).font(.callout).foregroundStyle(.secondary) }
                        HStack {
                            Button(annotation.note.isEmpty ? "添加笔记" : "编辑笔记") {
                                editingAnnotation = annotation; noteSelection = nil; noteText = annotation.note; showNoteEditor = true
                            }
                            Button("删除", role: .destructive) { store.deleteAnnotation(annotation.id) }
                        }.buttonStyle(.borderless)
                    }.padding(.vertical, 5)
                }
            }
            HStack { Spacer(); Button("完成") { showAnnotations = false }.keyboardShortcut(.defaultAction) }
        }.padding(20).frame(width: 620, height: 500)
    }

    private func addAnnotation(_ document: KnowledgeDocument, _ selection: ReaderSelection, kind: String) {
        _ = store.addAnnotation(documentID: document.id, selection: selection, kind: kind)
        self.selection = nil
    }

    private func openAnnotation(_ id: UUID) {
        guard let annotation = store.data.annotations.first(where: { $0.id == id }) else { return }
        editingAnnotation = annotation
        noteSelection = nil
        noteText = annotation.note
        selection = nil
        showNoteEditor = true
    }

    private func saveNote() {
        let value = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        if let editingAnnotation { store.updateAnnotation(editingAnnotation.id, note: value) }
        else if let document, let noteSelection { _ = store.addAnnotation(documentID: document.id, selection: noteSelection, kind: "note", note: value) }
        showNoteEditor = false
        selection = nil
    }

    private func ask(_ document: KnowledgeDocument, _ selection: ReaderSelection, prompt: String) {
        onAsk(ReaderQuote(text: selection.text, documentId: document.id, documentName: document.name, page: selection.page), prompt)
        self.selection = nil
    }

    private func attributedContent(_ document: KnowledgeDocument) -> NSAttributedString {
        let extracted = store.extractedContent(for: document.id)
        let base: NSAttributedString
        if [".md", ".markdown"].contains(document.extensionName),
           let markdown = try? AttributedString(markdown: extracted.text, options: .init(interpretedSyntax: .full)) {
            base = NSAttributedString(markdown)
        } else if [".html", ".htm"].contains(document.extensionName),
                  let data = try? Data(contentsOf: store.storedURL(for: document)),
                  let html = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.html], documentAttributes: nil) {
            base = html
        } else {
            base = NSAttributedString(string: extracted.text)
        }
        let value = NSMutableAttributedString(attributedString: base)
        let fullRange = NSRange(location: 0, length: value.length)
        value.enumerateAttribute(.font, in: fullRange) { font, range, _ in
            if font == nil { value.addAttribute(.font, value: NSFont.systemFont(ofSize: 16), range: range) }
        }
        value.enumerateAttribute(.foregroundColor, in: fullRange) { color, range, _ in
            if color == nil { value.addAttribute(.foregroundColor, value: NSColor.labelColor, range: range) }
        }
        return value
    }

    private func metadata(_ document: KnowledgeDocument) -> String {
        let size = ByteCountFormatter.string(fromByteCount: document.size, countStyle: .file)
        return size + (document.pageCount.map { " · \($0) 页" } ?? "")
    }
    private func icon(for ext: String) -> String { ext == ".pdf" ? "doc.richtext" : ext.contains("md") ? "text.document" : "doc.text" }
    private func kindName(_ kind: String) -> String { kind == "highlight" ? "高亮" : kind == "underline" ? "划线" : "笔记" }
}

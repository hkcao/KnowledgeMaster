import SwiftUI
import AppKit
import UniformTypeIdentifiers

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
    var focusedAnnotationID: UUID?
    var layoutRevision: UUID
    var onAsk: (ReaderQuote) -> Void

    @State private var selection: ReaderSelection?
    @State private var noteText = ""
    @State private var noteSelection: ReaderSelection?
    @State private var editingAnnotation: KnowledgeAnnotation?
    @State private var showNewNoteEditor = false
    @State private var showAnnotations = false
    @State private var exportError: String?
    @State private var showOutline = false
    @State private var outlineEntries: [DocumentOutlineEntry] = []
    @State private var navigationRequest: DocumentNavigationRequest?
    @State private var currentPDFPageIndex: Int?

    var body: some View {
        VStack(spacing: 0) {
            if let document {
                header(document)
                Divider()
                readerArea(document)
                    .task(id: document.id) { loadOutline(document) }
            } else {
                ContentUnavailableView("选择一份资料", systemImage: "doc.text.magnifyingglass",
                                       description: Text("导入或从左侧打开 PDF、Word、HTML、Markdown 和文本文件。"))
            }
        }
        .sheet(item: $editingAnnotation) { annotation in noteEditor(annotation) }
        .sheet(isPresented: $showNewNoteEditor) { noteEditor(nil) }
        .sheet(isPresented: $showAnnotations) { annotationList }
        .alert("导出失败", isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })) {
            Button("好") { exportError = nil }
        } message: { Text(exportError ?? "") }
        .onChange(of: focusedAnnotationID) { _, id in
            if let id { openAnnotation(id) }
        }
        .onChange(of: layoutRevision) { _, _ in restorePDFPageAfterLayoutChange() }
    }

    private func header(_ document: KnowledgeDocument) -> some View {
        HStack {
            Image(systemName: icon(for: document.extensionName))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(document.displayTitle).font(.headline).lineLimit(1)
                Text(metadata(document)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                showOutline.toggle()
            } label: {
                Label("目录", systemImage: "list.bullet.indent")
            }
            .buttonStyle(.borderless)
            .help(showOutline ? "收起文档目录" : "展开文档目录")
            Menu {
                Button("导出原文档…", systemImage: "doc.badge.arrow.up") { exportOriginal(document) }
                Button("导出带批注版本…", systemImage: "highlighter") { exportAnnotated(document) }
                    .disabled(store.annotations(for: document.id).isEmpty)
            } label: {
                Label("导出", systemImage: "square.and.arrow.up")
            }.menuStyle(.borderlessButton)
            Button("批注 \(store.annotations(for: document.id).count)") { showAnnotations = true }
        }
        .padding(.horizontal, 14).frame(height: 58)
    }

    @ViewBuilder private func readerArea(_ document: KnowledgeDocument) -> some View {
        if showOutline {
            HSplitView {
                outlinePane
                    .frame(minWidth: 180, idealWidth: 230, maxWidth: 320)
                documentReader(document)
                    .frame(minWidth: 360)
            }
        } else {
            documentReader(document)
        }
    }

    private func documentReader(_ document: KnowledgeDocument) -> some View {
        reader(document)
            .overlay {
                GeometryReader { geometry in
                    selectionBar(document, in: geometry.size)
                }
            }
    }

    private var outlinePane: some View {
        VStack(spacing: 0) {
            HStack {
                Text("文档目录").font(.headline)
                Spacer()
                Button { showOutline = false } label: { Image(systemName: "xmark") }
                    .buttonStyle(.plain)
                    .help("收起目录")
            }
            .padding(.horizontal, 12).frame(height: 42)
            Divider()
            if outlineEntries.isEmpty {
                ContentUnavailableView("未识别到目录", systemImage: "list.bullet.indent",
                                       description: Text("该文档没有可用的标题结构。"))
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 1) {
                        ForEach(outlineEntries) { entry in
                            Button {
                                navigationRequest = DocumentNavigationRequest(target: entry.target)
                            } label: {
                                Text(entry.title)
                                    .font(entry.level == 1 ? .callout.weight(.semibold) : .callout)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.leading, CGFloat(max(0, entry.level - 1)) * 12)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 7)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 6)
                }
            }
        }
        .background(Color(nsColor: .controlBackgroundColor))
    }

    @ViewBuilder private func reader(_ document: KnowledgeDocument) -> some View {
        let annotations = store.annotations(for: document.id)
        if document.extensionName == ".pdf" {
            PDFReaderView(url: store.storedURL(for: document), annotations: annotations,
                          focusedAnnotationID: focusedAnnotationID, navigationRequest: navigationRequest,
                          bookmarkPageIndex: store.bookmarkPage(for: document.id),
                          onSelection: { selection = $0 }, onPageChange: { currentPDFPageIndex = $0 },
                          onBookmarkToggle: { store.toggleBookmark(documentID: document.id, pageIndex: $0) },
                          onAnnotationClick: openAnnotation)
        } else {
            RichTextReaderView(content: attributedContent(document), annotations: annotations,
                               focusedAnnotationID: focusedAnnotationID, navigationRequest: navigationRequest,
                               onSelection: { selection = $0 }, onAnnotationClick: openAnnotation)
                .background(Color(nsColor: .textBackgroundColor))
        }
    }

    @ViewBuilder private func selectionBar(_ document: KnowledgeDocument, in size: CGSize) -> some View {
        if let selection {
            let position = SelectionToolbarLayout.position(anchorX: selection.anchorX, anchorY: selection.anchorY, in: size)
            HStack(spacing: 4) {
                Button("Ask AI", systemImage: "sparkles") { ask(document, selection) }
                Button("引用", systemImage: "quote.opening") { ask(document, selection) }
                Divider().frame(height: 18)
                Button("高亮") { addAnnotation(document, selection, kind: "highlight") }
                Button("划线") { addAnnotation(document, selection, kind: "underline") }
                Button("笔记", systemImage: "note.text.badge.plus") {
                    noteText = ""; noteSelection = selection; editingAnnotation = nil; showNewNoteEditor = true
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

    private func noteEditor(_ annotation: KnowledgeAnnotation?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(annotation == nil ? "添加笔记" : "编辑笔记").font(.title2.bold())
            Text(annotation?.quote ?? noteSelection?.text ?? "")
                .font(.callout).foregroundStyle(.secondary).padding(10)
                .frame(maxWidth: .infinity, alignment: .leading).background(.quaternary, in: RoundedRectangle(cornerRadius: 7))
            TextEditor(text: $noteText).font(.body).frame(minHeight: 150).border(.separator)
            HStack {
                Spacer()
                Button("取消") { closeNoteEditor(annotation) }
                Button("保存") { saveNote(annotation) }.buttonStyle(.borderedProminent).disabled(noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
                                showAnnotations = false
                                noteSelection = nil
                                noteText = annotation.note
                                DispatchQueue.main.async { editingAnnotation = annotation }
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
        editingAnnotation = annotation
    }

    private func closeNoteEditor(_ annotation: KnowledgeAnnotation?) {
        if annotation == nil { showNewNoteEditor = false }
        else { editingAnnotation = nil }
    }

    private func saveNote(_ annotation: KnowledgeAnnotation?) {
        let value = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        if let annotation { store.updateAnnotation(annotation.id, note: value) }
        else if let document, let noteSelection { _ = store.addAnnotation(documentID: document.id, selection: noteSelection, kind: "note", note: value) }
        closeNoteEditor(annotation)
        selection = nil
    }

    private func ask(_ document: KnowledgeDocument, _ selection: ReaderSelection) {
        let imagePNG = document.extensionName == ".pdf"
            ? PDFSelectionSnapshot.render(url: store.storedURL(for: document), selection: selection)
            : nil
        onAsk(ReaderQuote(text: selection.text, documentId: document.id, documentName: document.displayTitle,
                          page: selection.page, imagePNG: imagePNG))
        self.selection = nil
    }

    private func loadOutline(_ document: KnowledgeDocument) {
        selection = nil
        navigationRequest = nil
        currentPDFPageIndex = nil
        let extracted = store.extractedContent(for: document.id)
        let rendered = attributedContent(document).string
        outlineEntries = DocumentOutlineBuilder.entries(document: document,
                                                        sourceURL: store.storedURL(for: document),
                                                        extracted: extracted,
                                                        renderedText: rendered)
    }

    private func restorePDFPageAfterLayoutChange() {
        guard document?.extensionName == ".pdf", let pageIndex = currentPDFPageIndex else { return }
        DispatchQueue.main.async {
            navigationRequest = DocumentNavigationRequest(target: .pdf(pageIndex: pageIndex, point: nil))
        }
    }

    private func exportOriginal(_ document: KnowledgeDocument) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = document.name
        panel.allowedContentTypes = [UTType(filenameExtension: document.extensionName.trimmingCharacters(in: CharacterSet(charactersIn: "."))) ?? .data]
        guard panel.runModal() == .OK, let destination = panel.url else { return }
        do { try DocumentExporter.exportOriginal(from: store.storedURL(for: document), to: destination) }
        catch { exportError = error.localizedDescription }
    }

    private func exportAnnotated(_ document: KnowledgeDocument) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = DocumentExporter.annotatedFilename(for: document)
        let ext = URL(fileURLWithPath: panel.nameFieldStringValue).pathExtension
        panel.allowedContentTypes = [UTType(filenameExtension: ext) ?? .data]
        guard panel.runModal() == .OK, let destination = panel.url else { return }
        do {
            try DocumentExporter.exportAnnotated(document: document, source: store.storedURL(for: document),
                                                 annotations: store.annotations(for: document.id), to: destination)
        } catch { exportError = error.localizedDescription }
    }

    private func attributedContent(_ document: KnowledgeDocument) -> NSAttributedString {
        let extracted = store.extractedContent(for: document.id)
        let base: NSAttributedString
        if [".md", ".markdown"].contains(document.extensionName),
           let markdown = try? AttributedString(markdown: extracted.text, options: .init(interpretedSyntax: .full)) {
            base = NSAttributedString(markdown)
        } else if [".html", ".htm"].contains(document.extensionName),
                  let html = try? htmlContent(document) {
            base = html
        } else if [".doc", ".docx"].contains(document.extensionName),
                  let word = try? DocumentExtractor.attributedWordDocument(at: store.storedURL(for: document)) {
            base = word
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

    private func htmlContent(_ document: KnowledgeDocument) throws -> NSAttributedString {
        let data = try Data(contentsOf: store.storedURL(for: document))
        return try DocumentExtractor.attributedHTML(
            from: data,
            baseURL: document.sourceURL.flatMap(URL.init(string:))
        )
    }

    private func metadata(_ document: KnowledgeDocument) -> String {
        let size = ByteCountFormatter.string(fromByteCount: document.size, countStyle: .file)
        return size + (document.pageCount.map { " · \($0) 页" } ?? "")
    }
    private func icon(for ext: String) -> String { ext == ".pdf" ? "doc.richtext" : ext.contains("md") ? "text.document" : "doc.text" }
    private func kindName(_ kind: String) -> String { kind == "highlight" ? "高亮" : kind == "underline" ? "划线" : "笔记" }
}

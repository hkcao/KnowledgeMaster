import XCTest
import PDFKit
import AppKit
@testable import KnowledgeMaster

@MainActor
final class KnowledgeStoreTests: XCTestCase {
    func testChunkingAndKeywordScore() {
        let chunks = KnowledgeStore.chunks(String(repeating: "A", count: 3_200), size: 1_000, overlap: 100)
        XCTAssertEqual(chunks.count, 4)
        XCTAssertGreaterThan(KnowledgeStore.score("数据库", in: "数据库性能分析", title: "设计"), 0)
    }

    func testImportDuplicateAnnotationAndContext() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let input = root.appendingPathComponent("input")
        try FileManager.default.createDirectory(at: input, withIntermediateDirectories: true)
        let file = input.appendingPathComponent("note.txt")
        try "RAG 知识库与检索增强。".write(to: file, atomically: true, encoding: .utf8)
        let store = KnowledgeStore(rootURL: root.appendingPathComponent("library"))
        XCTAssertEqual(store.importFiles([file]).filter { $0.hasPrefix("已导入") }.count, 1)
        XCTAssertTrue(store.importFiles([file]).first?.hasPrefix("同名丢弃") == true)
        let document = try XCTUnwrap(store.data.documents.first)
        XCTAssertEqual(store.storedURL(for: document).deletingLastPathComponent().standardizedFileURL,
                       store.documentsURL.standardizedFileURL)
        XCTAssertTrue(store.storedURL(for: document).lastPathComponent.hasPrefix(document.id.uuidString + "--"))
        let annotation = store.addAnnotation(documentID: document.id,
                                             selection: ReaderSelection(text: "知识库", page: nil), kind: "note", note: "重点")
        XCTAssertEqual(store.annotations(for: document.id).first?.id, annotation.id)
        XCTAssertEqual(store.annotationContext(query: "重点", documentIDs: [document.id], topicIDs: []).count, 1)
    }

    func testDeletingAFlatDocumentDoesNotDeleteItsSiblings() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let input = root.appendingPathComponent("input")
        try FileManager.default.createDirectory(at: input, withIntermediateDirectories: true)
        let first = input.appendingPathComponent("first.txt")
        let second = input.appendingPathComponent("second.txt")
        try "first".write(to: first, atomically: true, encoding: .utf8)
        try "second".write(to: second, atomically: true, encoding: .utf8)
        let store = KnowledgeStore(rootURL: root.appendingPathComponent("library"))
        _ = store.importFiles([first, second])
        let documents = store.data.documents
        XCTAssertEqual(documents.count, 2)

        store.deleteDocument(documents[0].id)

        XCTAssertFalse(FileManager.default.fileExists(atPath: store.storedURL(for: documents[0]).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.storedURL(for: documents[1]).path))
    }

    func testPaperVirtualNameUsesFirstAuthorAndTitle() {
        XCTAssertEqual(DocumentExtractor.paperDisplayName(
            title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
            authors: "Patrick Lewis, Ethan Perez, Aleksandra Piktus"
        ), "Lewis et al., Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks")
    }

    func testPaperVirtualNameUsesPDFMetadataWithoutReadingFirstPageText() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("pdf")
        let pdf = PDFDocument()
        let image = NSImage(size: NSSize(width: 20, height: 20))
        image.lockFocus()
        NSColor.white.setFill()
        NSRect(x: 0, y: 0, width: 20, height: 20).fill()
        image.unlockFocus()
        let page = try XCTUnwrap(PDFPage(image: image))
        pdf.insert(page, at: 0)
        pdf.documentAttributes = [
            PDFDocumentAttribute.titleAttribute: "A Metadata-Only Paper Title",
            PDFDocumentAttribute.authorAttribute: "Ada Lovelace and Alan Turing"
        ]
        XCTAssertTrue(pdf.write(to: url))

        XCTAssertEqual(
            DocumentExtractor.paperDisplayName(at: url),
            "Lovelace et al., A Metadata-Only Paper Title"
        )
    }

    func testSummaryNotesCanLinkAnnotationsAndCleanDeletedLinks() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = KnowledgeStore(rootURL: root)
        let documentID = UUID()
        let annotation = store.addAnnotation(documentID: documentID,
                                             selection: ReaderSelection(text: "关键结论", page: 2), kind: "note", note: "用于总结")
        let summary = try XCTUnwrap(store.createSummaryNote(title: "整体思考", content: "综合结论",
                                                            annotationIDs: [annotation.id]))
        XCTAssertEqual(store.data.summaryNotes.first?.annotationIDs, [annotation.id])
        let markdownURL = try XCTUnwrap(store.summaryNoteURL(for: summary))
        XCTAssertTrue(FileManager.default.fileExists(atPath: markdownURL.path))
        XCTAssertTrue(try String(contentsOf: markdownURL, encoding: .utf8).hasPrefix("# 整体思考\n\n综合结论"))

        store.updateSummaryNote(summary.id, title: "整体思考 2", content: "公式：$$x^2$$",
                                annotationIDs: [annotation.id])
        XCTAssertTrue(try String(contentsOf: markdownURL, encoding: .utf8).contains("$$x^2$$"))

        store.deleteAnnotation(annotation.id)

        XCTAssertTrue(store.data.summaryNotes.first(where: { $0.id == summary.id })?.annotationIDs.isEmpty == true)
    }

    func testLegacySummaryNoteMigratesToARealMarkdownFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let id = UUID()
        let json = """
        {"version":3,"documents":[],"topics":[],"documentTopics":[],"annotations":[],"conversations":[],"topicSummaries":[],"summaryNotes":[{"id":"\(id.uuidString)","title":"旧笔记","content":"旧正文 $x^2$","annotationIDs":[],"createdAt":"2026-07-20T00:00:00Z","updatedAt":"2026-07-20T00:00:00Z"}]}
        """
        try json.write(to: root.appendingPathComponent("knowledge.json"), atomically: true, encoding: .utf8)

        let store = KnowledgeStore(rootURL: root)
        let note = try XCTUnwrap(store.data.summaryNotes.first)
        let url = try XCTUnwrap(store.summaryNoteURL(for: note))

        XCTAssertEqual(note.storedPath, "source/notes/\(id.uuidString).md")
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        XCTAssertEqual(store.summaryNoteContent(for: note), "旧正文 $x^2$")
    }

    func testDocumentExporterPreservesOriginalAndWritesPortableAnnotations() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("source.pdf")
        let annotated = root.appendingPathComponent("annotated.pdf")
        let originalCopy = root.appendingPathComponent("original.pdf")
        var mediaBox = CGRect(x: 0, y: 0, width: 300, height: 400)
        let consumer = try XCTUnwrap(CGDataConsumer(url: source as CFURL))
        let context = try XCTUnwrap(CGContext(consumer: consumer, mediaBox: &mediaBox, nil))
        context.beginPDFPage(nil)
        context.setFillColor(NSColor.white.cgColor)
        context.fill(mediaBox)
        context.endPDFPage()
        context.closePDF()
        let originalData = try Data(contentsOf: source)
        let item = KnowledgeAnnotation(documentId: UUID(), page: 1, quote: "选区", kind: "note",
                                       note: "这是批注", rects: [AnnotationRect(page: 1, x: 40, y: 100,
                                                                                 width: 80, height: 18)])
        let document = KnowledgeDocument(name: "source.pdf", extensionName: ".pdf", size: Int64(originalData.count),
                                         sha256: "hash", storedPath: nil)

        try DocumentExporter.exportOriginal(from: source, to: originalCopy)
        try DocumentExporter.exportAnnotated(document: document, source: source, annotations: [item], to: annotated)

        XCTAssertEqual(try Data(contentsOf: originalCopy), originalData)
        XCTAssertEqual(try Data(contentsOf: source), originalData)
        let output = try XCTUnwrap(PDFDocument(url: annotated))
        let annotations = try XCTUnwrap(output.page(at: 0)).annotations
        let exportedAnnotations = annotations.filter { $0.userName == "知屿" }
        XCTAssertEqual(exportedAnnotations.count, 2)
        XCTAssertTrue(exportedAnnotations.contains { $0.contents == "这是批注" && $0.bounds.minX >= 120 })
    }

    func testTextAnnotatedExportIncludesQuoteAndNote() {
        let markdown = DocumentExporter.annotatedMarkdown(
            sourceText: "# 原文", title: "资料",
            annotations: [KnowledgeAnnotation(documentId: UUID(), page: nil, quote: "关键原文",
                                              kind: "highlight", note: "我的判断")]
        )
        XCTAssertTrue(markdown.contains("# 原文"))
        XCTAssertTrue(markdown.contains("> 关键原文"))
        XCTAssertTrue(markdown.contains("**笔记：** 我的判断"))
    }

    func testInteractivePDFUsesHighlightOnlyAndLeavesBubbleToTheClickableOverlay() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("source.pdf")
        var mediaBox = CGRect(x: 0, y: 0, width: 300, height: 400)
        let consumer = try XCTUnwrap(CGDataConsumer(url: source as CFURL))
        let context = try XCTUnwrap(CGContext(consumer: consumer, mediaBox: &mediaBox, nil))
        context.beginPDFPage(nil)
        context.endPDFPage()
        context.closePDF()
        let pdf = try XCTUnwrap(PDFDocument(url: source))
        let item = KnowledgeAnnotation(documentId: UUID(), page: 1, quote: "选区", kind: "note",
                                       note: "这是批注", rects: [AnnotationRect(page: 1, x: 40, y: 100,
                                                                                 width: 80, height: 18)])

        PDFKnowledgeAnnotationRenderer.render([item], in: pdf, interactive: true)

        let appAnnotations = try XCTUnwrap(pdf.page(at: 0)).annotations.filter {
            KnowledgeAnnotationReference.id(fromPDFContents: $0.contents) == item.id
        }
        XCTAssertEqual(appAnnotations.count, 1)
        XCTAssertEqual(appAnnotations.first?.type, "Highlight")
    }

    func testNewConversationDefaultsToPureChatWithoutCurrentDocument() throws {
        XCTAssertFalse(Conversation().includeCurrentPage)
        let id = UUID()
        let oldJSON = """
        {"id":"\(id.uuidString)","title":"旧对话","messages":[],"summary":"","createdAt":0,"updatedAt":0}
        """
        let decoded = try JSONDecoder().decode(Conversation.self, from: Data(oldJSON.utf8))
        XCTAssertFalse(decoded.includeCurrentPage)
    }

    func testLegacyConversationSummaryIsAssumedToCoverExistingMessages() throws {
        let id = UUID()
        let messageID = UUID()
        let oldJSON = """
        {"id":"\(id.uuidString)","title":"旧对话","messages":[{"id":"\(messageID.uuidString)","role":"user","content":"旧问题","createdAt":0}],"summary":"已有摘要","createdAt":0,"updatedAt":0}
        """
        let decoded = try JSONDecoder().decode(Conversation.self, from: Data(oldJSON.utf8))

        XCTAssertEqual(decoded.summaryMessageCount, 1)
        XCTAssertTrue(decoded.agentSessions.isEmpty)
        XCTAssertTrue(ConversationSummaryPlanner.pendingMessages(in: decoded).isEmpty)
    }

    func testConversationSummaryUsesExistingSummaryAndNextThirtyUnprocessedMessages() {
        let messages = (0..<35).map { ChatMessage(role: "user", content: "消息\($0)") }
        let conversation = Conversation(
            messages: messages,
            summary: "旧摘要",
            summaryMessageCount: 2
        )

        let pending = ConversationSummaryPlanner.pendingMessages(in: conversation)
        let prompt = ConversationSummaryPlanner.prompt(existingSummary: conversation.summary, messages: pending)

        XCTAssertEqual(pending.count, 30)
        XCTAssertEqual(pending.first?.content, "消息2")
        XCTAssertEqual(pending.last?.content, "消息31")
        XCTAssertTrue(prompt.contains("旧摘要"))
        XCTAssertTrue(prompt.contains("消息2"))
        XCTAssertFalse(prompt.contains("消息32"))
    }

    func testMissingMetadataFieldsRemainCompatible() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try #"{"version":1,"documents":[],"topics":[],"documentTopics":[],"conversations":[],"topicSummaries":[]}"#
            .write(to: root.appendingPathComponent("knowledge.json"), atomically: true, encoding: .utf8)
        let store = KnowledgeStore(rootURL: root)
        XCTAssertTrue(store.data.annotations.isEmpty)
        XCTAssertTrue(store.data.bookmarks.isEmpty)
    }

    func testCrossDocumentContextKeepsEverySelectedDocument() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let input = root.appendingPathComponent("input")
        try FileManager.default.createDirectory(at: input, withIntermediateDirectories: true)
        let rag = input.appendingPathComponent("rag.txt")
        let storage = input.appendingPathComponent("storage.txt")
        try "RAG 使用检索增强生成组织知识。".write(to: rag, atomically: true, encoding: .utf8)
        try "对象存储使用纠删码保护数据。".write(to: storage, atomically: true, encoding: .utf8)
        let store = KnowledgeStore(rootURL: root.appendingPathComponent("library"))
        _ = store.importFiles([rag, storage])

        let chunks = store.context(query: "RAG", documentIDs: store.data.documents.map(\.id), topicIDs: [])
        XCTAssertEqual(Set(chunks.map(\.documentName)), Set(["rag.txt", "storage.txt"]))
    }

    func testDocumentCanBelongToMultipleTopicDirectories() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let input = root.appendingPathComponent("input")
        try FileManager.default.createDirectory(at: input, withIntermediateDirectories: true)
        let file = input.appendingPathComponent("shared.md")
        try "共享知识".write(to: file, atomically: true, encoding: .utf8)
        let store = KnowledgeStore(rootURL: root.appendingPathComponent("library"))
        _ = store.importFiles([file])
        let document = try XCTUnwrap(store.data.documents.first)
        store.createTopic("目录 A")
        store.createTopic("目录 B")
        let topics = store.data.topics
        XCTAssertEqual(topics.count, 2)

        store.link(documentID: document.id, topicID: topics[0].id)
        store.link(documentID: document.id, topicID: topics[1].id)
        XCTAssertEqual(store.documents(for: topics[0].id).map(\.id), [document.id])
        XCTAssertEqual(store.documents(for: topics[1].id).map(\.id), [document.id])
    }

    func testRenamingAndDeletingTopicKeepsOriginalDocumentAndAnnotation() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let input = root.appendingPathComponent("input")
        try FileManager.default.createDirectory(at: input, withIntermediateDirectories: true)
        let file = input.appendingPathComponent("protected.md")
        try "# 原始文档\n不应随虚拟目录删除。".write(to: file, atomically: true, encoding: .utf8)
        let store = KnowledgeStore(rootURL: root.appendingPathComponent("library"))
        _ = store.importFiles([file])
        let document = try XCTUnwrap(store.data.documents.first)
        let sourceURL = store.storedURL(for: document)
        let rootTopic = try XCTUnwrap(store.createTopic("旧名称"))
        let childTopic = try XCTUnwrap(store.createTopic("子主题", parentID: rootTopic.id))
        store.link(documentID: document.id, topicID: rootTopic.id)
        store.link(documentID: document.id, topicID: childTopic.id)
        let annotation = store.addAnnotation(documentID: document.id,
                                             selection: ReaderSelection(text: "原始文档", page: nil),
                                             kind: "note", note: "保留")

        store.renameTopic(rootTopic.id, name: "  新名称  ")
        XCTAssertEqual(store.data.topics.first(where: { $0.id == rootTopic.id })?.name, "新名称")

        store.deleteTopic(rootTopic.id)
        XCTAssertFalse(store.data.topics.contains(where: { $0.id == rootTopic.id || $0.id == childTopic.id }))
        XCTAssertFalse(store.data.documentTopics.contains(where: { $0.topicId == rootTopic.id || $0.topicId == childTopic.id }))
        XCTAssertTrue(store.data.documents.contains(where: { $0.id == document.id }))
        XCTAssertTrue(store.data.annotations.contains(where: { $0.id == annotation.id }))
        XCTAssertTrue(FileManager.default.fileExists(atPath: sourceURL.path))
    }

    func testMarkdownOutlineFindsHeadingHierarchyAndLocations() {
        let source = "# 第一章\n正文\n## 子节\n内容\n### 细节"
        let rendered = "第一章\n正文\n子节\n内容\n细节"
        let entries = DocumentOutlineBuilder.textEntries(source: source, extensionName: ".md",
                                                         renderedText: rendered)

        XCTAssertEqual(entries.map(\.title), ["第一章", "子节", "细节"])
        XCTAssertEqual(entries.map(\.level), [1, 2, 3])
        XCTAssertEqual(entries.map(\.target), [
            .text(location: 0), .text(location: 7), .text(location: 13)
        ])
    }

    func testHTMLOutlineFindsHeadingHierarchy() {
        let source = "<html><h1>总览</h1><p>内容</p><h2>方法 <em>A</em></h2></html>"
        let entries = DocumentOutlineBuilder.textEntries(source: source, extensionName: ".html",
                                                         renderedText: "总览\n内容\n方法 A")

        XCTAssertEqual(entries.map(\.title), ["总览", "方法 A"])
        XCTAssertEqual(entries.map(\.level), [1, 2])
    }

    func testChatOffersAllDockingPlacements() {
        XCTAssertEqual(Set(ChatPlacement.allCases), Set([.right, .bottom, .sidebar, .hidden]))
    }

    func testLibrarySidebarVisibilityDefaultsToShownAndPersists() {
        let suiteName = "KnowledgeMasterTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let settings = AppSettings(defaults: defaults) { nil }
        XCTAssertTrue(settings.libraryVisible)
        settings.libraryVisible = false

        let reloaded = AppSettings(defaults: defaults) { nil }
        XCTAssertFalse(reloaded.libraryVisible)
    }

    func testAPIKeyIsLoadedOnlyWhenUsedAndThenCachedInMemory() {
        let suiteName = "KnowledgeMasterTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        var reads = 0
        let settings = AppSettings(defaults: defaults) {
            reads += 1
            return "cached-key"
        }

        XCTAssertEqual(reads, 0)
        XCTAssertEqual(settings.apiKeyForUse(), "cached-key")
        XCTAssertEqual(settings.apiKeyForUse(), "cached-key")
        XCTAssertEqual(reads, 1)
    }

    func testDroppedDirectoryDiscoversSupportedFilesRecursively() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let nested = root.appendingPathComponent("nested")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        try "# Markdown".write(to: nested.appendingPathComponent("note.md"), atomically: true, encoding: .utf8)
        try "ignored".write(to: root.appendingPathComponent("image.png"), atomically: true, encoding: .utf8)

        let files = DocumentExtractor.importableFiles(from: [root])
        XCTAssertEqual(files.map(\.lastPathComponent), ["note.md"])
    }

    func testWordDocumentsAreDiscoveredAndExtracted() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = NSAttributedString(string: "Word 文档正文")

        for (name, type) in [("sample.doc", NSAttributedString.DocumentType.docFormat),
                             ("sample.docx", NSAttributedString.DocumentType.officeOpenXML)] {
            let url = root.appendingPathComponent(name)
            let data = try source.data(
                from: NSRange(location: 0, length: source.length),
                documentAttributes: [.documentType: type]
            )
            try data.write(to: url)
            XCTAssertTrue(DocumentExtractor.importableFiles(from: [url]).contains(url))
            XCTAssertEqual(try DocumentExtractor.extract(url).text.trimmingCharacters(in: .whitespacesAndNewlines),
                           "Word 文档正文")
        }
    }

    func testMovingDocumentBetweenTopicsReplacesOnlyDraggedAssociation() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let input = root.appendingPathComponent("input.txt")
        try "正文".write(to: input, atomically: true, encoding: .utf8)
        let store = KnowledgeStore(rootURL: root.appendingPathComponent("library"))
        _ = store.importFiles([input])
        let document = try XCTUnwrap(store.data.documents.first)
        let source = try XCTUnwrap(store.createTopic("来源"))
        let target = try XCTUnwrap(store.createTopic("目标"))
        let retained = try XCTUnwrap(store.createTopic("保留"))
        store.link(documentID: document.id, topicID: source.id)
        store.link(documentID: document.id, topicID: retained.id)

        XCTAssertTrue(store.move(documentID: document.id, from: source.id, to: target.id))
        XCTAssertFalse(store.documents(for: source.id).contains(where: { $0.id == document.id }))
        XCTAssertTrue(store.documents(for: target.id).contains(where: { $0.id == document.id }))
        XCTAssertTrue(store.documents(for: retained.id).contains(where: { $0.id == document.id }))
    }

    func testMovingDocumentToUnclassifiedRemovesAllTopicAssociations() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let input = root.appendingPathComponent("input.txt")
        try "正文".write(to: input, atomically: true, encoding: .utf8)
        let store = KnowledgeStore(rootURL: root.appendingPathComponent("library"))
        _ = store.importFiles([input])
        let document = try XCTUnwrap(store.data.documents.first)
        let first = try XCTUnwrap(store.createTopic("主题一"))
        let second = try XCTUnwrap(store.createTopic("主题二"))
        store.link(documentID: document.id, topicID: first.id)
        store.link(documentID: document.id, topicID: second.id)

        XCTAssertTrue(store.move(documentID: document.id, from: first.id, to: nil))
        XCTAssertFalse(store.data.documentTopics.contains(where: { $0.documentId == document.id }))
    }

    func testRemovingDocumentFromCurrentTopicKeepsOtherAssociations() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let input = root.appendingPathComponent("input.txt")
        try "正文".write(to: input, atomically: true, encoding: .utf8)
        let store = KnowledgeStore(rootURL: root.appendingPathComponent("library"))
        _ = store.importFiles([input])
        let document = try XCTUnwrap(store.data.documents.first)
        let current = try XCTUnwrap(store.createTopic("当前"))
        let retained = try XCTUnwrap(store.createTopic("保留"))
        store.link(documentID: document.id, topicID: current.id)
        store.link(documentID: document.id, topicID: retained.id)

        store.unlink(documentID: document.id, topicID: current.id)

        XCTAssertFalse(store.documents(for: current.id).contains(where: { $0.id == document.id }))
        XCTAssertTrue(store.documents(for: retained.id).contains(where: { $0.id == document.id }))
    }

    func testPDFBookmarkPersistsMovesAndTogglesOff() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let input = root.appendingPathComponent("input")
        try FileManager.default.createDirectory(at: input, withIntermediateDirectories: true)
        let pdfURL = input.appendingPathComponent("bookmark.pdf")
        var mediaBox = CGRect(x: 0, y: 0, width: 300, height: 400)
        let consumer = try XCTUnwrap(CGDataConsumer(url: pdfURL as CFURL))
        let context = try XCTUnwrap(CGContext(consumer: consumer, mediaBox: &mediaBox, nil))
        context.beginPDFPage(nil)
        context.endPDFPage()
        context.beginPDFPage(nil)
        context.endPDFPage()
        context.closePDF()

        let library = root.appendingPathComponent("library")
        let store = KnowledgeStore(rootURL: library)
        _ = store.importFiles([pdfURL])
        let document = try XCTUnwrap(store.data.documents.first)
        XCTAssertEqual(document.pageCount, 2)

        XCTAssertTrue(store.toggleBookmark(documentID: document.id, pageIndex: 1))
        XCTAssertEqual(store.bookmarkPage(for: document.id), 1)
        let reloaded = KnowledgeStore(rootURL: library)
        XCTAssertEqual(reloaded.bookmarkPage(for: document.id), 1)

        XCTAssertTrue(reloaded.toggleBookmark(documentID: document.id, pageIndex: 0))
        XCTAssertEqual(reloaded.bookmarkPage(for: document.id), 0)
        XCTAssertFalse(reloaded.toggleBookmark(documentID: document.id, pageIndex: 0))
        XCTAssertNil(reloaded.bookmarkPage(for: document.id))
    }

    func testWebPageHTMLImportsWithTitleSourceAndSearchableBody() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = KnowledgeStore(rootURL: root)
        let sourceURL = try XCTUnwrap(URL(string: "https://example.com/research/article"))
        let html = Data("""
        <!doctype html><html><head><title>网页研究资料</title></head>
        <body><h1>核心结论</h1><p>混合检索结合关键词和语义召回。</p></body></html>
        """.utf8)

        XCTAssertTrue(store.importWebPage(html, sourceURL: sourceURL).first?.hasPrefix("已导入") == true)
        let document = try XCTUnwrap(store.data.documents.first)
        XCTAssertEqual(document.extensionName, ".html")
        XCTAssertEqual(document.displayTitle, "网页研究资料")
        XCTAssertEqual(document.sourceURL, sourceURL.absoluteString)
        XCTAssertTrue(store.extractedContent(for: document.id).text.contains("混合检索"))
        XCTAssertEqual(store.search("语义召回", topicID: nil).map(\.id), [document.id])

        let reloaded = KnowledgeStore(rootURL: root)
        XCTAssertEqual(reloaded.data.documents.first?.sourceURL, sourceURL.absoluteString)
    }

    func testWebPageURLNormalizationAcceptsHostAndRejectsNonWebSchemes() {
        XCTAssertEqual(WebPageImporter.normalizedURL(from: "example.com/path")?.absoluteString,
                       "https://example.com/path")
        XCTAssertEqual(WebPageImporter.normalizedURL(from: "http://example.com")?.scheme, "http")
        XCTAssertNil(WebPageImporter.normalizedURL(from: "file:///tmp/page.html"))
        XCTAssertNil(WebPageImporter.normalizedURL(from: "   "))
    }

    func testChatMarkdownPreservesBlocksAndRendersLaTeXOffline() {
        let html = ChatMarkdownDocument.html(markdown: "## 结论\n\n第一行\n第二行\n\n$$x^2$$")
        XCTAssertTrue(html.contains("marked.parse"))
        XCTAssertTrue(html.contains("breaks: true"))
        XCTAssertTrue(html.contains("renderMathInElement"))
        XCTAssertTrue(html.contains("Content-Security-Policy"))
        XCTAssertTrue(html.contains("querySelectorAll('script, iframe"))
        XCTAssertTrue(html.contains("第一行\\n第二行"))
        XCTAssertGreaterThan(html.count, 200_000)
        XCTAssertNotNil(ChatMarkdownDocument.resourcesURL)
    }

    func testMarkdownWebViewForwardsVerticalTrackpadScrollingToChat() {
        XCTAssertTrue(ChatMarkdownScrollBehavior.shouldForwardToParent(deltaX: 0, deltaY: 12))
        XCTAssertTrue(ChatMarkdownScrollBehavior.shouldForwardToParent(deltaX: 2, deltaY: -8))
        XCTAssertFalse(ChatMarkdownScrollBehavior.shouldForwardToParent(deltaX: 10, deltaY: 2))
        XCTAssertFalse(ChatMarkdownScrollBehavior.shouldForwardToParent(deltaX: 0, deltaY: 0))
    }

    func testLegacyAskAIPromptIsKeptOutOfVisibleConversation() {
        let quote = ReaderQuote(text: "选中的原文", documentId: UUID(), documentName: "paper.pdf", page: 1)
        let message = ChatMessage(role: "user",
                                  content: "请结合上下文回答我关于这段内容的问题：还有哪些相关论文？",
                                  quote: quote)
        let conversation = Conversation(title: "请结合上下文回答我关于这段内容的问题：还有哪些相关论文？",
                                        messages: [message])

        XCTAssertEqual(ChatPresentation.visibleContent(for: message), "还有哪些相关论文？")
        XCTAssertEqual(ChatPresentation.historyTitle(for: conversation), "还有哪些相关论文？")
    }

    func testReturnSendsAndShiftReturnKeepsNewline() {
        XCTAssertTrue(ChatComposerBehavior.shouldSendOnReturn(shiftPressed: false))
        XCTAssertFalse(ChatComposerBehavior.shouldSendOnReturn(shiftPressed: true))
        XCTAssertFalse(ChatComposerBehavior.shouldSendOnReturn(shiftPressed: false, isComposing: true))
    }

    func testQuotedSelectionAutomaticallyAuthorizesItsOriginalDocument() {
        let selected = UUID()
        let quoted = UUID()
        let current = UUID()
        let quote = ReaderQuote(text: "选中文字", documentId: quoted, documentName: "paper.pdf", page: 3)

        let withoutCurrent = ChatScopeResolver.documentIDs(selected: [selected], currentDocumentID: current,
                                                           includeCurrent: false, quote: quote)
        XCTAssertEqual(Set(withoutCurrent), Set([selected, quoted]))
        XCTAssertFalse(withoutCurrent.contains(current))
    }

    func testDirectAPIHistoryReusesStoredOutboundPromptAndAppendsNewestMessage() {
        let first = ChatMessage(role: "user", content: "界面问题", promptContent: "带检索资料的实际问题")
        let answer = ChatMessage(role: "assistant", content: "回答")
        let newest = ChatMessage(role: "user", content: "继续追问")

        let messages = ChatPromptBuilder.messages(from: [first, answer, newest])

        XCTAssertEqual(messages.map(\.content), ["带检索资料的实际问题", "回答", "继续追问"])
        XCTAssertEqual(messages.map(\.role), ["user", "assistant", "user"])
    }

    func testReaderQuoteImageIsTransientAndNotSavedInConversationHistory() throws {
        let quote = ReaderQuote(text: "公式", documentId: UUID(), documentName: "paper.pdf", page: 2,
                                imagePNG: Data([1, 2, 3]))
        let encoded = try JSONEncoder().encode(quote)
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("AQID"))
        XCTAssertNil(try JSONDecoder().decode(ReaderQuote.self, from: encoded).imagePNG)
    }

    func testOpenAICompatibleVisionMessageIncludesTextAndPNGDataURL() throws {
        let messages = [
            AIClient.Message(role: "system", content: "system"),
            AIClient.Message(role: "user", content: "解释这个公式")
        ]
        let body = AIClient.VisionRequest(model: "vision-model",
                                          messages: AIClient.visionMessages(from: messages,
                                                                           imagePNG: Data([0x89, 0x50, 0x4E, 0x47])))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        let encodedMessages = try XCTUnwrap(object["messages"] as? [[String: Any]])
        XCTAssertEqual(encodedMessages.first?["content"] as? String, "system")
        let parts = try XCTUnwrap(encodedMessages.last?["content"] as? [[String: Any]])
        XCTAssertEqual(parts.first?["text"] as? String, "解释这个公式")
        let image = try XCTUnwrap(parts.last?["image_url"] as? [String: Any])
        XCTAssertTrue((image["url"] as? String)?.hasPrefix("data:image/png;base64,") == true)
    }

    func testPDFSelectionSnapshotCropAddsPaddingAndStaysInsidePage() throws {
        let page = CGRect(x: 0, y: 0, width: 600, height: 800)
        let crop = try XCTUnwrap(PDFSelectionSnapshot.cropBounds(
            rects: [CGRect(x: 10, y: 20, width: 100, height: 30), CGRect(x: 120, y: 20, width: 80, height: 30)],
            pageBounds: page,
            padding: 18
        ))
        XCTAssertEqual(crop.minX, 0, accuracy: 0.01)
        XCTAssertEqual(crop.minY, 2, accuracy: 0.01)
        XCTAssertEqual(crop.maxX, 218, accuracy: 0.01)
    }

    func testPDFSelectionSnapshotRendersARealPNG() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).pdf")
        var mediaBox = CGRect(x: 0, y: 0, width: 300, height: 400)
        let consumer = try XCTUnwrap(CGDataConsumer(url: url as CFURL))
        let context = try XCTUnwrap(CGContext(consumer: consumer, mediaBox: &mediaBox, nil))
        context.beginPDFPage(nil)
        context.setFillColor(CGColor(red: 0.1, green: 0.3, blue: 0.8, alpha: 1))
        context.fill(CGRect(x: 40, y: 100, width: 120, height: 50))
        context.endPDFPage()
        context.closePDF()

        let image = PDFSelectionSnapshot.render(
            url: url,
            selection: ReaderSelection(text: "diagram", page: 1,
                                       rects: [AnnotationRect(page: 1, x: 40, y: 100, width: 120, height: 50)])
        )

        let data = try XCTUnwrap(image)
        XCTAssertEqual(Array(data.prefix(8)), [137, 80, 78, 71, 13, 10, 26, 10])
        XCTAssertGreaterThan(data.count, 100)
    }

    func testAnnotationReferencesRoundTripForPDFAndRichTextClicks() {
        let id = UUID()
        XCTAssertEqual(KnowledgeAnnotationReference.id(fromPDFContents: KnowledgeAnnotationReference.pdfContents(for: id)), id)
        XCTAssertEqual(KnowledgeAnnotationReference.id(fromLink: KnowledgeAnnotationReference.link(for: id)), id)
    }

    func testSelectionToolbarStaysAboveAndRightAlignedToSelection() {
        let position = SelectionToolbarLayout.position(anchorX: 600, anchorY: 300, in: CGSize(width: 800, height: 600))
        XCTAssertEqual(position.x + SelectionToolbarLayout.width / 2, 612, accuracy: 0.01)
        XCTAssertEqual(position.y, 272, accuracy: 0.01)
    }

    func testReaderZoomScaleFollowsMagnificationAndClamps() {
        XCTAssertEqual(ReaderZoomBehavior.adjustedScale(
            current: 1, magnification: 0.25, minimum: 0.5, maximum: 3
        ), 1.25)
        XCTAssertEqual(ReaderZoomBehavior.adjustedScale(
            current: 2.8, magnification: 0.5, minimum: 0.5, maximum: 3
        ), 3)
        XCTAssertEqual(ReaderZoomBehavior.adjustedScale(
            current: 0.6, magnification: -0.5, minimum: 0.5, maximum: 3
        ), 0.5)
    }

    func testAgentArgumentsAllowSkillsWithoutExposingTheLibrary() {
        let workspace = URL(fileURLWithPath: "/tmp/km-agent")
        let work = workspace.appendingPathComponent("work")
        let documents = workspace.appendingPathComponent("documents")
        let cache = workspace.appendingPathComponent("cache")
        let answer = work.appendingPathComponent("answer.md")
        let claude = AgentRunner.arguments(for: .claudeCode, workDirectory: work,
                                           documentsDirectory: documents, cacheDirectory: cache, answerURL: answer)
        XCTAssertTrue(claude.contains("auto"))
        XCTAssertTrue(claude.contains("default"))
        XCTAssertTrue(claude.contains(documents.path))
        XCTAssertTrue(claude.contains(cache.path))
        XCTAssertTrue(claude.contains("stream-json"))
        XCTAssertTrue(claude.contains("--verbose"))
        XCTAssertTrue(claude.contains("--include-hook-events"))
        XCTAssertTrue(claude.contains("--no-session-persistence"))
        XCTAssertFalse(claude.contains("--disable-slash-commands"))
        XCTAssertFalse(claude.contains("--safe-mode"))
        XCTAssertFalse(claude.contains("--dangerously-skip-permissions"))

        let codex = AgentRunner.arguments(for: .codex, workDirectory: work,
                                          documentsDirectory: documents, cacheDirectory: cache, answerURL: answer)
        XCTAssertTrue(codex.contains("workspace-write"))
        XCTAssertTrue(codex.contains("web_search=\"live\""))
        XCTAssertTrue(codex.contains("sandbox_workspace_write.network_access=true"))
        XCTAssertTrue(codex.contains("features.apps=false"))
        XCTAssertTrue(codex.contains("features.remote_plugin=false"))
        XCTAssertTrue(codex.contains("--ephemeral"))
        XCTAssertTrue(codex.contains("--json"))
        XCTAssertFalse(codex.contains("--ignore-user-config"))
        XCTAssertFalse(codex.contains("--ignore-rules"))
        XCTAssertFalse(codex.contains("--dangerously-bypass-approvals-and-sandbox"))

        let sessionID = UUID().uuidString
        let persistentClaude = AgentRunner.arguments(
            for: .claudeCode, workDirectory: work, documentsDirectory: documents,
            cacheDirectory: cache, answerURL: answer, sessionID: sessionID,
            persistent: true, resume: false
        )
        XCTAssertTrue(persistentClaude.contains("--session-id"))
        XCTAssertTrue(persistentClaude.contains(sessionID))
        XCTAssertFalse(persistentClaude.contains("--no-session-persistence"))

        let resumedClaude = AgentRunner.arguments(
            for: .claudeCode, workDirectory: work, documentsDirectory: documents,
            cacheDirectory: cache, answerURL: answer, sessionID: sessionID,
            persistent: true, resume: true
        )
        XCTAssertTrue(resumedClaude.contains("--resume"))

        let resumedCodex = AgentRunner.arguments(
            for: .codex, workDirectory: work, documentsDirectory: documents,
            cacheDirectory: cache, answerURL: answer, sessionID: sessionID,
            persistent: true, resume: true
        )
        XCTAssertEqual(Array(resumedCodex.prefix(2)), ["exec", "resume"])
        XCTAssertTrue(resumedCodex.contains(sessionID))
        XCTAssertFalse(resumedCodex.contains("--ephemeral"))
    }

    func testPaperNamingServiceParsesJSONAndRejectsBadExistingNames() throws {
        let response = "模型结果：```json\n{\"is_paper\":true,\"title\":\"Attention Is All You Need\",\"first_author\":\"Ashish Vaswani\",\"multiple_authors\":true}\n```"
        let metadata = try XCTUnwrap(PaperNamingService.parse(response))
        XCTAssertEqual(PaperNamingService.displayName(from: metadata), "Vaswani et al., Attention Is All You Need")

        let document = KnowledgeDocument(name: "paper.pdf",
                                         displayName: "Published as a conference paper at ICLR 2025",
                                         extensionName: ".pdf", size: 1, sha256: "abc",
                                         storedPath: "source/documents/paper.pdf")
        XCTAssertTrue(PaperNamingService.needsRefinement(document))
    }

    func testPaperNamingFallbackOnlyUsesCompactTitleAndAuthorCandidate() throws {
        let extracted = ExtractedDocument(
            text: "",
            pages: [ExtractedPage(
                number: 1,
                text: """
                Efficient Knowledge Retrieval for Long Documents
                Alice Zhang, Bob Lee
                University of Example
                alice@example.com
                Abstract
                This full abstract must not be sent to the naming model.
                """
            )]
        )

        let candidate = try XCTUnwrap(DocumentExtractor.paperHeaderCandidate(from: extracted))

        XCTAssertTrue(candidate.contains("Efficient Knowledge Retrieval"))
        XCTAssertTrue(candidate.contains("Alice Zhang"))
        XCTAssertFalse(candidate.contains("University of Example"))
        XCTAssertFalse(candidate.contains("alice@example.com"))
        XCTAssertFalse(candidate.contains("full abstract"))
        XCTAssertLessThanOrEqual(candidate.count, 1_600)
    }

    func testAgentPromptTreatsDocumentsAsUntrustedData() {
        let request = AgentRunRequest(
            question: "比较两份资料",
            quote: nil,
            history: [ChatMessage(role: "user", content: "不应补发的旧消息")],
            documents: [],
            annotations: []
        )
        let documentID = UUID()
        let prompt = AgentRunner.prompt(for: request, documentFiles: [
            (documentID, "../documents/\(documentID.uuidString)/a.pdf", "a.pdf", true)
        ])
        XCTAssertTrue(prompt.contains("不可信数据"))
        XCTAssertTrue(prompt.contains("未经预切分的原始文件"))
        XCTAssertTrue(prompt.contains("../documents/\(documentID.uuidString)/a.pdf"))
        XCTAssertTrue(prompt.contains("generated/<文档ID>/"))
        XCTAssertTrue(prompt.contains("比较两份资料"))
        XCTAssertFalse(prompt.contains("不应补发的旧消息"))
    }

    func testResumedAgentPromptContainsOnlyLatestTurnContext() {
        let request = AgentRunRequest(
            question: "只解释最新问题",
            quote: ReaderQuote(text: "最新选区", documentId: UUID(), documentName: "paper.pdf", page: 2),
            history: [
                ChatMessage(role: "user", content: "不应重发的旧问题"),
                ChatMessage(role: "assistant", content: "不应重发的旧回答")
            ],
            documents: [],
            annotations: []
        )

        let prompt = AgentRunner.followUpPrompt(for: request)

        XCTAssertTrue(prompt.contains("只解释最新问题"))
        XCTAssertTrue(prompt.contains("最新选区"))
        XCTAssertFalse(prompt.contains("不应重发的旧问题"))
        XCTAssertFalse(prompt.contains("不应重发的旧回答"))
    }

    func testAgentStagesAnExactReadOnlyCopyOfTheOriginalFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let original = root.appendingPathComponent("input/扫描资料.pdf")
        let documents = root.appendingPathComponent("workspace/documents")
        let cache = root.appendingPathComponent("workspace/cache")
        try FileManager.default.createDirectory(at: original.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        let bytes = Data([0x25, 0x50, 0x44, 0x46, 0x2d, 0x01, 0x02, 0x03])
        try bytes.write(to: original)
        let id = UUID()
        let source = AgentSourceDocument(id: id, name: original.lastPathComponent, sourceURL: original,
                                         cacheURL: root.appendingPathComponent("persistent-cache/\(id.uuidString)"))

        let manifest = try AgentRunner.stageOriginalDocuments([source], documentsDirectory: documents, cacheDirectory: cache)
        let staged = documents.appendingPathComponent(id.uuidString).appendingPathComponent("扫描资料.pdf")

        XCTAssertEqual(try Data(contentsOf: staged), bytes)
        XCTAssertEqual(manifest.first?.1, "../documents/\(id.uuidString)/扫描资料.pdf")
        XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: staged.path)[.posixPermissions] as? NSNumber)?.intValue, 0o444)
        let originalInode = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: original.path)[.systemFileNumber] as? NSNumber)
        let stagedInode = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: staged.path)[.systemFileNumber] as? NSNumber)
        XCTAssertNotEqual(originalInode, stagedInode)
        XCTAssertFalse(FileManager.default.fileExists(atPath: staged.deletingPathExtension().appendingPathExtension("md").path))

        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: staged.deletingLastPathComponent().path)
        try FileManager.default.removeItem(at: staged)
        XCTAssertEqual(try Data(contentsOf: original), bytes)
    }

    func testAgentStagesExistingAppExtractionAlongsideGeneratedCache() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let original = root.appendingPathComponent("source.pdf")
        let baseline = root.appendingPathComponent("index.json")
        let documents = root.appendingPathComponent("workspace/documents")
        let cache = root.appendingPathComponent("workspace/cache")
        try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        try Data("PDF".utf8).write(to: original)
        try #"{"text":"already parsed","pages":[]}"#.write(to: baseline, atomically: true, encoding: .utf8)
        let id = UUID()
        let source = AgentSourceDocument(id: id, name: "source.pdf", sourceURL: original,
                                         cacheURL: root.appendingPathComponent("persistent-cache"),
                                         baselineExtractionURL: baseline)

        let manifest = try AgentRunner.stageOriginalDocuments([source], documentsDirectory: documents,
                                                               cacheDirectory: cache)

        let staged = cache.appendingPathComponent(id.uuidString).appendingPathComponent("_app/extracted.json")
        XCTAssertTrue(manifest.first?.3 == true)
        XCTAssertEqual(try String(contentsOf: staged, encoding: .utf8), #"{"text":"already parsed","pages":[]}"#)
    }

    func testAgentStagesSelectionSnapshotAsReadOnlyContext() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let control = root.appendingPathComponent("control")
        try FileManager.default.createDirectory(at: control, withIntermediateDirectories: true)

        let path = try AgentRunner.stageSelectionSnapshot(Data([1, 2, 3]), controlDirectory: control)
        let staged = control.appendingPathComponent("selection.png")

        XCTAssertEqual(path, "../control/selection.png")
        XCTAssertEqual(try Data(contentsOf: staged), Data([1, 2, 3]))
        XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: staged.path)[.posixPermissions] as? NSNumber)?.intValue,
                       0o444)
    }

    func testAgentRejectsASymbolicLinkAsAnOriginalDocument() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let original = root.appendingPathComponent("original.pdf")
        let link = root.appendingPathComponent("linked.pdf")
        let documents = root.appendingPathComponent("workspace/documents")
        let cache = root.appendingPathComponent("workspace/cache")
        try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        try Data("PDF".utf8).write(to: original)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: original)
        let item = AgentSourceDocument(id: UUID(), name: "linked.pdf", sourceURL: link,
                                       cacheURL: root.appendingPathComponent("persistent-cache"))

        XCTAssertThrowsError(try AgentRunner.stageOriginalDocuments([item], documentsDirectory: documents, cacheDirectory: cache))
    }

    func testAgentGeneratedParsingCacheOnlyAddsFilesForSelectedDocuments() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let generated = root.appendingPathComponent("generated")
        let selectedID = UUID()
        let unknownID = UUID()
        let cache = root.appendingPathComponent("cache/\(selectedID.uuidString)")
        try FileManager.default.createDirectory(at: generated.appendingPathComponent(selectedID.uuidString), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: generated.appendingPathComponent(unknownID.uuidString), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        try "旧缓存".write(to: cache.appendingPathComponent("old.txt"), atomically: true, encoding: .utf8)
        try "OCR 结果".write(to: generated.appendingPathComponent(selectedID.uuidString).appendingPathComponent("ocr.md"), atomically: true, encoding: .utf8)
        try "不应同步".write(to: generated.appendingPathComponent(unknownID.uuidString).appendingPathComponent("ignored.md"), atomically: true, encoding: .utf8)
        let document = AgentSourceDocument(id: selectedID, name: "a.pdf", sourceURL: root.appendingPathComponent("a.pdf"), cacheURL: cache)

        let saved = try AgentRunner.syncGeneratedFiles(from: generated, documents: [document])

        XCTAssertEqual(saved, ["source/generated/agent-cache/\(selectedID.uuidString)/ocr.md"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: cache.appendingPathComponent("old.txt").path))
        XCTAssertEqual(try String(contentsOf: cache.appendingPathComponent("ocr.md"), encoding: .utf8), "OCR 结果")
        XCTAssertFalse(FileManager.default.fileExists(atPath: cache.appendingPathComponent("ignored.md").path))
    }

    func testDirectAPIHasFragmentAndAutonomousContextModes() {
        XCTAssertEqual(APIContextMode.allCases, [.relevantFragments, .autonomous])
    }

    func testAppTerminationStopsRegisteredAgentProcesses() throws {
        let process = Process()
        let runID = UUID()
        process.executableURL = URL(fileURLWithPath: "/bin/sleep")
        process.arguments = ["30"]
        try process.run()
        AgentProcessRegistry.shared.register(process, runID: runID)
        XCTAssertEqual(AgentProcessRegistry.shared.runningCount, 1)

        AgentProcessRegistry.shared.terminateAll()
        process.waitUntilExit()
        XCTAssertFalse(process.isRunning)
        XCTAssertEqual(AgentProcessRegistry.shared.runningCount, 0)
    }

    func testManualTerminationOnlyStopsTheSelectedAgentRun() throws {
        let first = Process()
        let second = Process()
        let firstID = UUID()
        let secondID = UUID()
        for process in [first, second] {
            process.executableURL = URL(fileURLWithPath: "/bin/sleep")
            process.arguments = ["30"]
            try process.run()
        }
        AgentProcessRegistry.shared.register(first, runID: firstID)
        AgentProcessRegistry.shared.register(second, runID: secondID)

        AgentProcessRegistry.shared.terminate(runID: firstID)
        first.waitUntilExit()

        XCTAssertFalse(first.isRunning)
        XCTAssertTrue(second.isRunning)
        XCTAssertTrue(AgentProcessRegistry.shared.wasCancelled(runID: firstID))
        AgentProcessRegistry.shared.terminateAll()
        second.waitUntilExit()
    }

    func testCodexStreamParserShowsToolsButFiltersReasoning() {
        let reasoning = AgentStreamParser.parse(
            line: #"{"type":"item.completed","item":{"type":"reasoning","text":"hidden"}}"#,
            backend: .codex
        )
        let command = AgentStreamParser.parse(
            line: #"{"type":"item.started","item":{"type":"command_execution","command":"pdftotext ../documents/a.pdf -"}}"#,
            backend: .codex
        )

        XCTAssertTrue(reasoning.events.isEmpty)
        XCTAssertEqual(command.events.first?.kind, .tool)
        XCTAssertEqual(command.events.first?.title, "正在执行命令")
        XCTAssertTrue(command.events.first?.detail?.contains("pdftotext") == true)
    }

    func testAgentStreamParserCapturesResumableSessionIDs() {
        let codex = AgentStreamParser.parse(
            line: #"{"type":"thread.started","thread_id":"codex-session"}"#,
            backend: .codex
        )
        let claude = AgentStreamParser.parse(
            line: #"{"type":"system","subtype":"init","session_id":"claude-session"}"#,
            backend: .claudeCode
        )

        XCTAssertEqual(codex.sessionID, "codex-session")
        XCTAssertEqual(claude.sessionID, "claude-session")
    }

    func testCodexReconnectIsAWarningRatherThanAFinalError() {
        let update = AgentStreamParser.parse(
            line: #"{"type":"error","message":"Reconnecting... 2/5 (request timed out)"}"#,
            backend: .codex
        )

        XCTAssertEqual(update.events.first?.kind, .warning)
        XCTAssertEqual(update.events.first?.title, "网络超时，Codex 正在重连")
    }

    func testFinderLaunchedAgentReceivesMacOSSystemProxySettings() {
        let environment = AgentRunner.sanitizedEnvironment(for: .codex, source: [
            "HOME": "/Users/test", "PATH": "/usr/bin"
        ], systemProxies: [
            "HTTPEnable": 1, "HTTPProxy": "127.0.0.1", "HTTPPort": 7892,
            "HTTPSEnable": 1, "HTTPSProxy": "127.0.0.1", "HTTPSPort": 7892,
            "SOCKSEnable": 1, "SOCKSProxy": "127.0.0.1", "SOCKSPort": 7892,
            "ExceptionsList": ["localhost", "127.*"]
        ])

        XCTAssertEqual(environment["HTTPS_PROXY"], "http://127.0.0.1:7892")
        XCTAssertEqual(environment["https_proxy"], "http://127.0.0.1:7892")
        XCTAssertEqual(environment["ALL_PROXY"], "socks5://127.0.0.1:7892")
        XCTAssertEqual(environment["NO_PROXY"], "localhost,127.*")
        XCTAssertNil(environment["OPENAI_API_KEY"])
    }

    func testAgentDownloadsOnlySupportedRegularFilesIntoPendingArea() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let source = root.appendingPathComponent("work/downloads")
        let destination = root.appendingPathComponent("library/source/downloads/pending/run")
        try FileManager.default.createDirectory(at: source.appendingPathComponent("papers"), withIntermediateDirectories: true)
        try Data("PDF".utf8).write(to: source.appendingPathComponent("papers/research.pdf"))
        try Data("image".utf8).write(to: source.appendingPathComponent("cover.png"))

        let downloaded = try AgentRunner.syncDownloadedFiles(from: source, to: destination)

        XCTAssertEqual(downloaded.map(\.lastPathComponent), ["research.pdf"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: destination.appendingPathComponent("papers/research.pdf").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.appendingPathComponent("cover.png").path))
    }

    func testClaudeStreamParserExtractsToolProgressAndFinalAnswerIncrementally() {
        var parser = AgentStreamParser(backend: .claudeCode, workspacePath: "/tmp/KnowledgeMasterAgent-123")
        let tool = #"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"pdf"}}]}}"# + "\n"
        let result = #"{"type":"result","is_error":false,"num_turns":3,"duration_ms":4200,"result":"最终回答"}"# + "\n"
        let combined = Data((tool + result).utf8)
        let split = combined.count / 2

        let firstEvents = parser.consume(combined.prefix(split))
        let secondEvents = parser.consume(combined.suffix(from: split))

        XCTAssertEqual((firstEvents + secondEvents).first(where: { $0.title == "正在调用 Skill" })?.detail, "pdf")
        XCTAssertEqual((firstEvents + secondEvents).last?.kind, .completed)
        XCTAssertEqual(parser.finalAnswer, "最终回答")
    }

    func testClaudeWebSearchIsVisibleInExecutionTrace() {
        let update = AgentStreamParser.parse(
            line: #"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"WebSearch","input":{"query":"today AI news"}}]}}"#,
            backend: .claudeCode
        )
        XCTAssertEqual(update.events.first?.title, "正在联网查询")
        XCTAssertEqual(update.events.first?.detail, "today AI news")
    }

    func testOldChatMessageWithoutBackendRemainsCompatible() throws {
        let id = UUID()
        let data = #"{"id":"\#(id.uuidString)","role":"assistant","content":"ok","createdAt":0}"#.data(using: .utf8)!
        let message = try JSONDecoder().decode(ChatMessage.self, from: data)
        XCTAssertNil(message.backend)
        XCTAssertNil(message.promptContent)
        XCTAssertNil(message.generatedFiles)
        XCTAssertNil(message.traceEvents)
    }

    func testAgentTraceEventsRoundTripInConversationHistory() throws {
        let message = ChatMessage(role: "assistant", content: "完成", backend: ChatBackend.codex.rawValue,
                                  traceEvents: [AgentTraceEvent(kind: .tool, title: "正在读取文件", detail: "a.pdf")])
        let decoded = try JSONDecoder().decode(ChatMessage.self, from: JSONEncoder().encode(message))

        XCTAssertEqual(decoded.traceEvents?.first?.title, "正在读取文件")
        XCTAssertEqual(decoded.traceEvents?.first?.detail, "a.pdf")
    }

    func testKnowledgeFileToolsCanSearchReadAndWriteGeneratedFiles() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let workspace = try KnowledgeFileTools(
            documents: [AgentDocument(id: UUID(), name: "RAG 设计.pdf", content: "# 第 1 页\n\n混合检索包含关键词检索。")],
            generatedRoot: root.appendingPathComponent("generated")
        )

        let listed = workspace.execute(name: "list_files", arguments: #"{"path":"documents"}"#)
        let path = try XCTUnwrap(listed.split(separator: "\n").first.map(String.init))
        XCTAssertTrue(path.hasPrefix("documents/"))
        XCTAssertTrue(workspace.execute(name: "read_file", arguments: #"{"path":"\#(path)"}"#).contains("混合检索"))
        XCTAssertTrue(workspace.execute(name: "search_files", arguments: #"{"query":"关键词"}"#).contains(":3:"))

        let written = workspace.execute(
            name: "write_file",
            arguments: ##"{"path":"generated/结论.md","content":"# 结论\n\n采用混合检索。"}"##
        )
        XCTAssertTrue(written.contains("已写入"))
        XCTAssertEqual(workspace.generatedFiles, ["generated/结论.md"])
        let saved = try String(contentsOf: root.appendingPathComponent("generated/结论.md"), encoding: .utf8)
        XCTAssertTrue(saved.contains("采用混合检索"))
    }

    func testKnowledgeFileToolsRejectTraversalAndWritesOutsideGenerated() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let generated = root.appendingPathComponent("generated")
        let workspace = try KnowledgeFileTools(documents: [], generatedRoot: generated)

        let traversal = workspace.execute(name: "write_file", arguments: #"{"path":"generated/../outside.txt","content":"bad"}"#)
        let sourceWrite = workspace.execute(name: "write_file", arguments: #"{"path":"documents/changed.md","content":"bad"}"#)
        XCTAssertTrue(traversal.contains("路径无效"))
        XCTAssertTrue(sourceWrite.contains("写入被拒绝"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("outside.txt").path))
        XCTAssertTrue(workspace.generatedFiles.isEmpty)
    }

    func testKnowledgeFileToolsRejectSymlinkEscape() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let generated = root.appendingPathComponent("generated")
        let outside = root.appendingPathComponent("outside")
        let workspace = try KnowledgeFileTools(documents: [], generatedRoot: generated)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: generated.appendingPathComponent("link"), withDestinationURL: outside)

        let result = workspace.execute(name: "write_file", arguments: #"{"path":"generated/link/escaped.txt","content":"bad"}"#)
        XCTAssertTrue(result.contains("路径无效"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: outside.appendingPathComponent("escaped.txt").path))
    }

    func testReActToolProtocolSupportsParallelCallsAndReasoningContent() throws {
        XCTAssertEqual(Set(AIClient.toolDefinitions.map(\.function.name)),
                       Set(["list_files", "read_file", "search_files", "write_file"]))
        let json = #"{"choices":[{"message":{"role":"assistant","content":null,"reasoning_content":"先检索","tool_calls":[{"id":"call_1","type":"function","function":{"name":"search_files","arguments":"{\"query\":\"RAG\"}"}},{"id":"call_2","type":"function","function":{"name":"list_files","arguments":"{}"}}]}}]}"#
        let response = try JSONDecoder().decode(AIClient.ReActResponse.self, from: Data(json.utf8))
        let message = try XCTUnwrap(response.choices.first?.message)
        XCTAssertEqual(message.reasoningContent, "先检索")
        XCTAssertEqual(message.toolCalls?.count, 2)
        XCTAssertEqual(message.toolCalls?.first?.function.name, "search_files")
    }

    func testFractionalISODateCanBeLoaded() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let documentID = UUID()
        let json = """
        {"version":1,"documents":[{"id":"\(documentID.uuidString)","name":"old.txt","extension":".txt","size":3,"sha256":"abc","storedPath":"/tmp/old.txt","importedAt":"2026-07-19T08:00:00.123Z","status":"ready","pageCount":null}],"topics":[],"documentTopics":[],"conversations":[],"topicSummaries":[]}
        """
        try json.write(to: root.appendingPathComponent("knowledge.json"), atomically: true, encoding: .utf8)
        let store = KnowledgeStore(rootURL: root)
        XCTAssertEqual(store.data.documents.first?.id, documentID)
    }
}

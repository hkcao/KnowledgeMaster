import XCTest
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

    func testSummaryNotesCanLinkAnnotationsAndCleanDeletedLinks() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = KnowledgeStore(rootURL: root)
        let documentID = UUID()
        let annotation = store.addAnnotation(documentID: documentID,
                                             selection: ReaderSelection(text: "关键结论", page: 2), kind: "note", note: "用于总结")
        let summary = try XCTUnwrap(store.createSummaryNote(title: "整体思考", content: "综合结论",
                                                            annotationIDs: [annotation.id]))
        XCTAssertEqual(store.data.summaryNotes.first?.annotationIDs, [annotation.id])

        store.deleteAnnotation(annotation.id)

        XCTAssertTrue(store.data.summaryNotes.first(where: { $0.id == summary.id })?.annotationIDs.isEmpty == true)
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

    func testMissingMetadataFieldsRemainCompatible() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try #"{"version":1,"documents":[],"topics":[],"documentTopics":[],"conversations":[],"topicSummaries":[]}"#
            .write(to: root.appendingPathComponent("knowledge.json"), atomically: true, encoding: .utf8)
        let store = KnowledgeStore(rootURL: root)
        XCTAssertTrue(store.data.annotations.isEmpty)
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

    func testChatOffersAllDockingPlacements() {
        XCTAssertEqual(Set(ChatPlacement.allCases), Set([.right, .bottom, .sidebar, .hidden]))
    }

    func testAPIKeyIsLoadedOnceAndThenCachedInMemory() {
        let suiteName = "KnowledgeMasterTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        var reads = 0
        let settings = AppSettings(defaults: defaults) {
            reads += 1
            return "cached-key"
        }

        XCTAssertTrue(settings.hasAPIKey)
        XCTAssertEqual(settings.apiKey, "cached-key")
        XCTAssertTrue(settings.hasAPIKey)
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

    func testChatMarkdownIsParsedForPreview() {
        let rendered = ChatMarkdownRenderer.render("## 结论\n\n**重点**与`代码`")
        XCTAssertEqual(String(rendered.characters), "结论重点与代码")
        XCTAssertGreaterThan(rendered.runs.count, 1)
    }

    func testReturnSendsAndShiftReturnKeepsNewline() {
        XCTAssertTrue(ChatComposerBehavior.shouldSendOnReturn(shiftPressed: false))
        XCTAssertFalse(ChatComposerBehavior.shouldSendOnReturn(shiftPressed: true))
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
        XCTAssertTrue(codex.contains("tools.web_search=true"))
        XCTAssertTrue(codex.contains("--ephemeral"))
        XCTAssertTrue(codex.contains("--json"))
        XCTAssertFalse(codex.contains("--ignore-user-config"))
        XCTAssertFalse(codex.contains("--ignore-rules"))
        XCTAssertFalse(codex.contains("--dangerously-bypass-approvals-and-sandbox"))
    }

    func testAgentPromptTreatsDocumentsAsUntrustedData() {
        let request = AgentRunRequest(
            question: "比较两份资料",
            quote: nil,
            history: [],
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

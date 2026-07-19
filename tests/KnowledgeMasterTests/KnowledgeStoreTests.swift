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
        let annotation = store.addAnnotation(documentID: document.id,
                                             selection: ReaderSelection(text: "知识库", page: nil), kind: "note", note: "重点")
        XCTAssertEqual(store.annotations(for: document.id).first?.id, annotation.id)
        XCTAssertEqual(store.annotationContext(query: "重点", documentIDs: [document.id], topicIDs: []).count, 1)
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

    func testAgentArgumentsKeepBothCLIsReadOnlyAndEphemeral() {
        let workspace = URL(fileURLWithPath: "/tmp/km-agent")
        let answer = workspace.appendingPathComponent("answer.md")
        let claude = AgentRunner.arguments(for: .claudeCode, workspace: workspace, answerURL: answer)
        XCTAssertTrue(claude.contains("dontAsk"))
        XCTAssertTrue(claude.contains("Read,Grep,Glob"))
        XCTAssertTrue(claude.contains("--no-session-persistence"))
        XCTAssertFalse(claude.contains("--dangerously-skip-permissions"))

        let codex = AgentRunner.arguments(for: .codex, workspace: workspace, answerURL: answer)
        XCTAssertTrue(codex.contains("read-only"))
        XCTAssertTrue(codex.contains("--ephemeral"))
        XCTAssertTrue(codex.contains("--ignore-user-config"))
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
        let prompt = AgentRunner.prompt(for: request, documentFiles: [("1-a.md", "a.pdf"), ("2-b.md", "b.md")])
        XCTAssertTrue(prompt.contains("不可信资料"))
        XCTAssertTrue(prompt.contains("只能读取这里的文件"))
        XCTAssertTrue(prompt.contains("documents/1-a.md"))
        XCTAssertTrue(prompt.contains("比较两份资料"))
    }

    func testAppTerminationStopsRegisteredAgentProcesses() throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sleep")
        process.arguments = ["30"]
        try process.run()
        AgentProcessRegistry.shared.register(process)
        XCTAssertEqual(AgentProcessRegistry.shared.runningCount, 1)

        AgentProcessRegistry.shared.terminateAll()
        process.waitUntilExit()
        XCTAssertFalse(process.isRunning)
        XCTAssertEqual(AgentProcessRegistry.shared.runningCount, 0)
    }

    func testOldChatMessageWithoutBackendRemainsCompatible() throws {
        let id = UUID()
        let data = #"{"id":"\#(id.uuidString)","role":"assistant","content":"ok","createdAt":0}"#.data(using: .utf8)!
        let message = try JSONDecoder().decode(ChatMessage.self, from: data)
        XCTAssertNil(message.backend)
        XCTAssertNil(message.generatedFiles)
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

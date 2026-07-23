import SwiftUI
import UniformTypeIdentifiers

private struct LibraryTreeNode: Identifiable {
    enum Kind {
        case topic(UUID)
        case document(UUID, topicID: UUID?)
        case unclassified
    }

    var id: String
    var kind: Kind
    var title: String
    var subtitle: String?
    var children: [LibraryTreeNode]?
}

private struct LibraryDocumentDrag {
    private static let prefix = "knowledge-document:"

    var documentID: UUID
    var sourceTopicID: UUID?

    var encoded: String {
        Self.prefix + documentID.uuidString + ":" + (sourceTopicID?.uuidString ?? "unclassified")
    }

    init(documentID: UUID, sourceTopicID: UUID?) {
        self.documentID = documentID
        self.sourceTopicID = sourceTopicID
    }

    init?(_ encoded: String) {
        guard encoded.hasPrefix(Self.prefix) else { return nil }
        let parts = encoded.dropFirst(Self.prefix.count).split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, let documentID = UUID(uuidString: String(parts[0])) else { return nil }
        if parts[1] == "unclassified" {
            self.init(documentID: documentID, sourceTopicID: nil)
        } else if let topicID = UUID(uuidString: String(parts[1])) {
            self.init(documentID: documentID, sourceTopicID: topicID)
        } else {
            return nil
        }
    }
}

private enum LibrarySidebarMode: String, CaseIterable, Identifiable {
    case directory = "目录"
    case notes = "笔记"
    var id: String { rawValue }
}

struct LibraryView: View {
    @EnvironmentObject private var store: KnowledgeStore
    @EnvironmentObject private var settings: AppSettings
    @Binding var selectedTopicID: UUID?
    @Binding var currentDocument: KnowledgeDocument?
    var onOpen: (KnowledgeDocument) -> Void
    var onOpenAnnotation: (KnowledgeAnnotation) -> Void

    @State private var query = ""
    @State private var showNewTopic = false
    @State private var newTopicName = ""
    @State private var newTopicParentID: UUID?
    @State private var renamingTopic: Topic?
    @State private var renameTopicName = ""
    @State private var deletingTopic: Topic?
    @State private var importMessage = ""
    @State private var recommendedDocuments: [KnowledgeDocument] = []
    @State private var selectedRecommendations: Set<String> = []
    @State private var showRecommendations = false
    @State private var isDropTarget = false
    @State private var sidebarMode: LibrarySidebarMode = .directory
    @State private var isRenamingPapers = false
    @State private var showWebImport = false
    @State private var webURLText = ""
    @State private var webImportError: String?
    @State private var isImportingWeb = false

    var body: some View {
        VStack(spacing: 0) {
            HStack { Label("知屿", systemImage: "books.vertical.fill").font(.title3.bold()); Spacer(); SettingsLink { Image(systemName: "gearshape") } }
                .padding(14)
            Picker("侧栏", selection: $sidebarMode) {
                ForEach(LibrarySidebarMode.allCases) { mode in Text(mode.rawValue).tag(mode) }
            }.pickerStyle(.segmented).labelsHidden().padding(.horizontal, 12).padding(.bottom, 8)
            if sidebarMode == .directory {
                directoryContent
            } else {
                NotesLibraryView(onOpenAnnotation: onOpenAnnotation)
            }
            Divider()
            HStack { Text("\(store.data.documents.count) 份资料"); Spacer(); Text(store.rootURL.path.contains("CloudDocs") ? "iCloud Drive" : "本地存储") }
                .font(.caption2).foregroundStyle(.secondary).padding(10)
        }
        .frame(minWidth: 230, maxHeight: .infinity, alignment: .top)
        .dropDestination(for: URL.self) { urls, _ in
            let importable = DocumentExtractor.importableFiles(from: urls)
            guard !importable.isEmpty else {
                importMessage = "拖入的内容中没有支持的文件"
                return false
            }
            performImport(importable)
            return true
        } isTargeted: { isDropTarget = $0 }
        .overlay {
            if isDropTarget {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 3, dash: [8, 5]))
                    .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                    .overlay { Label("拖到这里导入", systemImage: "square.and.arrow.down").font(.headline) }
                    .padding(6)
                    .allowsHitTesting(false)
            }
        }
        .alert(newTopicParentID == nil ? "新建主题" : "新建子主题", isPresented: $showNewTopic) {
            TextField("主题名称", text: $newTopicName)
            Button("创建") {
                store.createTopic(newTopicName, parentID: newTopicParentID)
                newTopicName = ""
                newTopicParentID = nil
            }
            Button("取消", role: .cancel) { newTopicParentID = nil }
        }
        .alert("重命名主题", isPresented: Binding(
            get: { renamingTopic != nil },
            set: { if !$0 { renamingTopic = nil } }
        )) {
            TextField("主题名称", text: $renameTopicName)
            Button("保存") {
                if let topic = renamingTopic { store.renameTopic(topic.id, name: renameTopicName) }
                renamingTopic = nil
            }
            Button("取消", role: .cancel) { renamingTopic = nil }
        }
        .alert("删除虚拟主题？", isPresented: Binding(
            get: { deletingTopic != nil },
            set: { if !$0 { deletingTopic = nil } }
        )) {
            Button("删除", role: .destructive) {
                if let topic = deletingTopic {
                    store.deleteTopic(topic.id)
                    if let selectedTopicID,
                       !store.data.topics.contains(where: { $0.id == selectedTopicID }) {
                        self.selectedTopicID = nil
                    }
                }
                deletingTopic = nil
            }
            Button("取消", role: .cancel) { deletingTopic = nil }
        } message: {
            Text("将删除“\(deletingTopic?.name ?? "")”、子主题及其虚拟关联，不会删除原始文档、批注或笔记。")
        }
        .sheet(isPresented: $showRecommendations) { recommendationSheet }
        .sheet(isPresented: $showWebImport) { webImportSheet }
    }

    private var directoryContent: some View {
        Group {
            TextField("搜索文件名、正文或主题", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal, 12)
            HStack {
                Button("导入文件", systemImage: "plus") { importFiles() }.buttonStyle(.borderedProminent)
                Button("导入目录") { importFolder() }
                Button("网页", systemImage: "globe") {
                    webImportError = nil
                    showWebImport = true
                }
                Spacer()
            }.padding(.horizontal, 10).padding(.top, 10)
            if store.data.documents.contains(where: PaperNamingService.needsRefinement) {
                HStack {
                    if isRenamingPapers {
                        ProgressView().controlSize(.small)
                        Text("正在整理论文名…").font(.caption)
                    } else {
                        Button("整理论文名", systemImage: "textformat") { Task { await refinePaperNames() } }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .help("优先在本机提取；失败时只向已配置模型发送标题与作者候选区")
                    }
                    Spacer()
                }.padding(.horizontal, 10).padding(.bottom, 6)
            }
            HStack {
                Text("知识目录").font(.caption.bold()).foregroundStyle(.secondary)
                Spacer()
                Button {
                    newTopicParentID = nil
                    showNewTopic = true
                } label: {
                    Image(systemName: "folder.badge.plus")
                }
                .buttonStyle(.plain)
                .help("新建主题目录")
            }
                .padding(.horizontal, 12)
            if treeNodes.isEmpty {
                ContentUnavailableView(query.isEmpty ? "还没有资料" : "没有匹配结果",
                                       systemImage: query.isEmpty ? "folder" : "magnifyingglass")
            } else {
                List {
                    OutlineGroup(treeNodes, children: \.children) { node in treeRow(node) }
                }.listStyle(.sidebar)
            }
            if !importMessage.isEmpty { Text(importMessage).font(.caption2).foregroundStyle(.secondary).padding(8).lineLimit(2) }
        }
    }

    private var treeNodes: [LibraryTreeNode] {
        let topics = store.data.topics
        let knownTopicIDs = Set(topics.map(\.id))
        let roots = topics.filter { $0.parentId == nil || !knownTopicIDs.contains($0.parentId!) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        let matchingDocumentIDs: Set<UUID>? = query.isEmpty
            ? nil
            : Set(store.search(query, topicID: nil).map(\.id))
        var result = roots.compactMap {
            topicNode($0, matchingDocumentIDs: matchingDocumentIDs, includeAll: false, visited: [])
        }
        let linkedIDs = Set(store.data.documentTopics.map(\.documentId))
        let unclassified = store.data.documents
            .filter { !linkedIDs.contains($0.id) && (matchingDocumentIDs?.contains($0.id) ?? true) }
            .sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
        if !unclassified.isEmpty {
            result.append(LibraryTreeNode(
                id: "unclassified",
                kind: .unclassified,
                title: "未分类",
                subtitle: "\(unclassified.count)",
                children: unclassified.map { documentNode($0, parentKey: "unclassified", topicID: nil) }
            ))
        }
        return result
    }

    private func topicNode(_ topic: Topic, matchingDocumentIDs: Set<UUID>?, includeAll: Bool,
                           visited: Set<UUID>) -> LibraryTreeNode? {
        guard !visited.contains(topic.id) else { return nil }
        let topicMatches = !query.isEmpty && topic.name.localizedCaseInsensitiveContains(query)
        let showAll = includeAll || topicMatches
        var nextVisited = visited
        nextVisited.insert(topic.id)
        let childTopics = store.data.topics
            .filter { $0.parentId == topic.id }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            .compactMap { topicNode($0, matchingDocumentIDs: matchingDocumentIDs, includeAll: showAll, visited: nextVisited) }
        let linkedIDs = Set(store.data.documentTopics.filter { $0.topicId == topic.id }.map(\.documentId))
        let documents = store.data.documents
            .filter { linkedIDs.contains($0.id) && (showAll || matchingDocumentIDs?.contains($0.id) ?? true) }
            .sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
        guard query.isEmpty || topicMatches || !childTopics.isEmpty || !documents.isEmpty else { return nil }
        return LibraryTreeNode(
            id: "topic-\(topic.id.uuidString)",
            kind: .topic(topic.id),
            title: topic.name,
            subtitle: "\(store.documents(for: topic.id).count)",
            children: childTopics + documents.map { documentNode($0, parentKey: topic.id.uuidString, topicID: topic.id) }
        )
    }

    private func documentNode(_ document: KnowledgeDocument, parentKey: String, topicID: UUID?) -> LibraryTreeNode {
        LibraryTreeNode(
            id: "\(parentKey)-document-\(document.id.uuidString)",
            kind: .document(document.id, topicID: topicID),
            title: document.displayTitle,
            subtitle: ByteCountFormatter.string(fromByteCount: document.size, countStyle: .file),
            children: nil
        )
    }

    @ViewBuilder private func treeRow(_ node: LibraryTreeNode) -> some View {
        switch node.kind {
        case .topic(let topicID):
            HStack(spacing: 7) {
                Image(systemName: "folder.fill").foregroundStyle(.tint)
                Text(node.title).lineLimit(1)
                Spacer()
                if let subtitle = node.subtitle { Text(subtitle).font(.caption2).foregroundStyle(.secondary) }
                Menu {
                    Button("新建子主题…", systemImage: "folder.badge.plus") {
                        newTopicParentID = topicID
                        newTopicName = ""
                        showNewTopic = true
                    }
                    Button("重命名…", systemImage: "pencil") {
                        guard let topic = store.data.topics.first(where: { $0.id == topicID }) else { return }
                        renameTopicName = topic.name
                        renamingTopic = topic
                    }
                    Divider()
                    Button("删除…", systemImage: "trash", role: .destructive) {
                        deletingTopic = store.data.topics.first(where: { $0.id == topicID })
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .foregroundStyle(.secondary)
                        .frame(width: 18, height: 18)
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .help("管理主题")
            }
            .contentShape(Rectangle())
            .padding(.vertical, 2)
            .background(selectedTopicID == topicID ? Color.accentColor.opacity(0.12) : .clear,
                        in: RoundedRectangle(cornerRadius: 5))
            .onTapGesture { selectedTopicID = topicID }
            .onDrop(of: [.utf8PlainText], isTargeted: nil) {
                handleDocumentDrop($0, targetTopicID: topicID)
            }
        case .document(let documentID, let topicID):
            if let document = store.data.documents.first(where: { $0.id == documentID }) {
                HStack(spacing: 7) {
                    Image(systemName: document.extensionName == ".pdf" ? "doc.richtext" : "doc.text")
                    VStack(alignment: .leading, spacing: 1) {
                        Text(node.title).lineLimit(1)
                        if let subtitle = node.subtitle {
                            Text(subtitle).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Image(systemName: "line.3.horizontal")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .help("拖动到其他主题")
                }
                .contentShape(Rectangle())
                .padding(.vertical, 2)
                .background(currentDocument?.id == documentID ? Color.accentColor.opacity(0.10) : .clear,
                            in: RoundedRectangle(cornerRadius: 5))
                .onTapGesture { onOpen(document) }
                .onDrag {
                    NSItemProvider(object: LibraryDocumentDrag(
                        documentID: documentID,
                        sourceTopicID: topicID
                    ).encoded as NSString)
                }
                .contextMenu {
                    Button("打开", systemImage: "doc.text.magnifyingglass") { onOpen(document) }
                    if let topicID {
                        Button("从当前主题移除", systemImage: "folder.badge.minus") {
                            store.unlink(documentID: documentID, topicID: topicID)
                        }
                    }
                    let targets = store.data.topics
                        .filter { $0.id != topicID }
                        .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                    if !targets.isEmpty {
                        Menu("移动到主题", systemImage: "folder") {
                            ForEach(targets) { target in
                                Button(target.name) {
                                    _ = store.move(documentID: documentID, from: topicID, to: target.id)
                                }
                            }
                        }
                    }
                    if topicID != nil {
                        Button("移至未分类", systemImage: "tray") {
                            _ = store.move(documentID: documentID, from: topicID, to: nil)
                        }
                    }
                }
            }
        case .unclassified:
            HStack(spacing: 7) {
                Image(systemName: "folder").foregroundStyle(.secondary)
                Text(node.title)
                Spacer()
                if let subtitle = node.subtitle { Text(subtitle).font(.caption2).foregroundStyle(.secondary) }
            }
            .padding(.vertical, 2)
            .contentShape(Rectangle())
            .onDrop(of: [.utf8PlainText], isTargeted: nil) {
                handleDocumentDrop($0, targetTopicID: nil)
            }
        }
    }

    private func handleDocumentDrop(_ providers: [NSItemProvider], targetTopicID: UUID?) -> Bool {
        guard let provider = providers.first(where: { $0.canLoadObject(ofClass: NSString.self) }) else {
            return false
        }
        provider.loadObject(ofClass: NSString.self) { value, _ in
            guard let encoded = value as? String,
                  let drag = LibraryDocumentDrag(encoded) else { return }
            DispatchQueue.main.async {
                _ = store.move(
                    documentID: drag.documentID,
                    from: drag.sourceTopicID,
                    to: targetTopicID
                )
            }
        }
        return true
    }

    private func importFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
        panel.allowedContentTypes = ["pdf", "html", "txt", "md", "doc", "docx"]
            .compactMap { UTType(filenameExtension: $0) }
        if panel.runModal() == .OK { performImport(panel.urls) }
    }

    private func importFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false
        if panel.runModal() == .OK { performImport(DocumentExtractor.importableFiles(from: panel.urls)) }
    }

    private func performImport(_ urls: [URL]) {
        let before = Set(store.data.documents.map(\.id))
        completeImport(before: before, messages: store.importFiles(urls))
    }

    private func completeImport(before: Set<UUID>, messages: [String], presentRecommendations: Bool = true) {
        importMessage = messages.joined(separator: " · ")
        recommendedDocuments = store.data.documents.filter { !before.contains($0.id) }
        selectedRecommendations = Set(recommendedDocuments.flatMap { document in
            store.recommendTopics(for: document).map { "\(document.id.uuidString):\($0.name)" }
        })
        if presentRecommendations {
            showRecommendations = !recommendedDocuments.isEmpty
        }
    }

    private func importWebPage() async {
        isImportingWeb = true
        webImportError = nil
        defer { isImportingWeb = false }
        do {
            let page = try await WebPageImporter.fetch(from: webURLText)
            let before = Set(store.data.documents.map(\.id))
            let messages = store.importWebPage(page.content, sourceURL: page.sourceURL)
            completeImport(before: before, messages: messages, presentRecommendations: false)
            if store.data.documents.contains(where: { !before.contains($0.id) }) {
                showWebImport = false
                webURLText = ""
                DispatchQueue.main.async {
                    showRecommendations = !recommendedDocuments.isEmpty
                }
            } else {
                webImportError = messages.joined(separator: " · ")
            }
        } catch {
            webImportError = error.localizedDescription
        }
    }

    private var webImportSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("导入网页").font(.title2.bold())
            Text("网页将以 HTML 原文保存，正文可阅读、检索并用于 AI 问答。")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("https://example.com/article", text: $webURLText)
                .textFieldStyle(.roundedBorder)
                .disabled(isImportingWeb)
                .onSubmit { Task { await importWebPage() } }
            if let webImportError {
                Text(webImportError).font(.caption).foregroundStyle(.red)
            }
            HStack {
                if isImportingWeb {
                    ProgressView().controlSize(.small)
                    Text("正在下载并提取正文…").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("取消") { showWebImport = false }
                    .disabled(isImportingWeb)
                Button("导入") { Task { await importWebPage() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(isImportingWeb || webURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(22)
        .frame(width: 520)
    }

    @MainActor private func refinePaperNames() async {
        let documents = store.data.documents.filter(PaperNamingService.needsRefinement)
        guard !documents.isEmpty else { return }
        isRenamingPapers = true
        importMessage = "正在本地整理 \(documents.count) 篇论文名称，必要时使用模型…"
        var updated = 0
        var failures: [String] = []
        var unresolved = 0
        for document in documents {
            do {
                if let name = try await PaperNamingService.suggestName(
                    document: document,
                    sourceURL: store.storedURL(for: document),
                    extracted: store.extractedContent(for: document.id),
                    settings: settings
                ), name != document.displayTitle {
                    store.updateDocumentDisplayName(document.id, displayName: name)
                    updated += 1
                } else {
                    unresolved += 1
                }
            } catch {
                failures.append(document.name)
            }
        }
        isRenamingPapers = false
        let unresolvedText = unresolved > 0 ? "；\(unresolved) 篇未能可靠识别" : ""
        let failureText = failures.isEmpty ? "" : "；\(failures.count) 篇模型调用失败"
        importMessage = "已更新 \(updated) 篇论文的虚拟名称\(unresolvedText)\(failureText)"
    }

    private var recommendationSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("推荐主题").font(.title2.bold())
            Text("根据文件名和正文关键词在本机推荐，确认后才建立关联。").font(.caption).foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 15) {
                    ForEach(recommendedDocuments) { document in
                        VStack(alignment: .leading, spacing: 7) {
                            Text(document.displayTitle).font(.headline)
                            ForEach(store.recommendTopics(for: document)) { recommendation in
                                let key = "\(document.id.uuidString):\(recommendation.name)"
                                Toggle(isOn: Binding(get: { selectedRecommendations.contains(key) }, set: { checked in
                                    if checked { selectedRecommendations.insert(key) } else { selectedRecommendations.remove(key) }
                                })) {
                                    VStack(alignment: .leading) { Text(recommendation.name); Text(recommendation.reason).font(.caption).foregroundStyle(.secondary) }
                                }.toggleStyle(.checkbox)
                            }
                        }.padding(.bottom, 7)
                    }
                }
            }
            HStack {
                Spacer(); Button("稍后处理") { showRecommendations = false }
                Button("应用所选主题") {
                    for document in recommendedDocuments {
                        let selected = store.recommendTopics(for: document).filter { selectedRecommendations.contains("\(document.id.uuidString):\($0.name)") }
                        store.applyRecommendations(selected, documentID: document.id)
                    }
                    showRecommendations = false
                }.buttonStyle(.borderedProminent)
            }
        }.padding(22).frame(width: 620, height: 500)
    }
}

private struct NotesLibraryView: View {
    @EnvironmentObject private var store: KnowledgeStore
    var onOpenAnnotation: (KnowledgeAnnotation) -> Void

    @State private var editingSummaryNote: SummaryNote?
    @State private var showSummaryEditor = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("笔记系统").font(.caption.bold()).foregroundStyle(.secondary)
                Spacer()
                Button { editingSummaryNote = nil; showSummaryEditor = true } label: {
                    Image(systemName: "square.and.pencil")
                }.buttonStyle(.plain).help("新建总结笔记")
            }.padding(.horizontal, 12).padding(.vertical, 6)
            if store.data.annotations.isEmpty && store.data.summaryNotes.isEmpty {
                ContentUnavailableView("还没有笔记", systemImage: "note.text",
                                       description: Text("可在文档中添加批注，或创建一篇总结笔记。"))
            } else {
                List {
                    Section("注释类笔记 · \(store.data.annotations.count)") {
                        ForEach(store.data.annotations.sorted { $0.updatedAt > $1.updatedAt }) { annotation in
                            Button { onOpenAnnotation(annotation) } label: {
                                annotationRow(annotation)
                            }.buttonStyle(.plain)
                        }
                    }
                    Section("总结类笔记 · \(store.data.summaryNotes.count)") {
                        ForEach(store.data.summaryNotes.sorted { $0.updatedAt > $1.updatedAt }) { note in
                            HStack(spacing: 6) {
                                VStack(alignment: .leading, spacing: 5) {
                                    Button { editingSummaryNote = note; showSummaryEditor = true } label: {
                                        VStack(alignment: .leading, spacing: 3) {
                                        Text(note.title).lineLimit(1)
                                        HStack {
                                            let body = store.summaryNoteContent(for: note)
                                            Text(body.isEmpty ? "暂无正文" : body).lineLimit(1)
                                            if !note.annotationIDs.isEmpty { Text("· 关联 \(note.annotationIDs.count) 条") }
                                        }.font(.caption2).foregroundStyle(.secondary)
                                        }.frame(maxWidth: .infinity, alignment: .leading)
                                    }.buttonStyle(.plain)
                                    ForEach(linkedAnnotations(note).prefix(3)) { annotation in
                                        Button { onOpenAnnotation(annotation) } label: {
                                            Label(String((annotation.note.isEmpty ? annotation.quote : annotation.note).prefix(42)),
                                                  systemImage: "arrow.turn.down.right")
                                                .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                        }.buttonStyle(.plain).help("跳转到关联批注")
                                    }
                                }
                                Button(role: .destructive) { store.deleteSummaryNote(note.id) } label: {
                                    Image(systemName: "trash")
                                }.buttonStyle(.borderless).help("删除总结笔记")
                            }
                        }
                    }
                }.listStyle(.sidebar)
            }
        }
        .sheet(isPresented: $showSummaryEditor) {
            SummaryNoteEditor(note: editingSummaryNote) { title, content, annotationIDs in
                if let editingSummaryNote {
                    store.updateSummaryNote(editingSummaryNote.id, title: title, content: content,
                                            annotationIDs: annotationIDs)
                } else {
                    store.createSummaryNote(title: title, content: content, annotationIDs: annotationIDs)
                }
                showSummaryEditor = false
            } onCancel: {
                showSummaryEditor = false
            }
        }
    }

    private func annotationRow(_ annotation: KnowledgeAnnotation) -> some View {
        let document = store.data.documents.first(where: { $0.id == annotation.documentId })
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                Image(systemName: annotation.note.isEmpty ? "highlighter" : "text.bubble.fill")
                    .foregroundStyle(annotation.note.isEmpty ? .orange : .green)
                Text(document?.displayTitle ?? "已删除文档").lineLimit(1)
                Spacer()
                if let page = annotation.page { Text("P\(page)").font(.caption2).foregroundStyle(.secondary) }
            }
            Text(annotation.note.isEmpty ? annotation.quote : annotation.note).font(.caption).lineLimit(2)
                .foregroundStyle(.secondary)
        }.padding(.vertical, 3)
    }

    private func linkedAnnotations(_ note: SummaryNote) -> [KnowledgeAnnotation] {
        note.annotationIDs.compactMap { id in store.data.annotations.first(where: { $0.id == id }) }
    }
}

private struct SummaryNoteEditor: View {
    @EnvironmentObject private var store: KnowledgeStore
    let note: SummaryNote?
    let onSave: (String, String, [UUID]) -> Void
    let onCancel: () -> Void

    @State private var title: String
    @State private var content: String
    @State private var annotationIDs: Set<UUID>
    @State private var mode: Mode

    private enum Mode: String, CaseIterable, Identifiable {
        case preview = "预览"
        case edit = "编辑"
        var id: String { rawValue }
    }

    init(note: SummaryNote?, onSave: @escaping (String, String, [UUID]) -> Void,
         onCancel: @escaping () -> Void) {
        self.note = note
        self.onSave = onSave
        self.onCancel = onCancel
        _title = State(initialValue: note?.title ?? "")
        _content = State(initialValue: note.map { value in
            // 已有笔记的正文会在 KnowledgeStore.load 时从对应 .md 文件同步到缓存。
            value.content
        } ?? "")
        _annotationIDs = State(initialValue: Set(note?.annotationIDs ?? []))
        _mode = State(initialValue: note == nil ? .edit : .preview)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(note == nil ? "新建总结笔记" : "编辑总结笔记").font(.title2.bold())
            HStack {
                Picker("显示方式", selection: $mode) {
                    ForEach(Mode.allCases) { item in Text(item.rawValue).tag(item) }
                }.pickerStyle(.segmented).labelsHidden().frame(width: 150)
                Spacer()
                if let note, let url = store.summaryNoteURL(for: note) {
                    Button("在 Finder 中显示", systemImage: "folder") {
                        NSWorkspace.shared.activateFileViewerSelecting([url])
                    }.buttonStyle(.borderless)
                }
            }
            if mode == .edit {
                TextField("标题", text: $title).textFieldStyle(.roundedBorder)
                TextEditor(text: $content).font(.system(.body, design: .monospaced)).frame(minHeight: 190)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(.separator))
            } else {
                ScrollView {
                    ChatMarkdownView(markdown: KnowledgeStore.summaryNoteMarkdown(title: title, content: content))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
                .frame(minHeight: 230)
                .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(.separator))
            }
            Text("关联注释类笔记").font(.headline)
            if store.data.annotations.isEmpty {
                Text("暂无可关联批注").font(.caption).foregroundStyle(.secondary)
            } else {
                List(store.data.annotations.sorted { $0.updatedAt > $1.updatedAt }) { annotation in
                    Toggle(isOn: binding(for: annotation.id)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(documentTitle(annotation.documentId)).font(.callout).lineLimit(1)
                            Text(annotation.note.isEmpty ? annotation.quote : annotation.note)
                                .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }.toggleStyle(.checkbox)
                }.frame(minHeight: 150)
            }
            HStack {
                Spacer()
                Button("取消", action: onCancel)
                Button("保存") { onSave(title, content, Array(annotationIDs)) }
                    .buttonStyle(.borderedProminent)
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }.padding(22).frame(width: 680, height: 680)
    }

    private func binding(for id: UUID) -> Binding<Bool> {
        Binding(get: { annotationIDs.contains(id) }, set: { selected in
            if selected { annotationIDs.insert(id) } else { annotationIDs.remove(id) }
        })
    }

    private func documentTitle(_ id: UUID) -> String {
        store.data.documents.first(where: { $0.id == id })?.displayTitle ?? "已删除文档"
    }
}

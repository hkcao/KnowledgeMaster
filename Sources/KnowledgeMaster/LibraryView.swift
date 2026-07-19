import SwiftUI
import UniformTypeIdentifiers

private struct LibraryTreeNode: Identifiable {
    enum Kind {
        case topic(UUID)
        case document(UUID)
        case unclassified
    }

    var id: String
    var kind: Kind
    var title: String
    var subtitle: String?
    var children: [LibraryTreeNode]?
}

struct LibraryView: View {
    @EnvironmentObject private var store: KnowledgeStore
    @Binding var selectedTopicID: UUID?
    @Binding var currentDocument: KnowledgeDocument?
    var onOpen: (KnowledgeDocument) -> Void

    @State private var query = ""
    @State private var showNewTopic = false
    @State private var newTopicName = ""
    @State private var importMessage = ""
    @State private var recommendedDocuments: [KnowledgeDocument] = []
    @State private var selectedRecommendations: Set<String> = []
    @State private var showRecommendations = false
    @State private var isDropTarget = false

    var body: some View {
        VStack(spacing: 0) {
            HStack { Label("知屿", systemImage: "books.vertical.fill").font(.title3.bold()); Spacer(); SettingsLink { Image(systemName: "gearshape") } }
                .padding(14)
            TextField("搜索文件名、正文或主题", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal, 12)
            HStack {
                Button("导入文件", systemImage: "plus") { importFiles() }.buttonStyle(.borderedProminent)
                Button("导入目录") { importFolder() }
            }.padding(10)
            HStack { Text("知识目录").font(.caption.bold()).foregroundStyle(.secondary); Spacer(); Button { showNewTopic = true } label: { Image(systemName: "folder.badge.plus") }.buttonStyle(.plain).help("新建主题目录") }
                .padding(.horizontal, 12)
            if treeNodes.isEmpty {
                ContentUnavailableView(query.isEmpty ? "还没有资料" : "没有匹配结果",
                                       systemImage: query.isEmpty ? "folder" : "magnifyingglass")
            } else {
                List {
                    OutlineGroup(treeNodes, children: \.children) { node in
                        treeRow(node)
                    }
                }
                .listStyle(.sidebar)
            }
            if !importMessage.isEmpty { Text(importMessage).font(.caption2).foregroundStyle(.secondary).padding(8).lineLimit(2) }
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
        .alert("新建主题", isPresented: $showNewTopic) {
            TextField("主题名称", text: $newTopicName)
            Button("创建") { store.createTopic(newTopicName); newTopicName = "" }
            Button("取消", role: .cancel) {}
        }
        .sheet(isPresented: $showRecommendations) { recommendationSheet }
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
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        if !unclassified.isEmpty {
            result.append(LibraryTreeNode(
                id: "unclassified",
                kind: .unclassified,
                title: "未分类",
                subtitle: "\(unclassified.count)",
                children: unclassified.map { documentNode($0, parentKey: "unclassified") }
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
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        guard query.isEmpty || topicMatches || !childTopics.isEmpty || !documents.isEmpty else { return nil }
        return LibraryTreeNode(
            id: "topic-\(topic.id.uuidString)",
            kind: .topic(topic.id),
            title: topic.name,
            subtitle: "\(store.documents(for: topic.id).count)",
            children: childTopics + documents.map { documentNode($0, parentKey: topic.id.uuidString) }
        )
    }

    private func documentNode(_ document: KnowledgeDocument, parentKey: String) -> LibraryTreeNode {
        LibraryTreeNode(
            id: "\(parentKey)-document-\(document.id.uuidString)",
            kind: .document(document.id),
            title: document.name,
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
            }
            .contentShape(Rectangle())
            .padding(.vertical, 2)
            .background(selectedTopicID == topicID ? Color.accentColor.opacity(0.12) : .clear,
                        in: RoundedRectangle(cornerRadius: 5))
            .onTapGesture { selectedTopicID = topicID }
            .dropDestination(for: String.self) { values, _ in
                guard let value = values.first, let documentID = UUID(uuidString: value) else { return false }
                store.link(documentID: documentID, topicID: topicID)
                return true
            }
        case .document(let documentID):
            if let document = store.data.documents.first(where: { $0.id == documentID }) {
                Button { onOpen(document) } label: {
                    HStack(spacing: 7) {
                        Image(systemName: document.extensionName == ".pdf" ? "doc.richtext" : "doc.text")
                        VStack(alignment: .leading, spacing: 1) {
                            Text(node.title).lineLimit(1)
                            if let subtitle = node.subtitle { Text(subtitle).font(.caption2).foregroundStyle(.secondary) }
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                    .padding(.vertical, 2)
                    .background(currentDocument?.id == documentID ? Color.accentColor.opacity(0.10) : .clear,
                                in: RoundedRectangle(cornerRadius: 5))
                }
                .buttonStyle(.plain)
                .draggable(documentID.uuidString)
            }
        case .unclassified:
            HStack(spacing: 7) {
                Image(systemName: "folder").foregroundStyle(.secondary)
                Text(node.title)
                Spacer()
                if let subtitle = node.subtitle { Text(subtitle).font(.caption2).foregroundStyle(.secondary) }
            }
            .padding(.vertical, 2)
        }
    }

    private func importFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
        panel.allowedContentTypes = [.pdf, .html, .plainText, UTType(filenameExtension: "md")!]
        if panel.runModal() == .OK { performImport(panel.urls) }
    }

    private func importFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false
        if panel.runModal() == .OK { performImport(DocumentExtractor.importableFiles(from: panel.urls)) }
    }

    private func performImport(_ urls: [URL]) {
        let before = Set(store.data.documents.map(\.id))
        importMessage = store.importFiles(urls).joined(separator: " · ")
        recommendedDocuments = store.data.documents.filter { !before.contains($0.id) }
        selectedRecommendations = Set(recommendedDocuments.flatMap { document in
            store.recommendTopics(for: document).map { "\(document.id.uuidString):\($0.name)" }
        })
        showRecommendations = !recommendedDocuments.isEmpty
    }

    private var recommendationSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("推荐主题").font(.title2.bold())
            Text("根据文件名和正文关键词在本机推荐，确认后才建立关联。").font(.caption).foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 15) {
                    ForEach(recommendedDocuments) { document in
                        VStack(alignment: .leading, spacing: 7) {
                            Text(document.name).font(.headline)
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

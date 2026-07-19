import SwiftUI
import UniformTypeIdentifiers

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
            HStack { Text("主题视图").font(.caption.bold()).foregroundStyle(.secondary); Spacer(); Button { showNewTopic = true } label: { Image(systemName: "plus") }.buttonStyle(.plain) }
                .padding(.horizontal, 12)
            List(selection: $selectedTopicID) {
                Text("全部资料").tag(UUID?.none)
                ForEach(store.data.topics) { topic in
                    HStack { Image(systemName: "diamond"); Text(topic.name); Spacer(); Text("\(store.documents(for: topic.id).count)").foregroundStyle(.secondary) }
                        .tag(Optional(topic.id))
                        .dropDestination(for: String.self) { values, _ in
                            guard let value = values.first, let documentID = UUID(uuidString: value) else { return false }
                            store.link(documentID: documentID, topicID: topic.id); return true
                        }
                }
            }.frame(maxHeight: 220)
            HStack { Text(selectedTopicID.flatMap { id in store.data.topics.first(where: { $0.id == id })?.name } ?? "全部资料").font(.caption.bold()); Spacer(); Text("\(visibleDocuments.count)").font(.caption) }
                .padding(.horizontal, 12)
            List(visibleDocuments, selection: Binding(get: { currentDocument?.id }, set: { id in if let id, let document = store.data.documents.first(where: { $0.id == id }) { onOpen(document) } })) { document in
                HStack {
                    Image(systemName: document.extensionName == ".pdf" ? "doc.richtext" : "doc.text")
                    VStack(alignment: .leading) { Text(document.name).lineLimit(1); Text(ByteCountFormatter.string(fromByteCount: document.size, countStyle: .file)).font(.caption2).foregroundStyle(.secondary) }
                }.tag(document.id).draggable(document.id.uuidString)
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

    private var visibleDocuments: [KnowledgeDocument] {
        query.isEmpty ? store.documents(for: selectedTopicID) : store.search(query, topicID: selectedTopicID)
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

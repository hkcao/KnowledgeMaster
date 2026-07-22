import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: KnowledgeStore
    @EnvironmentObject private var settings: AppSettings
    @State private var selectedTopicID: UUID?
    @State private var currentDocument: KnowledgeDocument?
    @State private var tabs: [KnowledgeDocument] = []
    @State private var chatDraft = ""
    @State private var quote: ReaderQuote?
    @State private var focusedAnnotationID: UUID?
    @State private var lastVisibleChatPlacement: ChatPlacement = .right
    @State private var readerLayoutRevision = UUID()

    var body: some View {
        GeometryReader { geometry in
            layout
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .frame(minWidth: 900, minHeight: 700)
        .alert("知识库错误", isPresented: Binding(get: { store.lastError != nil }, set: { if !$0 { store.lastError = nil } })) {
            Button("好") { store.lastError = nil }
        } message: { Text(store.lastError ?? "") }
        .onChange(of: settings.chatPlacement) { oldValue, newValue in
            if oldValue != .hidden && newValue == .hidden { lastVisibleChatPlacement = oldValue }
            readerLayoutRevision = UUID()
        }
        .onChange(of: settings.libraryVisible) { _, _ in readerLayoutRevision = UUID() }
    }

    private var layout: some View {
        HSplitView {
            if settings.libraryVisible && settings.chatPlacement == .sidebar {
                VSplitView {
                    libraryPane.frame(minWidth: 300, minHeight: 280)
                    chatPane.frame(minWidth: 320, idealHeight: 400)
                }
                .frame(idealWidth: 380)
            } else if settings.libraryVisible {
                libraryPane.frame(idealWidth: 280, maxHeight: .infinity)
            } else if settings.chatPlacement == .sidebar {
                chatPane.frame(idealWidth: 380, maxHeight: .infinity)
            }
            VSplitView {
                readerPane.frame(minWidth: 480, minHeight: 320, maxHeight: .infinity)
                if settings.chatPlacement == .bottom {
                    chatPane.frame(minWidth: 480, idealHeight: 340)
                }
            }
            if settings.chatPlacement == .right {
                chatPane.frame(idealWidth: 380, maxHeight: .infinity)
            }
        }
    }

    private var libraryPane: some View {
        LibraryView(selectedTopicID: $selectedTopicID, currentDocument: $currentDocument,
                    onOpen: open, onOpenAnnotation: openAnnotation)
    }

    private var chatPane: some View {
        ChatView(currentDocument: $currentDocument, draft: $chatDraft, quote: $quote)
    }

    private var readerPane: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Button {
                    settings.libraryVisible.toggle()
                } label: {
                    Image(systemName: "sidebar.left")
                }
                .buttonStyle(.borderless)
                .fixedSize()
                .help(settings.libraryVisible ? "隐藏资料侧边栏" : "显示资料侧边栏")
                Divider().frame(height: 18)
                ScrollView(.horizontal) {
                    HStack(spacing: 3) {
                        ForEach(tabs) { document in
                            HStack(spacing: 6) {
                                Button(document.displayTitle) { currentDocument = document }.buttonStyle(.plain).lineLimit(1)
                                Button { close(document) } label: { Image(systemName: "xmark").font(.caption2) }.buttonStyle(.plain)
                            }
                            .padding(.horizontal, 9).padding(.vertical, 6)
                            .background(currentDocument?.id == document.id ? Color(nsColor: .windowBackgroundColor) : .clear,
                                        in: RoundedRectangle(cornerRadius: 6))
                        }
                    }.padding(.horizontal, 7)
                }
                .scrollIndicators(.hidden)
                .frame(minWidth: 0, maxWidth: .infinity)
                if settings.chatPlacement == .hidden {
                    Divider().frame(height: 18)
                    Button {
                        showChat()
                    } label: {
                        Label("知识问答", systemImage: "sparkles")
                    }
                    .buttonStyle(.borderless)
                    .fixedSize()
                    .layoutPriority(1)
                    .help("恢复知识问答")
                    .padding(.trailing, 8)
                }
            }
            .frame(height: 38)
            .background(.quaternary)
            ReaderView(document: currentDocument, focusedAnnotationID: focusedAnnotationID,
                       layoutRevision: readerLayoutRevision) { selectedQuote in
                quote = selectedQuote
                if settings.chatPlacement == .hidden { showChat() }
            }
        }
    }

    private func showChat() {
        settings.chatPlacement = lastVisibleChatPlacement == .hidden ? .right : lastVisibleChatPlacement
    }

    private func open(_ document: KnowledgeDocument) {
        currentDocument = document
        focusedAnnotationID = nil
        if !tabs.contains(where: { $0.id == document.id }) { tabs.append(document) }
    }

    private func openAnnotation(_ annotation: KnowledgeAnnotation) {
        guard let document = store.data.documents.first(where: { $0.id == annotation.documentId }) else { return }
        currentDocument = document
        if !tabs.contains(where: { $0.id == document.id }) { tabs.append(document) }
        focusedAnnotationID = nil
        DispatchQueue.main.async { focusedAnnotationID = annotation.id }
    }

    private func close(_ document: KnowledgeDocument) {
        let index = tabs.firstIndex(where: { $0.id == document.id }) ?? 0
        tabs.removeAll { $0.id == document.id }
        if currentDocument?.id == document.id { currentDocument = tabs.isEmpty ? nil : tabs[min(index, tabs.count - 1)] }
    }
}

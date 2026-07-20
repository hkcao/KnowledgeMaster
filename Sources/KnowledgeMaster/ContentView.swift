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

    var body: some View {
        GeometryReader { geometry in
            layout
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .frame(minWidth: 900, minHeight: 700)
        .alert("知识库错误", isPresented: Binding(get: { store.lastError != nil }, set: { if !$0 { store.lastError = nil } })) {
            Button("好") { store.lastError = nil }
        } message: { Text(store.lastError ?? "") }
    }

    @ViewBuilder private var layout: some View {
        switch settings.chatPlacement {
        case .right:
            HSplitView {
                libraryPane.frame(idealWidth: 280, maxHeight: .infinity)
                readerPane.frame(minWidth: 480, maxHeight: .infinity)
                chatPane.frame(idealWidth: 380, maxHeight: .infinity)
            }
        case .bottom:
            HSplitView {
                libraryPane.frame(idealWidth: 280, maxHeight: .infinity)
                VSplitView {
                    readerPane.frame(minWidth: 480, minHeight: 320)
                    chatPane.frame(minWidth: 480, idealHeight: 340)
                }
            }
        case .sidebar:
            HSplitView {
                VSplitView {
                    libraryPane.frame(minWidth: 300, minHeight: 280)
                    chatPane.frame(minWidth: 320, idealHeight: 400)
                }.frame(idealWidth: 380)
                readerPane.frame(minWidth: 520, maxHeight: .infinity)
            }
        case .hidden:
            HSplitView {
                libraryPane.frame(idealWidth: 280, maxHeight: .infinity)
                readerPane.frame(minWidth: 560, maxHeight: .infinity)
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
                }.scrollIndicators(.hidden)
                chatPlacementMenu.padding(.trailing, 8)
            }
            .frame(height: 38)
            .background(.quaternary)
            ReaderView(document: currentDocument, focusedAnnotationID: focusedAnnotationID) { selectedQuote in
                quote = selectedQuote
                if settings.chatPlacement == .hidden { settings.chatPlacement = .right }
            }
        }
    }

    private var chatPlacementMenu: some View {
        Menu {
            ForEach(ChatPlacement.allCases) { placement in
                Button {
                    settings.chatPlacement = placement
                } label: {
                    Label(placement.name, systemImage: placement.icon)
                }
            }
        } label: {
            Label("知识问答", systemImage: settings.chatPlacement.icon).labelStyle(.iconOnly)
        }
        .menuStyle(.borderlessButton)
        .help("知识问答位置：\(settings.chatPlacement.name)")
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

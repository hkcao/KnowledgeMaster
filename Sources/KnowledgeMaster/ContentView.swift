import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: KnowledgeStore
    @State private var selectedTopicID: UUID?
    @State private var currentDocument: KnowledgeDocument?
    @State private var tabs: [KnowledgeDocument] = []
    @State private var chatDraft = ""
    @State private var quote: ReaderQuote?

    var body: some View {
        GeometryReader { geometry in
            HSplitView {
                LibraryView(selectedTopicID: $selectedTopicID, currentDocument: $currentDocument, onOpen: open)
                    .frame(idealWidth: 260, maxHeight: .infinity)
                VStack(spacing: 0) {
                    if !tabs.isEmpty {
                        ScrollView(.horizontal) {
                            HStack(spacing: 3) {
                                ForEach(tabs) { document in
                                    HStack(spacing: 6) {
                                        Button(document.name) { currentDocument = document }.buttonStyle(.plain).lineLimit(1)
                                        Button { close(document) } label: { Image(systemName: "xmark").font(.caption2) }.buttonStyle(.plain)
                                    }
                                    .padding(.horizontal, 9).padding(.vertical, 6)
                                    .background(currentDocument?.id == document.id ? Color(nsColor: .windowBackgroundColor) : .clear,
                                                in: RoundedRectangle(cornerRadius: 6))
                                }
                            }.padding(.horizontal, 7)
                        }.scrollIndicators(.hidden).frame(height: 38).background(.quaternary)
                    }
                    ReaderView(document: currentDocument) { selectedQuote, prompt in
                        quote = selectedQuote
                        chatDraft = prompt
                    }
                }.frame(minWidth: 480, maxHeight: .infinity)
                ChatView(currentDocument: $currentDocument, draft: $chatDraft, quote: $quote)
                    .frame(idealWidth: 380, maxHeight: .infinity)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .frame(minWidth: 1_180, minHeight: 720)
        .alert("知识库错误", isPresented: Binding(get: { store.lastError != nil }, set: { if !$0 { store.lastError = nil } })) {
            Button("好") { store.lastError = nil }
        } message: { Text(store.lastError ?? "") }
    }

    private func open(_ document: KnowledgeDocument) {
        currentDocument = document
        if !tabs.contains(where: { $0.id == document.id }) { tabs.append(document) }
    }

    private func close(_ document: KnowledgeDocument) {
        let index = tabs.firstIndex(where: { $0.id == document.id }) ?? 0
        tabs.removeAll { $0.id == document.id }
        if currentDocument?.id == document.id { currentDocument = tabs.isEmpty ? nil : tabs[min(index, tabs.count - 1)] }
    }
}

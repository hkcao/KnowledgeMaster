import SwiftUI

struct AgentTraceDisclosure: View {
    let events: [AgentTraceEvent]
    let isRunning: Bool
    @State private var isExpanded: Bool

    init(events: [AgentTraceEvent], isRunning: Bool, initiallyExpanded: Bool) {
        self.events = events
        self.isRunning = isRunning
        _isExpanded = State(initialValue: initiallyExpanded)
    }

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 9) {
                        ForEach(events) { event in
                            eventRow(event).id(event.id)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 8)
                }
                .frame(maxHeight: 220)
                .onChange(of: events.count) { _, _ in
                    guard isExpanded, let last = events.last else { return }
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        } label: {
            HStack(spacing: 7) {
                if isRunning { ProgressView().controlSize(.small) }
                else { Image(systemName: "list.bullet.rectangle").foregroundStyle(.secondary) }
                Text(isRunning ? "Agent 执行过程" : "执行过程")
                    .font(.caption.bold())
                Text("\(events.count) 项").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
    }

    @ViewBuilder private func eventRow(_ event: AgentTraceEvent) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon(for: event.kind))
                .foregroundStyle(color(for: event.kind))
                .frame(width: 15)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(event.title).font(.caption)
                    Spacer()
                    Text(event.createdAt.formatted(date: .omitted, time: .standard))
                        .font(.caption2).foregroundStyle(.tertiary)
                }
                if let detail = event.detail, !detail.isEmpty {
                    Text(detail).font(.caption2).foregroundStyle(.secondary)
                        .textSelection(.enabled).lineLimit(4)
                }
            }
        }
    }

    private func icon(for kind: AgentTraceKind) -> String {
        switch kind {
        case .status: "circle.dotted"
        case .tool: "wrench.and.screwdriver"
        case .file: "doc"
        case .warning: "exclamationmark.triangle"
        case .error: "xmark.circle"
        case .completed: "checkmark.circle.fill"
        }
    }

    private func color(for kind: AgentTraceKind) -> Color {
        switch kind {
        case .warning: .orange
        case .error: .red
        case .completed: .green
        default: .secondary
        }
    }
}

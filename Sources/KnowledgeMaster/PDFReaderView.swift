import SwiftUI
import PDFKit

private final class InteractivePDFView: PDFView {
    var onKnowledgeAnnotationClick: ((UUID) -> Void)?
    private var markerAnchors: [UUID: AnnotationRect] = [:]
    private var markerButtons: [UUID: NSButton] = [:]

    func updateAnnotationMarkers(_ annotations: [KnowledgeAnnotation]) {
        guard let document else { return }
        let values = annotations.compactMap { item -> (UUID, AnnotationRect, String)? in
            guard !item.note.isEmpty,
                  let anchor = PDFKnowledgeAnnotationRenderer.resolvedRects(for: item, in: document).last else {
                return nil
            }
            return (item.id, anchor, item.note)
        }
        markerAnchors = Dictionary(uniqueKeysWithValues: values.map { ($0.0, $0.1) })
        let ids = Set(markerAnchors.keys)
        for id in markerButtons.keys.filter({ !ids.contains($0) }) {
            markerButtons.removeValue(forKey: id)?.removeFromSuperview()
        }
        for (id, _, help) in values where markerButtons[id] == nil {
            let button = NSButton()
            button.isBordered = false
            button.imagePosition = .imageOnly
            button.image = NSImage(systemSymbolName: "text.bubble.fill", accessibilityDescription: "打开批注")
            button.contentTintColor = .systemGreen
            button.identifier = NSUserInterfaceItemIdentifier(id.uuidString)
            button.toolTip = help
            button.target = self
            button.action = #selector(annotationButtonClicked(_:))
            markerButtons[id] = button
        }
        positionAnnotationMarkers()
    }

    override func layout() {
        super.layout()
        positionAnnotationMarkers()
    }

    private func positionAnnotationMarkers() {
        guard let documentView else { return }
        for (id, anchor) in markerAnchors {
            guard let button = markerButtons[id],
                  let page = document?.page(at: anchor.page - 1) else { continue }
            if button.superview !== documentView {
                button.removeFromSuperview()
                documentView.addSubview(button)
            }
            let viewRect = convert(anchor.cgRect, from: page)
            let rect = documentView.convert(viewRect, from: self)
            let size: CGFloat = 18
            let x = min(rect.maxX + 4, documentView.bounds.maxX - size - 2)
            button.frame = CGRect(x: max(documentView.bounds.minX + 2, x),
                                  y: rect.midY - size / 2, width: size, height: size)
        }
    }

    @objc private func annotationButtonClicked(_ sender: NSButton) {
        guard let value = sender.identifier?.rawValue, let id = UUID(uuidString: value) else { return }
        onKnowledgeAnnotationClick?(id)
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if let page = page(for: point, nearest: false),
           let annotation = page.annotation(at: convert(point, to: page)),
           let id = KnowledgeAnnotationReference.id(fromPDFContents: annotation.contents) {
            onKnowledgeAnnotationClick?(id)
            return
        }
        super.mouseDown(with: event)
    }
}

struct PDFReaderView: NSViewRepresentable {
    var url: URL
    var annotations: [KnowledgeAnnotation]
    var focusedAnnotationID: UUID?
    var onSelection: (ReaderSelection?) -> Void
    var onAnnotationClick: (UUID) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onSelection: onSelection) }

    func makeNSView(context: Context) -> PDFView {
        let view = InteractivePDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = NSColor.windowBackgroundColor
        context.coordinator.attach(to: view)
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        context.coordinator.onSelection = onSelection
        (view as? InteractivePDFView)?.onKnowledgeAnnotationClick = onAnnotationClick
        if context.coordinator.url != url {
            context.coordinator.url = url
            view.document = PDFDocument(url: url)
        }
        context.coordinator.render(annotations: annotations, in: view)
        (view as? InteractivePDFView)?.updateAnnotationMarkers(annotations)
        context.coordinator.focus(annotationID: focusedAnnotationID, annotations: annotations, in: view)
    }

    final class Coordinator: NSObject {
        var onSelection: (ReaderSelection?) -> Void
        var url: URL?
        private weak var view: PDFView?
        private var observer: NSObjectProtocol?
        private var focusedAnnotationID: UUID?

        init(onSelection: @escaping (ReaderSelection?) -> Void) { self.onSelection = onSelection }
        deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }

        func attach(to view: PDFView) {
            self.view = view
            observer = NotificationCenter.default.addObserver(
                forName: Notification.Name.PDFViewSelectionChanged, object: view, queue: .main
            ) { [weak self] _ in self?.selectionChanged() }
        }

        private func selectionChanged() {
            guard let view, let selection = view.currentSelection,
                  let text = selection.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
                onSelection(nil)
                return
            }
            var viewBounds = CGRect.null
            let rects = selection.pages.compactMap { page -> AnnotationRect? in
                guard let document = view.document else { return nil }
                let pageIndex = document.index(for: page)
                let bounds = selection.bounds(for: page)
                viewBounds = viewBounds.union(view.convert(bounds, from: page))
                return AnnotationRect(page: pageIndex + 1, x: bounds.origin.x, y: bounds.origin.y,
                                      width: bounds.width, height: bounds.height)
            }
            let top = view.isFlipped ? viewBounds.minY : view.bounds.height - viewBounds.maxY
            onSelection(ReaderSelection(text: String(text.prefix(4_000)), page: rects.first?.page, rects: rects,
                                        anchorX: viewBounds.maxX, anchorY: top))
        }

        func render(annotations: [KnowledgeAnnotation], in view: PDFView) {
            guard let document = view.document else { return }
            PDFKnowledgeAnnotationRenderer.render(annotations, in: document, interactive: true)
        }

        func focus(annotationID: UUID?, annotations: [KnowledgeAnnotation], in view: PDFView) {
            guard let annotationID, focusedAnnotationID != annotationID,
                  let annotation = annotations.first(where: { $0.id == annotationID }),
                  let document = view.document,
                  let pageNumber = annotation.page ?? annotation.rects.first?.page,
                  let page = document.page(at: pageNumber - 1) else { return }
            focusedAnnotationID = annotationID
            if let rect = annotation.rects.first(where: { $0.page == pageNumber }) {
                view.go(to: PDFDestination(page: page, at: CGPoint(x: rect.x, y: rect.y + rect.height + 24)))
            } else {
                view.go(to: page)
            }
        }
    }
}

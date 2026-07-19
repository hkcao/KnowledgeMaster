import SwiftUI
import PDFKit

private final class InteractivePDFView: PDFView {
    var onKnowledgeAnnotationClick: ((UUID) -> Void)?

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
    }

    final class Coordinator: NSObject {
        var onSelection: (ReaderSelection?) -> Void
        var url: URL?
        private weak var view: PDFView?
        private var observer: NSObjectProtocol?

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
            for index in 0..<document.pageCount {
                guard let page = document.page(at: index) else { continue }
                for annotation in page.annotations where KnowledgeAnnotationReference.id(fromPDFContents: annotation.contents) != nil {
                    page.removeAnnotation(annotation)
                }
            }
            for item in annotations {
                var rects = item.rects
                if rects.isEmpty, let match = document.findString(item.quote, withOptions: [.caseInsensitive]).first,
                   let page = match.pages.first {
                    let pageIndex = document.index(for: page) + 1
                    if item.page == nil || item.page == pageIndex {
                        let bounds = match.bounds(for: page)
                        rects = [AnnotationRect(page: pageIndex, x: bounds.origin.x, y: bounds.origin.y,
                                                width: bounds.width, height: bounds.height)]
                    }
                }
                for rect in rects {
                    guard let page = document.page(at: rect.page - 1) else { continue }
                    let subtype: PDFAnnotationSubtype = item.kind == "underline" ? .underline : .highlight
                    let annotation = PDFAnnotation(bounds: rect.cgRect, forType: subtype, withProperties: nil)
                    annotation.contents = KnowledgeAnnotationReference.pdfContents(for: item.id)
                    annotation.color = item.kind == "note" ? NSColor.systemGreen.withAlphaComponent(0.35) : NSColor.systemYellow.withAlphaComponent(0.45)
                    page.addAnnotation(annotation)
                }
            }
        }
    }
}

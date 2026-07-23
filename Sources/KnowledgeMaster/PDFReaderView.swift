import SwiftUI
import PDFKit

private final class PDFBookmarkButton: NSButton {
    var isBookmarked = false {
        didSet {
            toolTip = isBookmarked ? "取消本页书签" : "将本页设为书签"
            let configuration = NSImage.SymbolConfiguration(pointSize: 20, weight: .semibold)
            image = isBookmarked
                ? NSImage(systemSymbolName: "bookmark.fill", accessibilityDescription: "本页书签")?
                    .withSymbolConfiguration(configuration)
                : nil
            needsDisplay = true
        }
    }
    private var isHovered = false
    private var trackingAreaValue: NSTrackingArea?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        isBordered = false
        title = ""
        imagePosition = .imageOnly
        contentTintColor = .systemOrange
        focusRingType = .none
        toolTip = "将本页设为书签"
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    override func updateTrackingAreas() {
        if let trackingAreaValue { removeTrackingArea(trackingAreaValue) }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
            owner: self
        )
        addTrackingArea(area)
        trackingAreaValue = area
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) {
        isHovered = true
        needsDisplay = true
    }

    override func mouseExited(with event: NSEvent) {
        isHovered = false
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if !isBookmarked && isHovered {
            NSColor.controlAccentColor.withAlphaComponent(0.75).setStroke()
            let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 2), xRadius: 5, yRadius: 5)
            path.lineWidth = 1.5
            path.setLineDash([4, 3], count: 2, phase: 0)
            path.stroke()
        }
    }
}

private final class InteractivePDFView: PDFView {
    var onKnowledgeAnnotationClick: ((UUID) -> Void)?
    var onBookmarkToggle: ((Int) -> Void)?
    private var markerAnchors: [UUID: AnnotationRect] = [:]
    private var markerButtons: [UUID: NSButton] = [:]
    private var bookmarkButton: PDFBookmarkButton?
    private var bookmarkedPageIndex: Int?
    private var scrollObserver: NSObjectProtocol?

    deinit {
        if let scrollObserver {
            NotificationCenter.default.removeObserver(scrollObserver)
        }
    }

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

    func resetBookmarkMarkers() {
        bookmarkButton?.removeFromSuperview()
        bookmarkButton = nil
        bookmarkedPageIndex = nil
    }

    func updateBookmarkMarkers(bookmarkedPageIndex: Int?) {
        guard document != nil else {
            resetBookmarkMarkers()
            return
        }
        self.bookmarkedPageIndex = bookmarkedPageIndex
        if bookmarkButton == nil {
            let button = PDFBookmarkButton(frame: .zero)
            button.target = self
            button.action = #selector(bookmarkButtonClicked(_:))
            addSubview(button)
            bookmarkButton = button
        }
        observeScrollChanges()
        refreshBookmarkMarkerForCurrentPage()
    }

    override func layout() {
        super.layout()
        positionAnnotationMarkers()
        refreshBookmarkMarkerForCurrentPage()
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

    func refreshBookmarkMarkerForCurrentPage() {
        let viewportCenter = CGPoint(x: bounds.midX, y: bounds.midY)
        guard let document,
              let page = page(for: viewportCenter, nearest: true) ?? currentPage,
              let button = bookmarkButton else { return }
        let index = document.index(for: page)
        guard index != NSNotFound else { return }
        let pageRect = convert(page.bounds(for: displayBox), from: page)
        let size = CGSize(width: 28, height: 32)
        let y = isFlipped ? bounds.minY + 8 : bounds.maxY - size.height - 8
        button.identifier = NSUserInterfaceItemIdentifier(String(index))
        button.isBookmarked = index == bookmarkedPageIndex
        button.frame = CGRect(x: pageRect.maxX - size.width - 10, y: y,
                              width: size.width, height: size.height)
        button.isHidden = false
    }

    private func observeScrollChanges() {
        guard scrollObserver == nil,
              let clipView = documentView?.enclosingScrollView?.contentView else { return }
        clipView.postsBoundsChangedNotifications = true
        scrollObserver = NotificationCenter.default.addObserver(
            forName: NSView.boundsDidChangeNotification,
            object: clipView,
            queue: .main
        ) { [weak self] _ in
            self?.refreshBookmarkMarkerForCurrentPage()
        }
    }

    @objc private func annotationButtonClicked(_ sender: NSButton) {
        guard let value = sender.identifier?.rawValue, let id = UUID(uuidString: value) else { return }
        onKnowledgeAnnotationClick?(id)
    }

    @objc private func bookmarkButtonClicked(_: NSButton) {
        let viewportCenter = CGPoint(x: bounds.midX, y: bounds.midY)
        guard let document,
              let page = page(for: viewportCenter, nearest: true) ?? currentPage else { return }
        let pageIndex = document.index(for: page)
        guard pageIndex != NSNotFound else { return }
        onBookmarkToggle?(pageIndex)
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
    var navigationRequest: DocumentNavigationRequest?
    var bookmarkPageIndex: Int?
    var onSelection: (ReaderSelection?) -> Void
    var onPageChange: (Int) -> Void
    var onBookmarkToggle: (Int) -> Void
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
        context.coordinator.onPageChange = onPageChange
        let interactiveView = view as? InteractivePDFView
        interactiveView?.onKnowledgeAnnotationClick = onAnnotationClick
        interactiveView?.onBookmarkToggle = onBookmarkToggle
        let documentChanged = context.coordinator.url != url
        if documentChanged {
            context.coordinator.url = url
            interactiveView?.resetBookmarkMarkers()
            view.document = PDFDocument(url: url)
        }
        context.coordinator.render(annotations: annotations, in: view)
        interactiveView?.updateAnnotationMarkers(annotations)
        interactiveView?.updateBookmarkMarkers(bookmarkedPageIndex: bookmarkPageIndex)
        if documentChanged {
            context.coordinator.restoreBookmark(pageIndex: bookmarkPageIndex, in: view)
        }
        context.coordinator.focus(annotationID: focusedAnnotationID, annotations: annotations, in: view)
        context.coordinator.navigate(navigationRequest, in: view)
    }

    final class Coordinator: NSObject {
        var onSelection: (ReaderSelection?) -> Void
        var onPageChange: (Int) -> Void = { _ in }
        var url: URL?
        private weak var view: PDFView?
        private var observers: [NSObjectProtocol] = []
        private var focusedAnnotationID: UUID?
        private var navigationRequestID: UUID?

        init(onSelection: @escaping (ReaderSelection?) -> Void) { self.onSelection = onSelection }
        deinit { observers.forEach(NotificationCenter.default.removeObserver) }

        func attach(to view: PDFView) {
            self.view = view
            observers.append(NotificationCenter.default.addObserver(
                forName: Notification.Name.PDFViewSelectionChanged, object: view, queue: .main
            ) { [weak self] _ in self?.selectionChanged() }
            )
            observers.append(NotificationCenter.default.addObserver(
                forName: Notification.Name.PDFViewPageChanged, object: view, queue: .main
            ) { [weak self] _ in self?.pageChanged() }
            )
        }

        private func pageChanged() {
            guard let view, let document = view.document, let page = view.currentPage else { return }
            let index = document.index(for: page)
            if index != NSNotFound {
                onPageChange(index)
                (view as? InteractivePDFView)?.refreshBookmarkMarkerForCurrentPage()
            }
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

        func navigate(_ request: DocumentNavigationRequest?, in view: PDFView) {
            guard let request, request.id != navigationRequestID,
                  case let .pdf(pageIndex, point) = request.target,
                  let document = view.document,
                  let page = document.page(at: pageIndex) else { return }
            navigationRequestID = request.id
            if let point {
                view.go(to: PDFDestination(page: page, at: point))
            } else {
                view.go(to: page)
            }
        }

        func restoreBookmark(pageIndex: Int?, in view: PDFView) {
            guard let pageIndex,
                  let page = view.document?.page(at: pageIndex) else { return }
            view.go(to: page)
        }
    }
}

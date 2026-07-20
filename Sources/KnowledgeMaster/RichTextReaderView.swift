import SwiftUI
import AppKit

fileprivate final class AnnotationTextView: NSTextView {
    var onAnnotationButton: ((UUID) -> Void)?
    private var markerRanges: [UUID: NSRange] = [:]
    private var markerButtons: [UUID: NSButton] = [:]

    func updateAnnotationMarkers(_ values: [(UUID, NSRange, String)]) {
        markerRanges = Dictionary(uniqueKeysWithValues: values.map { ($0.0, $0.1) })
        let ids = Set(markerRanges.keys)
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
            addSubview(button)
            markerButtons[id] = button
        }
        needsLayout = true
    }

    override func layout() {
        super.layout()
        guard let layoutManager, let textContainer else { return }
        layoutManager.ensureLayout(for: textContainer)
        for (id, range) in markerRanges {
            guard range.location != NSNotFound, range.length > 0, let button = markerButtons[id] else { continue }
            let glyphRange = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            guard glyphRange.length > 0 else { continue }
            let lastGlyph = NSRange(location: NSMaxRange(glyphRange) - 1, length: 1)
            let glyphRect = layoutManager.boundingRect(forGlyphRange: lastGlyph, in: textContainer)
            let size: CGFloat = 18
            let preferredX = textContainerOrigin.x + glyphRect.maxX + 4
            let x = min(preferredX, max(textContainerOrigin.x, bounds.width - textContainerInset.width - size))
            let y = textContainerOrigin.y + glyphRect.midY - size / 2
            button.frame = CGRect(x: x, y: y, width: size, height: size)
        }
    }

    @objc private func annotationButtonClicked(_ sender: NSButton) {
        guard let value = sender.identifier?.rawValue, let id = UUID(uuidString: value) else { return }
        onAnnotationButton?(id)
    }
}

struct RichTextReaderView: NSViewRepresentable {
    var content: NSAttributedString
    var annotations: [KnowledgeAnnotation]
    var focusedAnnotationID: UUID?
    var onSelection: (ReaderSelection?) -> Void
    var onAnnotationClick: (UUID) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onSelection: onSelection, onAnnotationClick: onAnnotationClick) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        let textView = AnnotationTextView()
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 36, height: 32)
        textView.textContainer?.widthTracksTextView = true
        textView.autoresizingMask = [.width]
        textView.linkTextAttributes = [:]
        textView.delegate = context.coordinator
        textView.onAnnotationButton = onAnnotationClick
        scroll.documentView = textView
        context.coordinator.textView = textView
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.onSelection = onSelection
        context.coordinator.onAnnotationClick = onAnnotationClick
        guard let textView = context.coordinator.textView else { return }
        textView.onAnnotationButton = onAnnotationClick
        let value = NSMutableAttributedString(attributedString: content)
        let full = value.string as NSString
        var markers: [(UUID, NSRange, String)] = []
        for annotation in annotations {
            let range = full.range(of: annotation.quote)
            guard range.location != NSNotFound else { continue }
            switch annotation.kind {
            case "underline":
                value.addAttributes([.underlineStyle: NSUnderlineStyle.single.rawValue,
                                     .underlineColor: NSColor.systemBrown], range: range)
            case "note":
                value.addAttributes([.backgroundColor: NSColor.systemGreen.withAlphaComponent(0.18),
                                     .underlineStyle: NSUnderlineStyle.patternDot.rawValue], range: range)
            default:
                value.addAttribute(.backgroundColor, value: NSColor.systemYellow.withAlphaComponent(0.42), range: range)
            }
            if !annotation.note.isEmpty { value.addAttribute(.toolTip, value: annotation.note, range: range) }
            value.addAttribute(.link, value: KnowledgeAnnotationReference.link(for: annotation.id), range: range)
            if !annotation.note.isEmpty { markers.append((annotation.id, range, annotation.note)) }
        }
        if textView.attributedString() != value { textView.textStorage?.setAttributedString(value) }
        textView.updateAnnotationMarkers(markers)
        context.coordinator.focus(annotationID: focusedAnnotationID, annotations: annotations)
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        fileprivate weak var textView: AnnotationTextView?
        var onSelection: (ReaderSelection?) -> Void
        var onAnnotationClick: (UUID) -> Void
        private var focusedAnnotationID: UUID?

        init(onSelection: @escaping (ReaderSelection?) -> Void, onAnnotationClick: @escaping (UUID) -> Void) {
            self.onSelection = onSelection
            self.onAnnotationClick = onAnnotationClick
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let textView, textView.selectedRange.length > 0 else { onSelection(nil); return }
            let text = (textView.string as NSString).substring(with: textView.selectedRange)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty,
                  let layoutManager = textView.layoutManager,
                  let textContainer = textView.textContainer else {
                onSelection(nil)
                return
            }
            let glyphRange = layoutManager.glyphRange(forCharacterRange: textView.selectedRange, actualCharacterRange: nil)
            var rect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: textContainer)
            rect.origin.x += textView.textContainerOrigin.x
            rect.origin.y += textView.textContainerOrigin.y
            let target = textView.enclosingScrollView
            let converted = target.map { textView.convert(rect, to: $0) } ?? rect
            let top = target?.isFlipped == false ? (target?.bounds.height ?? 0) - converted.maxY : converted.minY
            onSelection(ReaderSelection(text: String(text.prefix(4_000)), page: nil,
                                        anchorX: converted.maxX, anchorY: top))
        }

        func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
            guard let id = KnowledgeAnnotationReference.id(fromLink: link) else { return false }
            onAnnotationClick(id)
            return true
        }

        func focus(annotationID: UUID?, annotations: [KnowledgeAnnotation]) {
            guard let annotationID, focusedAnnotationID != annotationID,
                  let annotation = annotations.first(where: { $0.id == annotationID }),
                  let textView else { return }
            let range = (textView.string as NSString).range(of: annotation.quote)
            guard range.location != NSNotFound else { return }
            focusedAnnotationID = annotationID
            textView.scrollRangeToVisible(range)
        }
    }
}

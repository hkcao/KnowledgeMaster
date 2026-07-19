import SwiftUI
import AppKit

struct RichTextReaderView: NSViewRepresentable {
    var content: NSAttributedString
    var annotations: [KnowledgeAnnotation]
    var onSelection: (ReaderSelection?) -> Void
    var onAnnotationClick: (UUID) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onSelection: onSelection, onAnnotationClick: onAnnotationClick) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        let textView = NSTextView()
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 36, height: 32)
        textView.textContainer?.widthTracksTextView = true
        textView.autoresizingMask = [.width]
        textView.linkTextAttributes = [:]
        textView.delegate = context.coordinator
        scroll.documentView = textView
        context.coordinator.textView = textView
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.onSelection = onSelection
        context.coordinator.onAnnotationClick = onAnnotationClick
        guard let textView = context.coordinator.textView else { return }
        let value = NSMutableAttributedString(attributedString: content)
        let full = value.string as NSString
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
        }
        if textView.attributedString() != value { textView.textStorage?.setAttributedString(value) }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        weak var textView: NSTextView?
        var onSelection: (ReaderSelection?) -> Void
        var onAnnotationClick: (UUID) -> Void

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
    }
}

import CoreGraphics

enum ReaderZoomBehavior {
    static let minimumPDFScale: CGFloat = 0.25
    static let maximumPDFScale: CGFloat = 8

    static func adjustedScale(current: CGFloat, magnification: CGFloat,
                              minimum: CGFloat, maximum: CGFloat) -> CGFloat {
        min(maximum, max(minimum, current * (1 + magnification)))
    }
}

enum AnnotationBubbleLayout {
    static func trailingMarginFrame(alignedTo verticalCenter: CGFloat,
                                    contentMaxX: CGFloat,
                                    fallbackRightEdge: CGFloat,
                                    within bounds: CGRect,
                                    size: CGFloat = 18) -> CGRect {
        let edgePadding: CGFloat = 2
        let preferredX = contentMaxX + 6
        let minimumX = bounds.minX + edgePadding
        let maximumX = max(minimumX, bounds.maxX - size - edgePadding)
        let fallbackX = fallbackRightEdge - size
        let x = preferredX + size <= bounds.maxX - edgePadding
            ? preferredX
            : min(maximumX, max(minimumX, fallbackX))

        let minimumY = bounds.minY + edgePadding
        let maximumY = max(minimumY, bounds.maxY - size - edgePadding)
        let y = min(maximumY, max(minimumY, verticalCenter - size / 2))
        return CGRect(x: x, y: y, width: size, height: size)
    }
}

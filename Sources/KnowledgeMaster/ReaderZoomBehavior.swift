import CoreGraphics

enum ReaderZoomBehavior {
    static let minimumPDFScale: CGFloat = 0.25
    static let maximumPDFScale: CGFloat = 8

    static func adjustedScale(current: CGFloat, magnification: CGFloat,
                              minimum: CGFloat, maximum: CGFloat) -> CGFloat {
        min(maximum, max(minimum, current * (1 + magnification)))
    }
}

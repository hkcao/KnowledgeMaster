import Foundation
import PDFKit
import AppKit

enum PDFSelectionSnapshot {
    static func render(url: URL, selection: ReaderSelection, maxPixelDimension: CGFloat = 1_800) -> Data? {
        guard let pageNumber = selection.page,
              let document = PDFDocument(url: url),
              let page = document.page(at: pageNumber - 1) else { return nil }
        let pageBounds = page.bounds(for: .cropBox)
        let pageRects = selection.rects.filter { $0.page == pageNumber }.map(\.cgRect)
        guard let crop = cropBounds(rects: pageRects, pageBounds: pageBounds) else { return nil }
        let scale = min(2.5, max(1, maxPixelDimension / max(crop.width, crop.height)))
        let width = max(1, Int(ceil(crop.width * scale)))
        let height = max(1, Int(ceil(crop.height * scale)))
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.setFillColor(NSColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: -crop.minX, y: -crop.minY)
        page.draw(with: .cropBox, to: context)
        guard let image = context.makeImage() else { return nil }
        return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    }

    static func cropBounds(rects: [CGRect], pageBounds: CGRect, padding: CGFloat = 18) -> CGRect? {
        guard var bounds = rects.first else { return nil }
        for rect in rects.dropFirst() { bounds = bounds.union(rect) }
        let padded = bounds.insetBy(dx: -padding, dy: -padding).intersection(pageBounds)
        guard !padded.isNull, padded.width > 0, padded.height > 0 else { return nil }
        return padded
    }
}

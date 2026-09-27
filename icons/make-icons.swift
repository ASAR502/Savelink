import AppKit

for size in [16, 32, 48, 128] {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size,
        pixelsHigh: size,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    let context = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.cgContext.scaleBy(x: CGFloat(size) / 48, y: CGFloat(size) / 48)

    NSColor(calibratedRed: 0.259, green: 0.522, blue: 0.957, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 3, y: 3, width: 42, height: 42), xRadius: 12, yRadius: 12).fill()

    let bookmark = NSBezierPath()
    bookmark.move(to: NSPoint(x: 16, y: 38))
    bookmark.line(to: NSPoint(x: 32, y: 38))
    bookmark.curve(to: NSPoint(x: 34, y: 36), controlPoint1: NSPoint(x: 33.1, y: 38), controlPoint2: NSPoint(x: 34, y: 37.1))
    bookmark.line(to: NSPoint(x: 34, y: 10))
    bookmark.line(to: NSPoint(x: 24, y: 16))
    bookmark.line(to: NSPoint(x: 14, y: 10))
    bookmark.line(to: NSPoint(x: 14, y: 36))
    bookmark.curve(to: NSPoint(x: 16, y: 38), controlPoint1: NSPoint(x: 14, y: 37.1), controlPoint2: NSPoint(x: 14.9, y: 38))
    bookmark.close()
    NSColor.white.setFill()
    bookmark.fill()

    let check = NSBezierPath()
    check.lineWidth = 2.5
    check.lineCapStyle = .round
    check.lineJoinStyle = .round
    check.move(to: NSPoint(x: 19, y: 23))
    check.line(to: NSPoint(x: 22, y: 20))
    check.line(to: NSPoint(x: 27, y: 25))
    check.line(to: NSPoint(x: 31, y: 21))
    NSColor(calibratedRed: 0.204, green: 0.659, blue: 0.325, alpha: 1).setStroke()
    check.stroke()

    NSGraphicsContext.restoreGraphicsState()
    let data = rep.representation(using: .png, properties: [:])!
    try data.write(to: URL(fileURLWithPath: "icons/link-saver-\(size).png"))
}

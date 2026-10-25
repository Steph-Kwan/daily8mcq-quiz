// Draws the 1024px app icon (the site's "8" mark) to the PNG path given as the first argument.
import AppKit

let size = 1024.0
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
func rgb(_ hex: Int) -> NSColor {
    NSColor(red: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
}

// macOS icon grid: 824px rounded square centred on a 1024px canvas.
let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
rgb(0x173e38).setFill()
NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185).fill()

// Tilted organic blob, as in the site's hero art.
let blob = NSBezierPath()
blob.move(to: NSPoint(x: 512, y: 790))
blob.curve(to: NSPoint(x: 790, y: 520), controlPoint1: NSPoint(x: 700, y: 800), controlPoint2: NSPoint(x: 800, y: 690))
blob.curve(to: NSPoint(x: 500, y: 240), controlPoint1: NSPoint(x: 780, y: 340), controlPoint2: NSPoint(x: 660, y: 230))
blob.curve(to: NSPoint(x: 236, y: 520), controlPoint1: NSPoint(x: 330, y: 250), controlPoint2: NSPoint(x: 226, y: 360))
blob.curve(to: NSPoint(x: 512, y: 790), controlPoint1: NSPoint(x: 246, y: 690), controlPoint2: NSPoint(x: 340, y: 780))
var transform = AffineTransform(translationByX: 512, byY: 512)
transform.rotate(byDegrees: 9)
transform.translate(x: -512, y: -512)
blob.transform(using: transform)
rgb(0xe7eddd).setFill()
blob.fill()

let font = NSFont(name: "Georgia", size: 430) ?? NSFont.systemFont(ofSize: 430, weight: .bold)
let text = NSAttributedString(string: "8", attributes: [.font: font, .foregroundColor: rgb(0x447959)])
let bounds = text.size()
text.draw(at: NSPoint(x: 512 - bounds.width / 2, y: 512 - bounds.height / 2 - 6))

NSGraphicsContext.current = nil
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))

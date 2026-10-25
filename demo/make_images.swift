// Draws the demo bank's pictures into demo/images/. Run: swift demo/make_images.swift demo/images
import AppKit

let outDir = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let ink = NSColor(red: 0.09, green: 0.24, blue: 0.22, alpha: 1)
let green = NSColor(red: 0.13, green: 0.42, blue: 0.34, alpha: 1)
let soft = NSColor(red: 0.61, green: 0.78, blue: 0.67, alpha: 1)

func draw(_ name: String, _ w: Int, _ h: Int, _ body: () -> Void) {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                               isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    // Flip so y grows downwards, like screen coordinates.
    let flip = NSAffineTransform(); flip.translateX(by: 0, yBy: CGFloat(h)); flip.scaleX(by: 1, yBy: -1); flip.concat()
    NSColor.white.setFill(); NSRect(x: 0, y: 0, width: w, height: h).fill()
    body()
    NSGraphicsContext.current = nil
    try! rep.representation(using: .png, properties: [:])!.write(to: outDir.appendingPathComponent(name))
}

func text(_ s: String, _ x: CGFloat, _ y: CGFloat, size: CGFloat = 26, bold: Bool = false, color: NSColor = ink, center: Bool = false) {
    let font = NSFont.systemFont(ofSize: size, weight: bold ? .bold : .regular)
    let str = NSAttributedString(string: s, attributes: [.font: font, .foregroundColor: color])
    let sz = str.size()
    NSGraphicsContext.saveGraphicsState()
    let t = NSAffineTransform(); t.translateX(by: center ? x - sz.width / 2 : x, yBy: y + sz.height); t.scaleX(by: 1, yBy: -1); t.concat()
    str.draw(at: .zero)
    NSGraphicsContext.restoreGraphicsState()
}

func line(_ a: NSPoint, _ b: NSPoint, width: CGFloat = 3, color: NSColor = ink) {
    let p = NSBezierPath(); p.move(to: a); p.line(to: b); p.lineWidth = width; color.setStroke(); p.stroke()
}

func arrow(_ a: NSPoint, _ b: NSPoint) {
    line(a, b)
    let angle = atan2(b.y - a.y, b.x - a.x), len: CGFloat = 14
    let head = NSBezierPath()
    head.move(to: b)
    head.line(to: NSPoint(x: b.x - len * cos(angle - .pi / 7), y: b.y - len * sin(angle - .pi / 7)))
    head.line(to: NSPoint(x: b.x - len * cos(angle + .pi / 7), y: b.y - len * sin(angle + .pi / 7)))
    head.close(); ink.setFill(); head.fill()
}

func box(_ r: NSRect, _ label: String, round: CGFloat = 10, diamond: Bool = false) {
    let p: NSBezierPath
    if diamond {
        p = NSBezierPath()
        p.move(to: NSPoint(x: r.midX, y: r.minY)); p.line(to: NSPoint(x: r.maxX, y: r.midY))
        p.line(to: NSPoint(x: r.midX, y: r.maxY)); p.line(to: NSPoint(x: r.minX, y: r.midY)); p.close()
    } else { p = NSBezierPath(roundedRect: r, xRadius: round, yRadius: round) }
    NSColor(red: 0.93, green: 0.95, blue: 0.91, alpha: 1).setFill(); p.fill()
    p.lineWidth = 3; ink.setStroke(); p.stroke()
    text(label, r.midX, r.midY - 17, center: true)
}

// Monthly sales bar chart.
draw("sales-chart.png", 900, 520) {
    let data: [(String, CGFloat)] = [("1月", 12), ("2月", 18), ("3月", 15), ("4月", 9), ("5月", 21), ("6月", 17)]
    text("上半年月销售额（万元）", 450, 24, size: 28, bold: true, center: true)
    let base: CGFloat = 450, left: CGFloat = 110, scale: CGFloat = 15
    for v in stride(from: 0, through: 25, by: 5) {
        let y = base - CGFloat(v) * scale
        line(NSPoint(x: left, y: y), NSPoint(x: 860, y: y), width: 1, color: NSColor(white: 0.85, alpha: 1))
        text("\(v)", left - 18, y - 16, size: 20, center: true)
    }
    for (i, (m, v)) in data.enumerated() {
        let x = left + 30 + CGFloat(i) * 120
        soft.setFill(); NSBezierPath(roundedRect: NSRect(x: x, y: base - v * scale, width: 70, height: v * scale), xRadius: 6, yRadius: 6).fill()
        text(m, x + 35, base + 12, size: 22, center: true)
    }
    line(NSPoint(x: left, y: base), NSPoint(x: 860, y: base))
}

// Flowchart summing 1..n.
draw("flowchart.png", 760, 860) {
    box(NSRect(x: 280, y: 20, width: 200, height: 64), "开始", round: 32)
    box(NSRect(x: 230, y: 130, width: 300, height: 70), "输入 n")
    box(NSRect(x: 230, y: 245, width: 300, height: 70), "s ← 0，i ← 1")
    box(NSRect(x: 230, y: 360, width: 300, height: 120), "i ≤ n ?", diamond: true)
    box(NSRect(x: 230, y: 530, width: 300, height: 70), "s ← s + i")
    box(NSRect(x: 230, y: 645, width: 300, height: 70), "i ← i + 1")
    box(NSRect(x: 560, y: 385, width: 170, height: 70), "输出 s")
    arrow(NSPoint(x: 380, y: 84), NSPoint(x: 380, y: 130))
    arrow(NSPoint(x: 380, y: 200), NSPoint(x: 380, y: 245))
    arrow(NSPoint(x: 380, y: 315), NSPoint(x: 380, y: 360))
    arrow(NSPoint(x: 380, y: 480), NSPoint(x: 380, y: 530)); text("是", 395, 488, size: 22, color: green)
    arrow(NSPoint(x: 380, y: 600), NSPoint(x: 380, y: 645))
    arrow(NSPoint(x: 530, y: 420), NSPoint(x: 560, y: 420)); text("否", 532, 384, size: 22, color: green)
    line(NSPoint(x: 380, y: 715), NSPoint(x: 380, y: 760)); line(NSPoint(x: 380, y: 760), NSPoint(x: 150, y: 760))
    line(NSPoint(x: 150, y: 760), NSPoint(x: 150, y: 420)); arrow(NSPoint(x: 150, y: 420), NSPoint(x: 230, y: 420))
}

// Logic circuit: Q = (A AND B) OR C.
draw("logic-circuit.png", 860, 420) {
    text("A", 40, 70); text("B", 40, 160); text("C", 40, 300)
    line(NSPoint(x: 75, y: 88), NSPoint(x: 260, y: 88)); line(NSPoint(x: 75, y: 178), NSPoint(x: 260, y: 178))
    let and = NSBezierPath()
    and.move(to: NSPoint(x: 260, y: 60)); and.line(to: NSPoint(x: 330, y: 60))
    and.appendArc(withCenter: NSPoint(x: 330, y: 133), radius: 73, startAngle: -90, endAngle: 90)
    and.line(to: NSPoint(x: 260, y: 206)); and.close(); and.lineWidth = 3; ink.setStroke(); and.stroke()
    text("AND", 315, 115, size: 22, bold: true, center: true)
    line(NSPoint(x: 403, y: 133), NSPoint(x: 520, y: 133)); line(NSPoint(x: 520, y: 133), NSPoint(x: 520, y: 200)); line(NSPoint(x: 520, y: 200), NSPoint(x: 560, y: 200))
    line(NSPoint(x: 75, y: 318), NSPoint(x: 520, y: 318)); line(NSPoint(x: 520, y: 318), NSPoint(x: 520, y: 270)); line(NSPoint(x: 520, y: 270), NSPoint(x: 560, y: 270))
    let or = NSBezierPath()
    or.move(to: NSPoint(x: 545, y: 170))
    or.curve(to: NSPoint(x: 720, y: 235), controlPoint1: NSPoint(x: 640, y: 170), controlPoint2: NSPoint(x: 700, y: 200))
    or.curve(to: NSPoint(x: 545, y: 300), controlPoint1: NSPoint(x: 700, y: 270), controlPoint2: NSPoint(x: 640, y: 300))
    or.curve(to: NSPoint(x: 545, y: 170), controlPoint1: NSPoint(x: 585, y: 260), controlPoint2: NSPoint(x: 585, y: 210))
    or.lineWidth = 3; ink.setStroke(); or.stroke()
    text("OR", 625, 218, size: 22, bold: true, center: true)
    line(NSPoint(x: 720, y: 235), NSPoint(x: 790, y: 235)); text("Q", 800, 217)
}

// Right triangle with legs 6 and 8.
draw("right-triangle.png", 640, 480) {
    let a = NSPoint(x: 120, y: 60), b = NSPoint(x: 120, y: 400), c = NSPoint(x: 560, y: 400)
    let p = NSBezierPath(); p.move(to: a); p.line(to: b); p.line(to: c); p.close()
    NSColor(red: 0.93, green: 0.95, blue: 0.91, alpha: 1).setFill(); p.fill(); p.lineWidth = 4; ink.setStroke(); p.stroke()
    let sq = NSBezierPath(rect: NSRect(x: 120, y: 370, width: 30, height: 30)); sq.lineWidth = 2; sq.stroke()
    text("6 cm", 50, 215, size: 26, bold: true); text("8 cm", 340, 412, size: 26, bold: true, center: true)
    text("?", 365, 190, size: 34, bold: true, color: green)
}

// Map for a direction question (pasted into the sheet in the demo).
draw("map.png", 620, 520) {
    for i in 0...6 {
        line(NSPoint(x: 40 + CGFloat(i) * 90, y: 40), NSPoint(x: 40 + CGFloat(i) * 90, y: 480), width: 1, color: NSColor(white: 0.88, alpha: 1))
        line(NSPoint(x: 40, y: 40 + CGFloat(i) * 73), NSPoint(x: 580, y: 40 + CGFloat(i) * 73), width: 1, color: NSColor(white: 0.88, alpha: 1))
    }
    arrow(NSPoint(x: 540, y: 150), NSPoint(x: 540, y: 60)); text("北", 540, 160, size: 24, bold: true, center: true)
    soft.setFill(); NSBezierPath(ovalIn: NSRect(x: 230, y: 230, width: 120, height: 90)).fill(); text("公园", 290, 257, size: 24, bold: true, center: true)
    NSColor(red: 0.95, green: 0.85, blue: 0.7, alpha: 1).setFill(); NSBezierPath(roundedRect: NSRect(x: 400, y: 80, width: 120, height: 70), xRadius: 8, yRadius: 8).fill()
    text("学校", 460, 98, size: 24, bold: true, center: true)
}

// A whole question as one screenshot (no text in the sheet).
draw("screenshot-question.png", 900, 300) {
    text("下列哪个数最大？", 40, 36, size: 32, bold: true)
    text("A.  0.5", 60, 120, size: 30); text("B.  3/4", 480, 120, size: 30)
    text("C.  0.7", 60, 200, size: 30); text("D.  2/3", 480, 200, size: 30)
}

// Option pictures for a symmetry question.
func shape(_ name: String, _ path: NSBezierPath) {
    draw(name, 240, 200) {
        soft.setFill(); path.fill(); path.lineWidth = 4; ink.setStroke(); path.stroke()
    }
}
shape("shape-circle.png", NSBezierPath(ovalIn: NSRect(x: 50, y: 30, width: 140, height: 140)))
shape("shape-square.png", NSBezierPath(rect: NSRect(x: 50, y: 30, width: 140, height: 140)))
let tri = NSBezierPath(); tri.move(to: NSPoint(x: 120, y: 25)); tri.line(to: NSPoint(x: 200, y: 170)); tri.line(to: NSPoint(x: 40, y: 170)); tri.close()
shape("shape-triangle.png", tri)
let para = NSBezierPath(); para.move(to: NSPoint(x: 80, y: 40)); para.line(to: NSPoint(x: 220, y: 40)); para.line(to: NSPoint(x: 160, y: 160)); para.line(to: NSPoint(x: 20, y: 160)); para.close()
shape("shape-parallelogram.png", para)

import AppKit

/// The app icon's crook and the sparkle beside its hook, in one colour: a template image for the menu bar, which
/// tints it. The path follows the crook's centre line in the 1024 px artwork (`Resources/AppIcon.icns`).
enum CrookGlyph {
    static func image(side: CGFloat) -> NSImage {
        let image = NSImage(size: NSSize(width: side, height: side), flipped: true) { _ in
            let k = side / 760
            func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
                NSPoint(x: (x - 510) * k + side * 0.56, y: (y - 200) * k + side * 0.04)
            }
            NSColor.black.set()

            let crook = NSBezierPath()
            crook.move(to: p(388, 445))
            crook.curve(to: p(510, 238), controlPoint1: p(350, 360), controlPoint2: p(380, 240))
            crook.curve(to: p(655, 370), controlPoint1: p(620, 236), controlPoint2: p(660, 300))
            crook.curve(to: p(528, 690), controlPoint1: p(650, 450), controlPoint2: p(540, 600))
            crook.curve(to: p(595, 925), controlPoint1: p(518, 770), controlPoint2: p(560, 850))
            crook.lineWidth = max(1.6, 70 * k)
            crook.lineCapStyle = .round
            crook.stroke()

            let centre = p(280, 290), r = 55 * k, w = 14 * k
            let points = [(0, -r), (w, -w), (r, 0), (w, w), (0, r), (-w, w), (-r, 0), (-w, -w)]
            let sparkle = NSBezierPath()
            for (index, (dx, dy)) in points.enumerated() {
                let point = NSPoint(x: centre.x + dx, y: centre.y + dy)
                if index == 0 { sparkle.move(to: point) } else { sparkle.line(to: point) }
            }
            sparkle.close()
            sparkle.fill()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Wololo"
        return image
    }
}

import AppKit
import SwiftUI
import WololoKit

/// A `ThemeSpec` as the views use it: SwiftUI colors, fonts by role, the corner radius scale and the theme's images.
/// Views read it from `@Environment(\.theme)`; structural sizes stay in the views.
struct AppTheme {
    enum FontRole {
        /// Titles: the window's, the board's, the columns' and the cards'.
        case display
        case body
        /// Repos, refs and paths.
        case mono
    }

    struct StatusStyle {
        /// The dot, the bullet and the status label.
        let color: Color
        let badge: Color
        let badgeText: Color
        let activity: Color
    }

    static let actual = AppTheme(spec: .actual)

    let spec: ThemeSpec
    private let cache = Cache()

    init(spec: ThemeSpec) {
        self.spec = spec
    }

    // MARK: Colors

    var ground: Color { Color(spec.colors.ground) }
    var sidebar: Color { Color(spec.colors.sidebar) }
    var surface: Color { Color(spec.colors.surface) }
    var surfaceHover: Color { Color(spec.colors.surfaceHover) }
    var field: Color { Color(spec.colors.field) }
    var border: Color { Color(spec.colors.border) }
    var borderHover: Color { Color(spec.colors.borderHover) }
    var divider: Color { Color(spec.colors.divider) }
    var cardDivider: Color { Color(spec.colors.cardDivider) }
    var rowDivider: Color { Color(spec.colors.rowDivider) }
    var title: Color { Color(spec.colors.title) }
    var heading: Color { Color(spec.colors.heading) }
    var text: Color { Color(spec.colors.text) }
    var secondary: Color { Color(spec.colors.secondary) }
    var muted: Color { Color(spec.colors.muted) }
    var faint: Color { Color(spec.colors.faint) }
    var pendingMark: Color { Color(spec.colors.pendingMark) }
    var agent: Color { Color(spec.colors.agent) }
    var accent: Color { Color(spec.colors.accent) }
    var focus: Color { Color(spec.colors.focus) }
    var selection: Color { Color(spec.colors.selection) }
    var widget: Color { Color(spec.colors.widget) }
    var widgetBorder: Color { Color(spec.colors.widgetBorder) }
    var widgetHover: Color { Color(spec.colors.widgetHover) }
    var track: Color { Color(spec.colors.bar.track) }

    /// The window's background, behind the SwiftUI content.
    var nsGround: NSColor { NSColor(spec.colors.ground) }

    func style(_ status: RunStatus) -> StatusStyle {
        let style = spec.style(status)
        return StatusStyle(color: Color(style.color), badge: Color(style.badge), badgeText: Color(style.badgeText),
                           activity: Color(style.activity))
    }

    /// The small status dot of the sidebar and the archive.
    func dot(_ status: RunStatus) -> Color {
        Color(spec.style(status).color)
    }

    /// The column's icon, also the progress bar of its runs when the theme fills the bar "by status".
    func columnIcon(_ group: StatusGroup) -> Color {
        Color(spec.colors.columns[group].icon)
    }

    func columnTitle(_ group: StatusGroup) -> Color {
        Color(spec.colors.columns[group].title)
    }

    func bar(_ role: ProgressRole) -> Color {
        Color(spec.barFill(role))
    }

    func ci(_ role: CIRole?) -> Color {
        switch role {
        case .pending: return Color(spec.colors.ci.pending)
        case .passing: return Color(spec.colors.ci.passing)
        case .failing: return Color(spec.colors.ci.failing)
        case nil: return Color(spec.colors.ci.none)
        }
    }

    // MARK: Shapes

    /// A corner radius designed for Actual's 10 pt, scaled to the theme's: 0 squares every corner.
    func r(_ base: CGFloat) -> CGFloat {
        base * CGFloat(spec.shapes.radius) / 10
    }

    // MARK: Fonts

    /// The role's font. With the system font each view keeps its own weight, as before themes; a theme's family is
    /// drawn at the theme's weight when it sets one, through the `wght` axis so a variable font gets that exact
    /// weight rather than its nearest named instance. A family that is not installed falls back to the system font.
    func font(_ role: FontRole, size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let fontSpec = self.fontSpec(role)
        if let family = fontSpec.family, let font = cache.font(family: family, size: size,
                                                               weight: fontSpec.weight.map(Double.init) ?? weight.value) {
            return font
        }
        let system = Font.system(size: size, weight: weight)
        return role == .mono ? system.monospaced() : system
    }

    /// The role's letter spacing at this size, in points: the theme writes it in em.
    func tracking(_ role: FontRole, size: CGFloat) -> CGFloat {
        CGFloat(fontSpec(role).tracking) * size
    }

    /// Whether the role's family can be drawn; when not, `font` uses the system font.
    func hasFamily(_ role: FontRole) -> Bool {
        guard let family = fontSpec(role).family else { return true }
        return Cache.isInstalled(family)
    }

    private func fontSpec(_ role: FontRole) -> ThemeSpec.FontSpec {
        switch role {
        case .display: return spec.fonts.display
        case .body: return spec.fonts.body
        case .mono: return spec.fonts.mono
        }
    }

    // MARK: Images

    /// The theme's image, loaded once; nil when the file is missing or is not an image.
    func image(_ asset: ThemeAsset) -> NSImage? {
        cache.image(asset.url)
    }

    /// Fonts and images built once per theme. Only the main thread draws, so it needs no lock.
    private final class Cache {
        private var fonts: [String: Font?] = [:]
        private var images: [URL: NSImage?] = [:]

        static func isInstalled(_ family: String) -> Bool {
            NSFontManager.shared.availableMembers(ofFontFamily: family) != nil
        }

        func font(family: String, size: CGFloat, weight: Double) -> Font? {
            let key = "\(family)|\(size)|\(weight)"
            if let cached = fonts[key] { return cached }
            let font = Self.makeFont(family: family, size: size, weight: weight).map { Font($0) }
            fonts[key] = font
            return font
        }

        func image(_ url: URL) -> NSImage? {
            if let cached = images[url] { return cached }
            let image = NSImage(contentsOf: url)
            images[url] = image
            return image
        }

        /// The family's face nearest to `weight`, then the `wght` axis set to it (ignored by a static font).
        private static func makeFont(family: String, size: CGFloat, weight: Double) -> NSFont? {
            guard isInstalled(family) else { return nil }
            let wanted = NSFontDescriptor(fontAttributes: [
                .family: family,
                .traits: [NSFontDescriptor.TraitKey.weight: NSFont.Weight(css: weight).rawValue],
            ])
            guard let face = wanted.matchingFontDescriptor(withMandatoryKeys: [.family]) else { return nil }
            let wghtAxis = 0x7767_6874 // 'wght'
            let descriptor = face.addingAttributes([.variation: [NSNumber(value: wghtAxis): NSNumber(value: weight)]])
            return NSFont(descriptor: descriptor, size: size)
        }
    }
}

private extension Font.Weight {
    /// CSS's number for the weight, as a theme writes it.
    var value: Double {
        switch self {
        case .ultraLight: return 100
        case .thin: return 200
        case .light: return 300
        case .medium: return 500
        case .semibold: return 600
        case .bold: return 700
        case .heavy: return 800
        case .black: return 900
        default: return 400
        }
    }
}

private extension NSFont.Weight {
    init(css: Double) {
        let steps: [(Double, NSFont.Weight)] = [
            (100, .ultraLight), (200, .thin), (300, .light), (400, .regular), (500, .medium),
            (600, .semibold), (700, .bold), (800, .heavy), (900, .black),
        ]
        self = steps.min { abs($0.0 - css) < abs($1.0 - css) }?.1 ?? .regular
    }
}

extension Color {
    init(_ rgba: RGBA) {
        self.init(
            .sRGB,
            red: Double(rgba.red) / 255,
            green: Double(rgba.green) / 255,
            blue: Double(rgba.blue) / 255,
            opacity: Double(rgba.alpha) / 255
        )
    }
}

extension NSColor {
    convenience init(_ rgba: RGBA) {
        self.init(
            srgbRed: CGFloat(rgba.red) / 255,
            green: CGFloat(rgba.green) / 255,
            blue: CGFloat(rgba.blue) / 255,
            alpha: CGFloat(rgba.alpha) / 255
        )
    }
}

private struct ThemeKey: EnvironmentKey {
    static let defaultValue = AppTheme.actual
}

extension EnvironmentValues {
    /// The chosen theme, injected by `ThemedRoot`; Actual where nothing injects one.
    var theme: AppTheme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

/// The root of every hosting view: gives its content the chosen theme and, unless the window is see-through (the
/// widget), paints the window's background in the theme's ground. A new choice reaches everything at once.
struct ThemedRoot<Content: View>: View {
    let themes: ThemeStore
    var paintsWindow = true
    @ViewBuilder let content: Content

    var body: some View {
        let theme = themes.theme
        content
            .environment(\.theme, theme)
            .background {
                if paintsWindow { WindowBackground(color: theme.nsGround) }
            }
    }
}

/// Sets its window's background color: what shows under the transparent title bar and while a resize redraws.
private struct WindowBackground: NSViewRepresentable {
    let color: NSColor

    func makeNSView(context: Context) -> PaintingView {
        let view = PaintingView()
        view.color = color
        return view
    }

    func updateNSView(_ nsView: PaintingView, context: Context) {
        nsView.color = color
    }

    final class PaintingView: NSView {
        var color: NSColor? {
            didSet { paint() }
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            paint()
        }

        /// Clicks go to the SwiftUI content as if this view were not there.
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        private func paint() {
            guard let window, let color, window.backgroundColor != color else { return }
            window.backgroundColor = color
        }
    }
}

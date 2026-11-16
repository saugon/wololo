import Foundation

// MARK: Colors

/// A theme color, written in `theme.json` as `#rrggbb` or `#rrggbbaa`.
public struct RGBA: Hashable, Sendable, CustomStringConvertible {
    public var red: UInt8
    public var green: UInt8
    public var blue: UInt8
    public var alpha: UInt8

    public init(red: UInt8, green: UInt8, blue: UInt8, alpha: UInt8 = 255) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    public init(hex: UInt32, alpha: UInt8 = 255) {
        self.init(red: UInt8((hex >> 16) & 0xFF), green: UInt8((hex >> 8) & 0xFF), blue: UInt8(hex & 0xFF), alpha: alpha)
    }

    public init?(hex text: String) {
        guard text.hasPrefix("#") else { return nil }
        let digits = text.dropFirst()
        guard digits.count == 6 || digits.count == 8, digits.allSatisfy(\.isHexDigit),
              let value = UInt32(digits, radix: 16) else { return nil }
        if digits.count == 6 {
            self.init(hex: value)
        } else {
            self.init(hex: value >> 8, alpha: UInt8(value & 0xFF))
        }
    }

    public var hex: String {
        let rgb = String(format: "#%02x%02x%02x", red, green, blue)
        return alpha == 255 ? rgb : rgb + String(format: "%02x", alpha)
    }

    public var description: String { hex }

    public static let white = RGBA(hex: 0xFFFFFF)
}

// MARK: Keys

/// The statuses a theme colors. `unknown` statuses look like `pausing`, as they do today.
public enum ThemeStatus: String, CaseIterable, Sendable {
    case waiting
    case permission
    case blocked
    case stalled
    case running
    case agents
    case tests
    case ci
    case pausing
    case paused
    case review
    case orphaned
    case done
    case failed
    case cancelled

    public init(_ status: RunStatus) {
        switch status {
        case .waitingUser: self = .waiting
        case .waitingPermission: self = .permission
        case .blocked: self = .blocked
        case .stalled: self = .stalled
        case .running: self = .running
        case .waitingAgents: self = .agents
        case .waitingTests: self = .tests
        case .waitingCI: self = .ci
        case .pausing, .unknown: self = .pausing
        case .paused: self = .paused
        case .inReview: self = .review
        case .orphaned: self = .orphaned
        case .done: self = .done
        case .failed: self = .failed
        case .cancelled: self = .cancelled
        }
    }
}

/// One value per `StatusGroup`: the four status columns, and the on-hold section under the board.
public struct PerColumn<Value> {
    public var waiting: Value
    public var working: Value
    public var review: Value
    public var onHold: Value
    public var finished: Value

    public init(waiting: Value, working: Value, review: Value, onHold: Value, finished: Value) {
        self.waiting = waiting
        self.working = working
        self.review = review
        self.onHold = onHold
        self.finished = finished
    }

    public init(all value: Value) {
        self.init(waiting: value, working: value, review: value, onHold: value, finished: value)
    }

    public subscript(group: StatusGroup) -> Value {
        get {
            switch group {
            case .waiting: return waiting
            case .working: return working
            case .review: return review
            case .onHold: return onHold
            case .finished: return finished
            }
        }
        set {
            switch group {
            case .waiting: waiting = newValue
            case .working: working = newValue
            case .review: review = newValue
            case .onHold: onHold = newValue
            case .finished: finished = newValue
            }
        }
    }
}

extension PerColumn: Equatable where Value: Equatable {}
extension PerColumn: Sendable where Value: Sendable {}

// MARK: theme.json

/// `theme.json` v1 as written: every field is optional, and what a theme leaves out comes from the base theme.
public struct ThemeFile: Codable, Equatable, Sendable {
    public var version: Int?
    public var id: String?
    public var name: String?
    public var author: String?
    public var colors: Colors?
    public var fonts: Fonts?
    public var images: Images?
    public var shapes: Shapes?
    public var texts: Texts?

    public init(version: Int? = 1, id: String? = nil, name: String? = nil, author: String? = nil, colors: Colors? = nil,
                fonts: Fonts? = nil, images: Images? = nil, shapes: Shapes? = nil, texts: Texts? = nil) {
        self.version = version
        self.id = id
        self.name = name
        self.author = author
        self.colors = colors
        self.fonts = fonts
        self.images = images
        self.shapes = shapes
        self.texts = texts
    }

    public struct Columns<Value: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
        public var waiting: Value?
        public var working: Value?
        /// A theme that leaves it out, as the ones written before runs had a review, takes the base theme's.
        public var review: Value?
        public var onHold: Value?
        public var finished: Value?

        public init(waiting: Value? = nil, working: Value? = nil, review: Value? = nil, onHold: Value? = nil,
                    finished: Value? = nil) {
            self.waiting = waiting
            self.working = working
            self.review = review
            self.onHold = onHold
            self.finished = finished
        }

        subscript(group: StatusGroup) -> Value? {
            switch group {
            case .waiting: return waiting
            case .working: return working
            case .review: return review
            case .onHold: return onHold
            case .finished: return finished
            }
        }
    }

    public struct Colors: Codable, Equatable, Sendable {
        public var ground: String?
        public var sidebar: String?
        public var surface: String?
        public var surfaceHover: String?
        public var field: String?
        public var border: String?
        public var borderHover: String?
        public var divider: String?
        public var cardDivider: String?
        public var rowDivider: String?
        public var title: String?
        public var heading: String?
        public var text: String?
        public var secondary: String?
        public var muted: String?
        public var faint: String?
        public var pendingMark: String?
        public var agent: String?
        public var accent: String?
        public var focus: String?
        public var selection: String?
        public var widget: String?
        public var widgetBorder: String?
        public var widgetHover: String?
        /// Keyed by `ThemeStatus`.
        public var status: [String: Status]?
        public var columns: Columns<Column>?
        public var bar: Bar?
        public var ci: CI?

        public init() {}

        public struct Status: Codable, Equatable, Sendable {
            public var color: String?
            public var badge: String?
            public var badgeText: String?
            public var activity: String?
            /// The card's hood for this status, over its column's: AoE's failed run.
            public var hood: String?

            public init(color: String? = nil, badge: String? = nil, badgeText: String? = nil, activity: String? = nil,
                        hood: String? = nil) {
                self.color = color
                self.badge = badge
                self.badgeText = badgeText
                self.activity = activity
                self.hood = hood
            }
        }

        public struct Column: Codable, Equatable, Sendable {
            public var icon: String?
            public var title: String?
            /// The hood of the column's cards, when the status icon is `hood`; the icon's color when not set.
            public var hood: String?
        }

        public struct Bar: Codable, Equatable, Sendable {
            /// `"status"` or a color.
            public var fill: String?
            public var track: String?
        }

        public struct CI: Codable, Equatable, Sendable {
            public var pending: String?
            public var passing: String?
            public var failing: String?
            public var none: String?
        }
    }

    public struct Fonts: Codable, Equatable, Sendable {
        public var display: Font?
        public var body: Font?
        public var mono: Font?

        public struct Font: Codable, Equatable, Sendable {
            public var family: String?
            public var file: String?
            public var weight: Int?
            /// In em, like CSS `letter-spacing`: `0.04` is 4% of the font's size.
            public var tracking: Double?
        }
    }

    public struct Images: Codable, Equatable, Sendable {
        public var background: Background?
        public var divider: Divider?
        public var frame: Frame?
        public var band: Band?

        public struct Background: Codable, Equatable, Sendable {
            public var file: String?
            public var size: Double?
        }

        public struct Divider: Codable, Equatable, Sendable {
            public var file: String?
            public var width: Double?
        }

        public struct Frame: Codable, Equatable, Sendable {
            public var file: String?
            public var slice: Double?
            public var width: Double?
        }

        public struct Band: Codable, Equatable, Sendable {
            public var file: String?
            public var height: Double?
        }
    }

    public struct Shapes: Codable, Equatable, Sendable {
        public var radius: Double?
        /// `continuous` or `blocks`.
        public var bar: String?
        /// `dot` or `gem`.
        public var bullet: String?
        /// `dot`, `hood` or `image:<file>`.
        public var statusIcon: String?
        /// `dot`, `symbol:<sf symbol>`, `builtin:<name>` or `image:<file>`.
        public var columnIcons: Columns<String>?
        public var projectIcon: String?
    }

    public struct Texts: Codable, Equatable, Sendable {
        public var columns: Columns<Column>?
        public var waitingSection: String?
        public var projectsSection: String?
        public var all: String?
        public var boardTitle: String?
        public var counterWorking: String?
        public var counterWaiting: String?
        public var archive: String?
        public var empty: String?

        public init() {}

        public struct Column: Codable, Equatable, Sendable {
            public var title: String?
            /// An empty subtitle removes the base theme's.
            public var subtitle: String?

            public init(title: String? = nil, subtitle: String? = nil) {
                self.title = title
                self.subtitle = subtitle
            }
        }
    }
}

// MARK: Errors

/// Why a `theme.json` cannot be used. The message is shown in Settings next to the theme.
public enum ThemeError: Error, Equatable, Sendable, CustomStringConvertible {
    case invalidJSON(String)
    case unsupportedVersion(Int?)
    case invalidColor(key: String, value: String)
    case invalidValue(key: String, value: String)
    case missingField(key: String)
    /// Absolute, with `..`, or a symlink that leads out of the theme's folder.
    case unsafePath(key: String, path: String)

    public var description: String {
        switch self {
        case .invalidJSON(let detail): return "theme.json no es JSON válido: \(detail)"
        case .unsupportedVersion(nil): return "theme.json no dice su version"
        case .unsupportedVersion(let version?): return "theme.json usa la version \(version), y solo se entiende la 1"
        case .invalidColor(let key, let value): return "\(key): \"\(value)\" no es un color #rrggbb o #rrggbbaa"
        case .invalidValue(let key, let value): return "\(key): \"\(value)\" no es un valor válido"
        case .missingField(let key): return "falta \(key)"
        case .unsafePath(let key, let path): return "\(key): \"\(path)\" sale de la carpeta del tema"
        }
    }
}

// MARK: Resolved theme

/// A file of the theme's folder, already checked to stay inside it. It may not exist: that is a warning.
public struct ThemeAsset: Hashable, Sendable {
    /// As written in `theme.json`.
    public let path: String
    public let url: URL
}

public enum ThemeIcon: Equatable, Sendable {
    /// A dot in the column's color, as today.
    case dot
    case symbol(String)
    /// An icon drawn by the app, such as AoE's.
    case builtin(String)
    case image(ThemeAsset)
}

public enum StatusIcon: Equatable, Sendable {
    case dot
    case hood
    case image(ThemeAsset)
}

/// A complete theme: everything a view reads. `ThemeSpec.actual` is today's look and the base every theme falls back to.
public struct ThemeSpec: Equatable, Sendable {
    public var id: String
    public var name: String
    public var author: String?
    public var colors: Colors
    public var fonts: Fonts
    public var images: Images
    public var shapes: Shapes
    public var texts: Texts

    public struct StatusStyle: Equatable, Sendable {
        /// The dot, the bullet and the status label.
        public var color: RGBA
        public var badge: RGBA
        public var badgeText: RGBA
        public var activity: RGBA
        /// The card's hood, over the column's; `nil` takes the column's.
        public var hood: RGBA?

        public init(color: RGBA, badge: RGBA, badgeText: RGBA, activity: RGBA, hood: RGBA? = nil) {
            self.color = color
            self.badge = badge
            self.badgeText = badgeText
            self.activity = activity
            self.hood = hood
        }
    }

    public struct StatusStyles: Equatable, Sendable {
        public var waiting: StatusStyle
        public var permission: StatusStyle
        public var blocked: StatusStyle
        public var stalled: StatusStyle
        public var running: StatusStyle
        public var agents: StatusStyle
        public var tests: StatusStyle
        public var ci: StatusStyle
        public var pausing: StatusStyle
        public var paused: StatusStyle
        public var review: StatusStyle
        public var orphaned: StatusStyle
        public var done: StatusStyle
        public var failed: StatusStyle
        public var cancelled: StatusStyle

        public subscript(key: ThemeStatus) -> StatusStyle {
            get {
                switch key {
                case .waiting: return waiting
                case .permission: return permission
                case .blocked: return blocked
                case .stalled: return stalled
                case .running: return running
                case .agents: return agents
                case .tests: return tests
                case .ci: return ci
                case .pausing: return pausing
                case .paused: return paused
                case .review: return review
                case .orphaned: return orphaned
                case .done: return done
                case .failed: return failed
                case .cancelled: return cancelled
                }
            }
            set {
                switch key {
                case .waiting: waiting = newValue
                case .permission: permission = newValue
                case .blocked: blocked = newValue
                case .stalled: stalled = newValue
                case .running: running = newValue
                case .agents: agents = newValue
                case .tests: tests = newValue
                case .ci: ci = newValue
                case .pausing: pausing = newValue
                case .paused: paused = newValue
                case .review: review = newValue
                case .orphaned: orphaned = newValue
                case .done: done = newValue
                case .failed: failed = newValue
                case .cancelled: cancelled = newValue
                }
            }
        }
    }

    public struct ColumnColor: Equatable, Sendable {
        public var icon: RGBA
        public var title: RGBA
        /// The hood of the column's cards; `nil` is the icon's color.
        public var hood: RGBA? = nil
    }

    public enum BarFill: Equatable, Sendable {
        /// The column's icon color, and the failed status color for a failed run.
        case status
        case color(RGBA)
    }

    public struct Bar: Equatable, Sendable {
        public var fill: BarFill
        public var track: RGBA
    }

    public struct CIColors: Equatable, Sendable {
        public var pending: RGBA
        public var passing: RGBA
        public var failing: RGBA
        public var none: RGBA
    }

    public struct Colors: Equatable, Sendable {
        public var ground: RGBA
        public var sidebar: RGBA
        public var surface: RGBA
        public var surfaceHover: RGBA
        public var field: RGBA
        public var border: RGBA
        public var borderHover: RGBA
        public var divider: RGBA
        public var cardDivider: RGBA
        public var rowDivider: RGBA
        public var title: RGBA
        public var heading: RGBA
        public var text: RGBA
        public var secondary: RGBA
        public var muted: RGBA
        public var faint: RGBA
        public var pendingMark: RGBA
        public var agent: RGBA
        /// Links, toggles and the logo.
        public var accent: RGBA
        /// The focus ring and the selected card's border.
        public var focus: RGBA
        public var selection: RGBA
        public var widget: RGBA
        public var widgetBorder: RGBA
        public var widgetHover: RGBA
        public var status: StatusStyles
        public var columns: PerColumn<ColumnColor>
        public var bar: Bar
        public var ci: CIColors
    }

    public struct FontSpec: Equatable, Sendable {
        /// `nil` is the system font (monospaced for `mono`).
        public var family: String?
        public var file: ThemeAsset?
        /// CSS-style, 100 to 900. `nil` leaves it to each view.
        public var weight: Int?
        /// In em, like CSS `letter-spacing`.
        public var tracking: Double
    }

    public struct Fonts: Equatable, Sendable {
        public var display: FontSpec
        public var body: FontSpec
        public var mono: FontSpec
    }

    public struct Background: Equatable, Sendable {
        public var file: ThemeAsset
        /// The tile's side, in points.
        public var size: Double
    }

    public struct Divider: Equatable, Sendable {
        public var file: ThemeAsset
        public var width: Double
    }

    /// A 9-slice: `slice` px from each edge of the image, drawn as a `width` pt border.
    public struct Frame: Equatable, Sendable {
        public var file: ThemeAsset
        public var slice: Double
        public var width: Double
    }

    public struct Band: Equatable, Sendable {
        public var file: ThemeAsset
        public var height: Double
    }

    public struct Images: Equatable, Sendable {
        public var background: Background?
        public var divider: Divider?
        public var frame: Frame?
        public var band: Band?
    }

    public enum BarShape: String, Sendable {
        case continuous
        /// One block per stage.
        case blocks
    }

    public enum Bullet: String, Sendable {
        case dot
        case gem
    }

    public struct Shapes: Equatable, Sendable {
        public var radius: Double
        public var bar: BarShape
        public var bullet: Bullet
        public var statusIcon: StatusIcon
        public var columnIcons: PerColumn<ThemeIcon>
        public var projectIcon: ThemeIcon
    }

    public struct ColumnText: Equatable, Sendable {
        public var title: String
        public var subtitle: String?

        public init(title: String, subtitle: String? = nil) {
            self.title = title
            self.subtitle = subtitle
        }
    }

    public struct Texts: Equatable, Sendable {
        public var columns: PerColumn<ColumnText>
        public var waitingSection: String
        public var projectsSection: String
        public var all: String
        public var boardTitle: String
        public var counterWorking: String
        public var counterWaiting: String
        public var archive: String
        public var empty: String
    }

    public func style(_ status: RunStatus) -> StatusStyle {
        colors.status[ThemeStatus(status)]
    }

    public func barFill(_ role: ProgressRole) -> RGBA {
        if case .color(let color) = colors.bar.fill { return color }
        switch role {
        case .waiting: return colors.columns.waiting.icon
        case .working: return colors.columns.working.icon
        case .review: return colors.columns.review.icon
        case .onHold: return colors.columns.onHold.icon
        case .finished: return colors.columns.finished.icon
        case .failed: return colors.status.failed.color
        }
    }

    /// The card's hood: the status's own when the theme sets one, else its column's, else the column's icon color.
    public func hood(_ status: RunStatus) -> RGBA {
        let column = colors.columns[StatusGroup(status)]
        return style(status).hood ?? column.hood ?? column.icon
    }

    /// The title and subtitle of a column, by `BoardColumn.id`. A stage column is not themed: it gets `fallback`.
    public func columnText(_ id: String, fallback: String? = nil) -> ColumnText {
        guard let group = StatusGroup(rawValue: id) else { return ColumnText(title: fallback ?? id) }
        return texts.columns[group]
    }
}

extension ThemeSpec {
    /// The look of Wololo Desk before themes, value for value.
    public static let actual: ThemeSpec = {
        let blue = RGBA(hex: 0x5B9DFF)
        let gray = RGBA(hex: 0xA1A7B3)
        let text = RGBA(hex: 0xE8EAED)
        let secondary = RGBA(hex: 0xC3C7CE)
        let muted = RGBA(hex: 0x9AA0AB)
        let heading = RGBA(hex: 0xD5D8DD)
        let dark = RGBA(hex: 0x0B0C0F)
        let neutralBadge = RGBA(hex: 0x333844)

        // The run states take the plugin's tones, as Claude Code's dark-daltonized theme draws them, so a run has the
        // same color in the terminal and here: claude while it works, warning while it waits on the person (or lost its
        // session), merged while its PR is in review, error when it is blocked or failed, success when done, and gray
        // while paused or cancelled.
        let claude = RGBA(hex: 0xFF9933)
        let warning = RGBA(hex: 0xFFCC00)
        let error = RGBA(hex: 0xFF6666)
        let success = RGBA(hex: 0x3399FF)
        let merged = RGBA(hex: 0xAF87FF)

        let waiting = StatusStyle(color: warning, badge: warning, badgeText: dark, activity: RGBA(hex: 0xFFE07A))
        let working = StatusStyle(color: claude, badge: claude, badgeText: dark, activity: secondary)
        let paused = StatusStyle(color: gray, badge: neutralBadge, badgeText: text, activity: muted)
        let failing = StatusStyle(color: error, badge: error, badgeText: dark, activity: RGBA(hex: 0xFF9999))
        let status = StatusStyles(
            waiting: waiting,
            permission: waiting,
            blocked: failing,
            stalled: waiting,
            running: working,
            agents: working,
            tests: working,
            ci: working,
            pausing: working,
            paused: paused,
            review: StatusStyle(color: merged, badge: merged, badgeText: dark, activity: secondary),
            orphaned: waiting,
            done: StatusStyle(color: success, badge: success, badgeText: dark, activity: muted),
            failed: failing,
            cancelled: paused
        )

        return ThemeSpec(
            id: "actual",
            name: "Actual",
            author: nil,
            colors: Colors(
                ground: dark,
                sidebar: RGBA(hex: 0x0F1014),
                surface: RGBA(hex: 0x16181D),
                surfaceHover: RGBA(hex: 0x1A1D23),
                field: RGBA(hex: 0x1A1C21),
                border: RGBA(hex: 0x262A33),
                borderHover: RGBA(hex: 0x3A404C),
                divider: RGBA(hex: 0x1F232B),
                cardDivider: RGBA(hex: 0x22262E),
                rowDivider: RGBA(hex: 0x1D2027),
                title: .white,
                heading: heading,
                text: text,
                secondary: secondary,
                muted: muted,
                faint: RGBA(hex: 0x858C98),
                pendingMark: RGBA(hex: 0x585F6B),
                agent: RGBA(hex: 0xB9A5FF),
                accent: blue,
                focus: blue,
                selection: RGBA(hex: 0x202329),
                widget: RGBA(hex: 0x121418),
                widgetBorder: RGBA(hex: 0x2F343E),
                widgetHover: RGBA(hex: 0x1C1F26),
                status: status,
                columns: PerColumn(
                    waiting: ColumnColor(icon: warning, title: heading),
                    working: ColumnColor(icon: claude, title: heading),
                    review: ColumnColor(icon: merged, title: heading),
                    onHold: ColumnColor(icon: gray, title: heading),
                    finished: ColumnColor(icon: success, title: heading)
                ),
                bar: Bar(fill: .status, track: RGBA(hex: 0x2A2F3A)),
                ci: CIColors(pending: warning, passing: success, failing: error, none: muted)
            ),
            fonts: Fonts(
                display: FontSpec(family: nil, file: nil, weight: 600, tracking: 0),
                body: FontSpec(family: nil, file: nil, weight: nil, tracking: 0),
                mono: FontSpec(family: nil, file: nil, weight: nil, tracking: 0)
            ),
            images: Images(background: nil, divider: nil, frame: nil, band: nil),
            shapes: Shapes(
                radius: 10,
                bar: .continuous,
                bullet: .dot,
                statusIcon: .dot,
                columnIcons: PerColumn(all: .dot),
                projectIcon: .symbol("folder")
            ),
            texts: Texts(
                columns: PerColumn(
                    waiting: ColumnText(title: StatusGroup.waiting.label(.es)),
                    working: ColumnText(title: StatusGroup.working.label(.es)),
                    review: ColumnText(title: StatusGroup.review.label(.es)),
                    onHold: ColumnText(title: StatusGroup.onHold.label(.es)),
                    finished: ColumnText(title: StatusGroup.finished.label(.es) + " · 24 h")
                ),
                waitingSection: "Te esperan",
                projectsSection: "Proyectos",
                all: "Todos",
                boardTitle: "Todos los runs",
                counterWorking: "trabajando",
                counterWaiting: "te esperan",
                archive: "Archivo",
                empty: "Nada acá"
            )
        )
    }()
}

// MARK: Decoding and resolving

/// A resolved theme and what it asks for that is not there, such as a missing font or image file.
public struct ResolvedTheme: Equatable, Sendable {
    public let spec: ThemeSpec
    public let warnings: [String]
}

extension ThemeFile {
    public static let supportedVersion = 1

    public static func decode(_ data: Data) throws -> ThemeFile {
        struct Header: Decodable { let version: Int? }
        let decoder = JSONDecoder()
        do {
            let version = try decoder.decode(Header.self, from: data).version
            guard version == supportedVersion else { throw ThemeError.unsupportedVersion(version) }
            return try decoder.decode(ThemeFile.self, from: data)
        } catch let error as ThemeError {
            throw error
        } catch let error as DecodingError {
            throw ThemeError.invalidJSON(Self.describe(error))
        } catch {
            throw ThemeError.invalidJSON(error.localizedDescription)
        }
    }

    /// The complete theme: what this file sets, and the rest from `base`. File references must stay inside
    /// `directory`; a file that is not there is a warning, not an error.
    public func resolve(over base: ThemeSpec = .actual, directory: URL) throws -> ResolvedTheme {
        let resolver = ThemeResolver(directory: directory)
        let spec = try resolver.resolve(self, over: base)
        return ResolvedTheme(spec: spec, warnings: resolver.warnings)
    }

    private static func describe(_ error: DecodingError) -> String {
        func key(_ path: [CodingKey]) -> String {
            path.isEmpty ? "la raíz" : path.map { $0.intValue.map(String.init) ?? $0.stringValue }.joined(separator: ".")
        }
        switch error {
        case .dataCorrupted(let context):
            if let underlying = context.underlyingError as NSError? {
                return underlying.userInfo[NSDebugDescriptionErrorKey] as? String ?? context.debugDescription
            }
            return context.debugDescription
        case .typeMismatch(_, let context), .valueNotFound(_, let context):
            return "\(key(context.codingPath)) tiene un tipo inesperado"
        case .keyNotFound(let missing, let context):
            return "falta \(key(context.codingPath + [missing]))"
        @unknown default:
            return error.localizedDescription
        }
    }
}

private final class ThemeResolver {
    let directory: URL
    let realDirectory: String?
    var warnings: [String] = []

    init(directory: URL) {
        self.directory = directory.standardizedFileURL
        realDirectory = canonicalPath(self.directory.path)
    }

    func resolve(_ file: ThemeFile, over base: ThemeSpec) throws -> ThemeSpec {
        let id = text(file.id, directory.lastPathComponent)
        return ThemeSpec(
            id: id,
            name: text(file.name, id),
            author: file.author.flatMap { nonEmpty($0) },
            colors: try colors(file.colors, base.colors),
            fonts: try fonts(file.fonts, base.fonts),
            images: try images(file.images, base.images),
            shapes: try shapes(file.shapes, base.shapes),
            texts: texts(file.texts, base.texts)
        )
    }

    // MARK: Colors

    private func colors(_ file: ThemeFile.Colors?, _ base: ThemeSpec.Colors) throws -> ThemeSpec.Colors {
        guard let file else { return base }
        func c(_ value: String?, _ fallback: RGBA, _ key: String) throws -> RGBA {
            try color(value, fallback, "colors.\(key)")
        }
        return ThemeSpec.Colors(
            ground: try c(file.ground, base.ground, "ground"),
            sidebar: try c(file.sidebar, base.sidebar, "sidebar"),
            surface: try c(file.surface, base.surface, "surface"),
            surfaceHover: try c(file.surfaceHover, base.surfaceHover, "surfaceHover"),
            field: try c(file.field, base.field, "field"),
            border: try c(file.border, base.border, "border"),
            borderHover: try c(file.borderHover, base.borderHover, "borderHover"),
            divider: try c(file.divider, base.divider, "divider"),
            cardDivider: try c(file.cardDivider, base.cardDivider, "cardDivider"),
            rowDivider: try c(file.rowDivider, base.rowDivider, "rowDivider"),
            title: try c(file.title, base.title, "title"),
            heading: try c(file.heading, base.heading, "heading"),
            text: try c(file.text, base.text, "text"),
            secondary: try c(file.secondary, base.secondary, "secondary"),
            muted: try c(file.muted, base.muted, "muted"),
            faint: try c(file.faint, base.faint, "faint"),
            pendingMark: try c(file.pendingMark, base.pendingMark, "pendingMark"),
            agent: try c(file.agent, base.agent, "agent"),
            accent: try c(file.accent, base.accent, "accent"),
            focus: try c(file.focus, base.focus, "focus"),
            selection: try c(file.selection, base.selection, "selection"),
            widget: try c(file.widget, base.widget, "widget"),
            widgetBorder: try c(file.widgetBorder, base.widgetBorder, "widgetBorder"),
            widgetHover: try c(file.widgetHover, base.widgetHover, "widgetHover"),
            status: try statusStyles(file.status, base.status),
            columns: try columns(file.columns, base.columns, "colors.columns") { column, fallback, key in
                ThemeSpec.ColumnColor(
                    icon: try color(column?.icon, fallback.icon, "\(key).icon"),
                    title: try color(column?.title, fallback.title, "\(key).title"),
                    hood: try optionalColor(column?.hood, fallback.hood, "\(key).hood")
                )
            },
            bar: ThemeSpec.Bar(
                fill: try barFill(file.bar?.fill, base.bar.fill),
                track: try c(file.bar?.track, base.bar.track, "bar.track")
            ),
            ci: ThemeSpec.CIColors(
                pending: try c(file.ci?.pending, base.ci.pending, "ci.pending"),
                passing: try c(file.ci?.passing, base.ci.passing, "ci.passing"),
                failing: try c(file.ci?.failing, base.ci.failing, "ci.failing"),
                none: try c(file.ci?.none, base.ci.none, "ci.none")
            )
        )
    }

    private func statusStyles(_ file: [String: ThemeFile.Colors.Status]?, _ base: ThemeSpec.StatusStyles) throws -> ThemeSpec.StatusStyles {
        guard let file else { return base }
        var styles = base
        for (name, status) in file.sorted(by: { $0.key < $1.key }) {
            guard let key = ThemeStatus(rawValue: name) else { throw ThemeError.invalidValue(key: "colors.status", value: name) }
            let fallback = base[key]
            let path = "colors.status.\(name)"
            styles[key] = ThemeSpec.StatusStyle(
                color: try color(status.color, fallback.color, "\(path).color"),
                badge: try color(status.badge, fallback.badge, "\(path).badge"),
                badgeText: try color(status.badgeText, fallback.badgeText, "\(path).badgeText"),
                activity: try color(status.activity, fallback.activity, "\(path).activity"),
                hood: try optionalColor(status.hood, fallback.hood, "\(path).hood")
            )
        }
        return styles
    }

    private func barFill(_ value: String?, _ base: ThemeSpec.BarFill) throws -> ThemeSpec.BarFill {
        guard let value else { return base }
        if value == "status" { return .status }
        return .color(try color(value, .white, "colors.bar.fill"))
    }

    private func color(_ value: String?, _ base: RGBA, _ key: String) throws -> RGBA {
        guard let value else { return base }
        guard let color = RGBA(hex: value) else { throw ThemeError.invalidColor(key: key, value: value) }
        return color
    }

    /// A color a theme may leave unset all the way down, such as a hood that follows its column's icon.
    private func optionalColor(_ value: String?, _ base: RGBA?, _ key: String) throws -> RGBA? {
        guard let value else { return base }
        return try color(value, .white, key)
    }

    // MARK: Fonts

    private func fonts(_ file: ThemeFile.Fonts?, _ base: ThemeSpec.Fonts) throws -> ThemeSpec.Fonts {
        guard let file else { return base }
        return ThemeSpec.Fonts(
            display: try font(file.display, base.display, "fonts.display"),
            body: try font(file.body, base.body, "fonts.body"),
            mono: try font(file.mono, base.mono, "fonts.mono")
        )
    }

    private func font(_ file: ThemeFile.Fonts.Font?, _ base: ThemeSpec.FontSpec, _ key: String) throws -> ThemeSpec.FontSpec {
        guard let file else { return base }
        if let weight = file.weight, !(1...1000).contains(weight) {
            throw ThemeError.invalidValue(key: "\(key).weight", value: String(weight))
        }
        if let tracking = file.tracking, !tracking.isFinite {
            throw ThemeError.invalidValue(key: "\(key).tracking", value: String(tracking))
        }
        return ThemeSpec.FontSpec(
            family: file.family.map { nonEmpty($0) } ?? base.family,
            file: try file.file.map { try asset($0, "\(key).file") } ?? base.file,
            weight: file.weight ?? base.weight,
            tracking: file.tracking ?? base.tracking
        )
    }

    // MARK: Images

    private func images(_ file: ThemeFile.Images?, _ base: ThemeSpec.Images) throws -> ThemeSpec.Images {
        guard let file else { return base }
        var images = base
        if let background = file.background {
            images.background = ThemeSpec.Background(
                file: try imageFile(background.file, base.background?.file, "images.background.file"),
                size: try length(background.size, base.background?.size, "images.background.size")
            )
        }
        if let divider = file.divider {
            images.divider = ThemeSpec.Divider(
                file: try imageFile(divider.file, base.divider?.file, "images.divider.file"),
                width: try length(divider.width, base.divider?.width, "images.divider.width")
            )
        }
        if let frame = file.frame {
            images.frame = ThemeSpec.Frame(
                file: try imageFile(frame.file, base.frame?.file, "images.frame.file"),
                slice: try length(frame.slice, base.frame?.slice, "images.frame.slice"),
                width: try length(frame.width, base.frame?.width, "images.frame.width")
            )
        }
        if let band = file.band {
            images.band = ThemeSpec.Band(
                file: try imageFile(band.file, base.band?.file, "images.band.file"),
                height: try length(band.height, base.band?.height, "images.band.height")
            )
        }
        return images
    }

    private func imageFile(_ path: String?, _ base: ThemeAsset?, _ key: String) throws -> ThemeAsset {
        if let path { return try asset(path, key) }
        guard let base else { throw ThemeError.missingField(key: key) }
        return base
    }

    private func length(_ value: Double?, _ base: Double?, _ key: String) throws -> Double {
        guard let value = value ?? base else { throw ThemeError.missingField(key: key) }
        guard value.isFinite, value > 0 else { throw ThemeError.invalidValue(key: key, value: String(value)) }
        return value
    }

    // MARK: Shapes

    private func shapes(_ file: ThemeFile.Shapes?, _ base: ThemeSpec.Shapes) throws -> ThemeSpec.Shapes {
        guard let file else { return base }
        if let radius = file.radius, !(radius.isFinite && radius >= 0) {
            throw ThemeError.invalidValue(key: "shapes.radius", value: String(radius))
        }
        return ThemeSpec.Shapes(
            radius: file.radius ?? base.radius,
            bar: try choice(file.bar, base.bar, "shapes.bar"),
            bullet: try choice(file.bullet, base.bullet, "shapes.bullet"),
            statusIcon: try statusIcon(file.statusIcon, base.statusIcon),
            columnIcons: try columns(file.columnIcons, base.columnIcons, "shapes.columnIcons") { value, fallback, key in
                try icon(value, fallback, key)
            },
            projectIcon: try icon(file.projectIcon, base.projectIcon, "shapes.projectIcon")
        )
    }

    private func choice<Value: RawRepresentable>(_ value: String?, _ base: Value, _ key: String) throws -> Value where Value.RawValue == String {
        guard let value else { return base }
        guard let choice = Value(rawValue: value) else { throw ThemeError.invalidValue(key: key, value: value) }
        return choice
    }

    private func statusIcon(_ value: String?, _ base: StatusIcon) throws -> StatusIcon {
        guard let value else { return base }
        switch value {
        case "dot": return .dot
        case "hood": return .hood
        default:
            guard let path = argument(value, "image") else {
                throw ThemeError.invalidValue(key: "shapes.statusIcon", value: value)
            }
            return .image(try asset(path, "shapes.statusIcon"))
        }
    }

    private func icon(_ value: String?, _ base: ThemeIcon, _ key: String) throws -> ThemeIcon {
        guard let value else { return base }
        if value == "dot" { return .dot }
        if let name = argument(value, "symbol") { return .symbol(name) }
        if let name = argument(value, "builtin") { return .builtin(name) }
        if let path = argument(value, "image") { return .image(try asset(path, key)) }
        throw ThemeError.invalidValue(key: key, value: value)
    }

    /// `"image:castle.png"` with prefix `image` is `castle.png`; `nil` for another prefix or an empty argument.
    private func argument(_ value: String, _ prefix: String) -> String? {
        guard value.hasPrefix(prefix + ":") else { return nil }
        return nonEmpty(String(value.dropFirst(prefix.count + 1)))
    }

    // MARK: Texts

    private func texts(_ file: ThemeFile.Texts?, _ base: ThemeSpec.Texts) -> ThemeSpec.Texts {
        guard let file else { return base }
        var columns = base.columns
        for group in StatusGroup.allCases {
            guard let column = file.columns?[group] else { continue }
            let fallback = base.columns[group]
            columns[group] = ThemeSpec.ColumnText(
                title: text(column.title, fallback.title),
                subtitle: column.subtitle.map { nonEmpty($0) } ?? fallback.subtitle
            )
        }
        return ThemeSpec.Texts(
            columns: columns,
            waitingSection: text(file.waitingSection, base.waitingSection),
            projectsSection: text(file.projectsSection, base.projectsSection),
            all: text(file.all, base.all),
            boardTitle: text(file.boardTitle, base.boardTitle),
            counterWorking: text(file.counterWorking, base.counterWorking),
            counterWaiting: text(file.counterWaiting, base.counterWaiting),
            archive: text(file.archive, base.archive),
            empty: text(file.empty, base.empty)
        )
    }

    private func text(_ value: String?, _ base: String) -> String {
        value.flatMap { nonEmpty($0) } ?? base
    }

    private func nonEmpty(_ value: String) -> String? {
        value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : value
    }

    // MARK: Columns

    private func columns<Entry, Value>(
        _ file: ThemeFile.Columns<Entry>?,
        _ base: PerColumn<Value>,
        _ key: String,
        _ merge: (Entry?, Value, String) throws -> Value
    ) rethrows -> PerColumn<Value> {
        guard let file else { return base }
        var result = base
        for group in StatusGroup.allCases {
            result[group] = try merge(file[group], base[group], "\(key).\(group.rawValue)")
        }
        return result
    }

    // MARK: Paths

    /// A file of the theme's folder. Absolute paths, `..` and symlinks that lead out of the folder are refused.
    private func asset(_ path: String, _ key: String) throws -> ThemeAsset {
        guard nonEmpty(path) != nil else { throw ThemeError.invalidValue(key: key, value: path) }
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !path.hasPrefix("/"), !path.hasPrefix("~"), !path.contains("\\"), !path.contains("\0"),
              !components.contains("..") else {
            throw ThemeError.unsafePath(key: key, path: path)
        }
        let url = directory.appendingPathComponent(path).standardizedFileURL
        guard let realDirectory, let real = canonicalPath(url.path), real.hasPrefix(realDirectory + "/") else {
            throw ThemeError.unsafePath(key: key, path: path)
        }
        if !FileManager.default.fileExists(atPath: url.path) {
            warnings.append("\(key): no existe \(path)")
        }
        return ThemeAsset(path: path, url: url)
    }
}

/// The path with every symlink resolved, also for a file that does not exist yet: its deepest existing folder is
/// resolved and the rest appended. `nil` when a component exists but cannot be resolved, such as a broken symlink.
private func canonicalPath(_ path: String) -> String? {
    var head = path
    var tail: [String] = []
    while true {
        if let real = realpath(head, nil) {
            defer { free(real) }
            var url = URL(fileURLWithPath: String(cString: real))
            for component in tail.reversed() {
                url.appendPathComponent(component)
            }
            return url.path
        }
        var info = stat()
        if lstat(head, &info) == 0 { return nil }
        let parent = (head as NSString).deletingLastPathComponent
        guard parent != head, !parent.isEmpty else { return nil }
        tail.append((head as NSString).lastPathComponent)
        head = parent
    }
}

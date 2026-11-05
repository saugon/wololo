import AppKit
import SwiftUI
import WololoKit

/// The colors and type of the approved mockup. The app is always dark, with solid colors: `cacheDisplay` does not
/// draw vibrancy, and the snapshots must look like the app.
enum Theme {
    static let ground = Color(hex: 0x0B0C0F)
    static let sidebar = Color(hex: 0x0F1014)
    static let surface = Color(hex: 0x16181D)
    static let border = Color(hex: 0x262A33)
    static let divider = Color(hex: 0x1F232B)

    static let text = Color(hex: 0xE8EAED)
    static let secondary = Color(hex: 0xC3C7CE)
    static let muted = Color(hex: 0x9AA0AB)
    static let faint = Color(hex: 0x858C98)

    static let amber = Color(hex: 0xF5A524)
    static let blue = Color(hex: 0x5B9DFF)
    static let green = Color(hex: 0x3FB950)
    static let red = Color(hex: 0xE5484D)
    static let gray = Color(hex: 0xA1A7B3)

    /// Rows and cards under the pointer, and the selected project's rounded background.
    static let hover = Color(hex: 0x1A1D23)
    static let selection = Color(hex: 0x202329)
    static let field = Color(hex: 0x1A1C21)
    static let track = Color(hex: 0x2A2F3A)
    static let cardDivider = Color(hex: 0x22262E)
    static let hoverBorder = Color(hex: 0x3A404C)
    static let heading = Color(hex: 0xD5D8DD)
    static let agent = Color(hex: 0xB9A5FF)

    static let groundColor = NSColor(hex: 0x0B0C0F)

    /// The status badge and the activity line of a card, as in the mockup's status table.
    struct StatusStyle {
        let badgeBackground: Color
        let badgeForeground: Color
        let activity: Color
    }

    static func style(_ status: RunStatus) -> StatusStyle {
        let dark = Color(hex: 0x0B0C0F)
        let neutral = StatusStyle(badgeBackground: Color(hex: 0x333844), badgeForeground: text, activity: secondary)
        switch status {
        case .waitingUser, .waitingPermission, .stalled:
            return StatusStyle(badgeBackground: amber, badgeForeground: dark, activity: Color(hex: 0xF7C46C))
        case .blocked:
            return StatusStyle(badgeBackground: Color(hex: 0xC9373D), badgeForeground: .white, activity: Color(hex: 0xFF8A8E))
        case .running, .waitingTests, .waitingCI:
            return StatusStyle(badgeBackground: Color(hex: 0x1F3A66), badgeForeground: Color(hex: 0xDCE8FF), activity: secondary)
        case .waitingAgents:
            return StatusStyle(badgeBackground: Color(hex: 0x3A2F66), badgeForeground: Color(hex: 0xE6DEFF), activity: secondary)
        case .pausing, .unknown:
            return neutral
        case .paused, .cancelled:
            return StatusStyle(badgeBackground: neutral.badgeBackground, badgeForeground: text, activity: muted)
        case .orphaned:
            return StatusStyle(badgeBackground: Color(hex: 0x5A3A1A), badgeForeground: Color(hex: 0xFFE2C2), activity: Color(hex: 0xE9B98A))
        case .done:
            return StatusStyle(badgeBackground: Color(hex: 0x1E4D2B), badgeForeground: Color(hex: 0xD7F5DD), activity: muted)
        case .failed:
            return StatusStyle(badgeBackground: Color(hex: 0x8E2A2E), badgeForeground: .white, activity: Color(hex: 0xFF8A8E))
        }
    }

    /// The small status dot of the sidebar and the archive: the progress bar's color, so a run reads the same
    /// everywhere; a cancelled run is gray rather than green.
    static func dot(_ status: RunStatus) -> Color {
        if status == .cancelled { return gray }
        if status == .blocked { return red }
        switch StatusGroup(status) {
        case .waiting: return amber
        case .working: return blue
        case .onHold: return gray
        case .finished: return status == .failed ? red : green
        }
    }

    static func color(_ ci: CIRole?) -> Color {
        switch ci {
        case .pending: return amber
        case .passing: return green
        case .failing: return Color(hex: 0xFF8A8E)
        case nil: return muted
        }
    }

    static func color(_ group: StatusGroup) -> Color {
        switch group {
        case .waiting: return amber
        case .working: return blue
        case .onHold: return gray
        case .finished: return green
        }
    }

    static func color(_ role: ProgressRole) -> Color {
        switch role {
        case .waiting: return amber
        case .working: return blue
        case .onHold: return gray
        case .finished: return green
        case .failed: return red
        }
    }

    enum Font {
        static let title = SwiftUI.Font.system(size: 15, weight: .semibold)
        static let body = SwiftUI.Font.system(size: 13)
        static let label = SwiftUI.Font.system(size: 12, weight: .medium)
        static let caption = SwiftUI.Font.system(size: 11.5)
        static let mono = SwiftUI.Font.system(size: 11.5).monospaced()
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

extension NSColor {
    convenience init(hex: UInt32) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

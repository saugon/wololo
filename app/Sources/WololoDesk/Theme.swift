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

    static let groundColor = NSColor(hex: 0x0B0C0F)

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

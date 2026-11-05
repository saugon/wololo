import AppKit
import SwiftUI

/// A short message shown for a moment over the window's content, as "Copié /wololo resume …: pegalo en la terminal".
struct Toast: Identifiable, Equatable {
    let id = UUID()
    let lines: [String]
    /// For what is said while another app comes to the front (a new terminal): it stays at least 8 s, and until this
    /// app is active again, so the person sees it on coming back.
    var holdsUntilActive = false

    /// Three seconds for one line, a little longer when there is more to read.
    var duration: TimeInterval {
        if holdsUntilActive { return 8 }
        return lines.count > 1 ? 5 : 3
    }

    /// How long a held toast waits for the app to come back before going away anyway, as in the widget, which does
    /// not activate the app.
    static let maxHold: TimeInterval = 60
    /// How long a held toast stays once the app is active again.
    static let afterReturn: TimeInterval = 3
}

extension AppState {
    /// Shows the lines in a toast that goes away by itself; a newer toast replaces the one on screen.
    func showToast(_ lines: [String], holdsUntilActive: Bool = false) {
        guard !lines.isEmpty else { return }
        let toast = Toast(lines: lines, holdsUntilActive: holdsUntilActive)
        self.toast = toast
        AccessibilityNotification.Announcement(lines.joined(separator: ". ")).post()
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(toast.duration))
            if toast.holdsUntilActive && !NSApp.isActive {
                var waited = toast.duration
                while !NSApp.isActive && waited < Toast.maxHold && self?.toast?.id == toast.id {
                    try? await Task.sleep(for: .milliseconds(500))
                    waited += 0.5
                }
                try? await Task.sleep(for: .seconds(Toast.afterReturn))
            }
            if self?.toast?.id == toast.id { self?.toast = nil }
        }
    }
}

extension View {
    /// The state's toast at the bottom of this view, fading in and out. The window and the widget both use it.
    func toast(_ toast: Toast?) -> some View {
        overlay(alignment: .bottom) {
            ZStack {
                if let toast {
                    ToastView(toast: toast)
                        .id(toast.id)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
            .animation(.easeOut(duration: 0.2), value: toast)
        }
    }
}

struct ToastView: View {
    let toast: Toast

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(toast.lines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .font(.system(size: 13))
        .foregroundStyle(Theme.text)
        .multilineTextAlignment(.leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: 560, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.hoverBorder, lineWidth: 1))
        .shadow(color: .black.opacity(0.4), radius: 12, y: 4)
        .accessibilityElement(children: .combine)
    }
}

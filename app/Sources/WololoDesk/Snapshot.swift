import AppKit
import WololoKit

/// `WOLOLO_DESK_SNAPSHOT=<png>`: draws the window `WOLOLO_DESK_OPEN` asked for into a PNG and quits, so the UI can be
/// checked without the Screen Recording permission. A menu cannot be drawn this way, so the menu bar count goes to
/// stdout as `menubar-count=<n>`.
@MainActor
enum Snapshot {
    /// Long enough for SwiftUI's first layout and for the model's first read of the store.
    static let settleDelay: TimeInterval = 1.0

    static func take(of window: @escaping () -> NSWindow?, to url: URL, state: AppState) {
        DispatchQueue.main.asyncAfter(deadline: .now() + settleDelay) {
            let model = state.model
            print("menubar-count=\(menuBarCount(model.runs, now: model.now))")
            do {
                guard let window = window() else { throw SnapshotError.noWindow }
                try write(window, to: url)
                print("snapshot=\(url.path)")
                fflush(stdout)
                NSApp.terminate(nil)
            } catch {
                fflush(stdout)
                FileHandle.standardError.write(Data("snapshot failed: \(error)\n".utf8))
                exit(1)
            }
        }
    }

    private static func write(_ window: NSWindow, to url: URL) throws {
        guard let view = window.contentView else { throw SnapshotError.noWindow }
        view.layoutSubtreeIfNeeded()
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw SnapshotError.noBitmap }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else { throw SnapshotError.noBitmap }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try png.write(to: url)
    }

    enum SnapshotError: Error, CustomStringConvertible {
        case noWindow
        case noBitmap

        var description: String {
            switch self {
            case .noWindow: return "the requested view has no window yet"
            case .noBitmap: return "the window could not be drawn"
            }
        }
    }
}

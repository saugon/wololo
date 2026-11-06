import AppKit
import ImageIO
import SwiftUI
import WololoKit

/// The run's screenshots in a grid with their captions. A click opens the image in the default viewer.
struct ScreenshotsTab: View {
    let screenshots: [Run.Screenshot]
    let runDir: URL
    /// A new snapshot may come with an image written after its entry: the tiles look at their file again.
    let updatedAt: TimeInterval

    @Environment(\.theme) private var theme

    var body: some View {
        Group {
            if screenshots.isEmpty {
                Text("Las capturas llegan en la etapa Evidencia.")
                    .font(theme.font(.body, size: 13))
                    .foregroundStyle(theme.faint)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 14, alignment: .top)], alignment: .leading, spacing: 14) {
                    ForEach(screenshots, id: \.file) { shot in
                        ScreenshotTile(shot: shot, url: screenshotURL(shot, runDir: runDir), updatedAt: updatedAt)
                    }
                }
            }
        }
        .padding(18)
    }
}

private struct ScreenshotTile: View {
    /// Thumbnails are drawn at most 220 pt wide on a 2x screen, with room to spare.
    nonisolated static let maxPixelSize = 600

    let shot: Run.Screenshot
    let url: URL?
    let updatedAt: TimeInterval

    @State private var image: NSImage?
    /// The file the thumbnail was made from, nil while there is none.
    @State private var loaded: FileStamp?
    @State private var loadedURL: URL?
    @State private var isHovered = false
    @Environment(\.theme) private var theme

    private struct LoadKey: Hashable {
        let url: URL?
        let updatedAt: TimeInterval
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: open) {
                thumbnail
            }
            .buttonStyle(.plain)
            .disabled(image == nil)
            .help(url?.path ?? shot.file)
            .accessibilityLabel(shot.caption.isEmpty ? shot.file : shot.caption)
            .accessibilityHint(image == nil ? "No se encontró la imagen" : "Abre la imagen")
            if !shot.caption.isEmpty {
                Text(shot.caption)
                    .font(theme.font(.body, size: 12.5))
                    .foregroundStyle(theme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
        }
        .task(id: LoadKey(url: url, updatedAt: updatedAt)) {
            await load()
        }
    }

    private var thumbnail: some View {
        theme.sidebar
            .aspectRatio(16 / 10, contentMode: .fit)
            .overlay {
                if let image {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFit()
                } else {
                    Text((shot.file as NSString).lastPathComponent)
                        .font(theme.font(.mono, size: 11.5))
                        .foregroundStyle(theme.faint)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .padding(12)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: theme.r(8)))
            .overlay(
                RoundedRectangle(cornerRadius: theme.r(8))
                    .strokeBorder(isHovered && image != nil ? theme.borderHover : theme.border, lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: theme.r(8)))
            .onHover { isHovered = $0 }
    }

    /// Makes the thumbnail off the main thread, only when the file appeared or changed since the last one.
    private func load() async {
        guard let url else {
            image = nil
            loaded = nil
            loadedURL = nil
            return
        }
        let previous = url == loadedURL ? loaded : nil
        let result = await Task.detached(priority: .utility) { () -> Thumbnail? in
            let stamp = FileStamp(url)
            if stamp == previous { return nil }
            return Thumbnail(stamp: stamp, image: stamp == nil ? nil : Self.thumbnail(of: url))
        }.value
        guard let result, !Task.isCancelled else { return }
        loaded = result.stamp
        loadedURL = url
        image = result.image.map { NSImage(cgImage: $0, size: .zero) }
    }

    private struct Thumbnail: @unchecked Sendable {
        let stamp: FileStamp?
        /// A CGImage is immutable once made, so handing it to the main actor is safe.
        let image: CGImage?
    }

    nonisolated private static func thumbnail(of url: URL) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    private func open() {
        guard let url else { return }
        NSWorkspace.shared.open(url)
    }
}

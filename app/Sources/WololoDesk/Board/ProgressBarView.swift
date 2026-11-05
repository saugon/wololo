import SwiftUI
import WololoKit

/// The run's progress, the same on the card, the widget and the detail: one straight, square bar in the color of
/// the status group, with `n/8 · Etapa` (or only `n/8`) beside it.
struct ProgressBarView: View {
    enum Caption {
        case none
        /// `n/8`, for the widget.
        case short
        /// `n/8 · Etapa`.
        case full
    }

    let progress: RunProgress
    var height: CGFloat = 4
    var caption: Caption = .full
    var captionFont: Font = .system(size: 12)
    var spacing: CGFloat = 12

    var body: some View {
        HStack(spacing: spacing) {
            bar
            if let text = captionText {
                Text(text)
                    .font(captionFont)
                    .foregroundStyle(Theme.secondary)
                    .lineLimit(1)
                    .fixedSize()
                    .accessibilityHidden(true)
            }
        }
    }

    private var bar: some View {
        GeometryReader { proxy in
            Rectangle()
                .fill(Theme.color(progress.role))
                .frame(width: proxy.size.width * min(max(progress.fraction, 0), 1))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 80)
        .frame(height: min(max(height, 3), 6))
        .background(Theme.track)
        .accessibilityRepresentation {
            ProgressView(value: min(max(progress.fraction, 0), 1))
                .accessibilityLabel(progress.accessibilityLabel)
        }
    }

    private var captionText: String? {
        switch caption {
        case .none: return nil
        case .short: return progress.shortText
        case .full: return progress.text
        }
    }
}

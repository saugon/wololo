import SwiftUI
import WololoKit

/// The columns side by side, each at least 300 pt wide with a 1 pt divider between them, and the collapsible
/// archive of runs finished before the last 24 h underneath.
struct BoardView: View {
    static let minColumnWidth: CGFloat = 300
    static let cardMargin: CGFloat = 20

    let board: Board
    let mode: BoardMode
    let now: TimeInterval
    let selectedRunID: String?
    let select: (String) -> Void

    @State private var isArchiveOpen = false
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { proxy in
                let count = CGFloat(max(board.columns.count, 1))
                let width = max(Self.minColumnWidth, (proxy.size.width / count).rounded(.down))
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(Array(board.columns.enumerated()), id: \.element.id) { index, column in
                            columnView(column, index: index, width: width)
                                .frame(width: width, height: proxy.size.height)
                                .overlay(alignment: .trailing) {
                                    theme.divider.frame(width: 1)
                                }
                        }
                    }
                }
                .scrollIndicators(.automatic)
            }
            ThemeBand()
            archive
        }
    }

    private func columnView(_ column: BoardColumn, index: Int, width: CGFloat) -> some View {
        let text = columnText(of: column, index: index)
        let group = group(of: column)
        return VStack(spacing: 0) {
            HStack(spacing: 10) {
                ThemeIconView(icon: theme.spec.shapes.columnIcons[group], color: theme.columnIcon(group), size: 20)
                VStack(alignment: .leading, spacing: 1) {
                    Text(text.title)
                        .font(theme.font(.display, size: 15, weight: .bold))
                        .tracking(theme.tracking(.display, size: 15))
                        .foregroundStyle(theme.columnTitle(group))
                        .lineLimit(1)
                    if let subtitle = text.subtitle {
                        Text(subtitle)
                            .font(theme.font(.body, size: 13))
                            .foregroundStyle(theme.muted)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text("\(column.count)")
                    .font(theme.font(.body, size: 20, weight: .bold).monospacedDigit())
                    .foregroundStyle(theme.title)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .help(column.id == StatusGroup.finished.rawValue ? "Terminados en las últimas 24 h" : "")
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            theme.divider.frame(height: 1)

            ScrollView(.vertical) {
                LazyVStack(spacing: 16) {
                    if column.runs.isEmpty {
                        Text(theme.spec.texts.empty)
                            .font(theme.font(.body, size: 13))
                            .foregroundStyle(theme.faint)
                            .frame(maxWidth: .infinity)
                            .padding(22)
                            .overlay(
                                RoundedRectangle(cornerRadius: theme.r(10))
                                    .strokeBorder(theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                            )
                    }
                    ForEach(column.runs, id: \.id) { run in
                        RunCard(run: run, now: now, isSelected: run.id == selectedRunID) { select(run.id) }
                            .frame(width: width - 2 * Self.cardMargin)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, Self.cardMargin)
                .padding(.top, 20)
                .padding(.bottom, 28)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel([text.title, text.subtitle].compactMap { $0 }.joined(separator: ", "))
    }

    /// A status column's title and subtitle come from the theme; a stage column is titled "2 · Definición".
    private func columnText(of column: BoardColumn, index: Int) -> ThemeSpec.ColumnText {
        switch mode {
        case .byStatus:
            let text = theme.spec.columnText(column.id, fallback: column.label(.es))
            let subtitle = text.subtitle.flatMap { $0.isEmpty ? nil : $0 }
            return ThemeSpec.ColumnText(title: text.title, subtitle: subtitle)
        case .byStage:
            return ThemeSpec.ColumnText(title: "\(index + 1) · \(column.label(.es))")
        }
    }

    /// The status group whose colors the column takes: its own, or "working" for a stage column.
    private func group(of column: BoardColumn) -> StatusGroup {
        guard mode == .byStatus, let group = StatusGroup(rawValue: column.id) else { return .working }
        return group
    }

    // MARK: Archive

    /// "Archivo · N": the label opens and closes the list of older runs.
    private var archive: some View {
        let label = "\(theme.spec.texts.archive) · \(board.archiveCount)"
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                isArchiveOpen.toggle()
            } label: {
                Text(label)
                    .font(theme.font(.display, size: 13))
                    .tracking(theme.tracking(.display, size: 13))
                    .foregroundStyle(theme.secondary)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Terminados hace más de 24 h")
            .accessibilityLabel("\(theme.spec.texts.archive), \(board.archiveCount) terminados hace más de 24 h")
            .accessibilityValue(isArchiveOpen ? "abierto" : "cerrado")

            if isArchiveOpen {
                archiveList
                    .padding(.bottom, 14)
            }
        }
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var archiveList: some View {
        if board.archive.isEmpty {
            Text("Nada archivado todavía.")
                .font(theme.font(.body, size: 12))
                .foregroundStyle(theme.faint)
                .padding(.vertical, 6)
        } else {
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(Array(board.archive.enumerated()), id: \.element.id) { index, run in
                        ArchiveRow(run: run, now: now, isSelected: run.id == selectedRunID) { select(run.id) }
                        if index < board.archive.count - 1 {
                            theme.cardDivider.frame(height: 1)
                        }
                    }
                }
            }
            .frame(maxHeight: 220)
            .fixedSize(horizontal: false, vertical: true)
            .clipShape(RoundedRectangle(cornerRadius: theme.r(8)))
            .overlay(RoundedRectangle(cornerRadius: theme.r(8)).strokeBorder(theme.cardDivider, lineWidth: 1))
        }
    }
}

private struct ArchiveRow: View {
    let run: Run
    let now: TimeInterval
    let isSelected: Bool
    let select: () -> Void

    @State private var isHovered = false
    @Environment(\.theme) private var theme

    var body: some View {
        let status = effectiveStatus(run, now: now)
        HStack(spacing: 12) {
            Circle()
                .fill(theme.dot(status))
                .frame(width: 8, height: 8)
            Text(run.displayTitle)
                .font(theme.font(.body, size: 13))
                .foregroundStyle(theme.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(run.project.display)
                .font(theme.font(.mono, size: 11.5))
                .foregroundStyle(theme.muted)
                .lineLimit(1)
            Text(ago(run.finishedAt ?? run.updatedAt, now: now, lang: run.lang))
                .font(theme.font(.body, size: 12))
                .foregroundStyle(theme.faint)
                .frame(minWidth: 52, alignment: .trailing)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(isHovered || isSelected ? theme.surfaceHover : Color.clear)
        .onHover { isHovered = $0 }
        .selectable(
            label: run.displayTitle,
            value: [status.label(run.lang), run.project.display, ago(run.finishedAt ?? run.updatedAt, now: now, lang: run.lang)]
                .joined(separator: ", "),
            isSelected: isSelected,
            cornerRadius: 0,
            action: select
        )
    }
}

/// A column's or a project's icon as the theme sets it, in a `size` square: a dot, an SF Symbol or one of the app's
/// own outlines in `color`, or the theme's image as it is. A name the app does not know or an image that does not
/// load shows the dot.
struct ThemeIconView: View {
    let icon: ThemeIcon
    let color: Color
    let size: CGFloat

    @Environment(\.theme) private var theme

    var body: some View {
        Group {
            switch icon {
            case .symbol(let name):
                Image(systemName: name)
                    .font(.system(size: size * 0.75, weight: .regular))
                    .foregroundStyle(color)
            case .builtin(let name):
                if let shape = BuiltinIcon(name) {
                    shape.stroke(color, style: StrokeStyle(lineWidth: shape.lineWidth * size / 22, lineCap: .round,
                                                           lineJoin: .round))
                } else {
                    dot
                }
            case .image(let asset):
                if let image = theme.image(asset) {
                    Image(nsImage: image)
                        .resizable()
                        .interpolation(.high)
                        .scaledToFit()
                } else {
                    dot
                }
            case .dot:
                dot
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private var dot: some View {
        Circle()
            .fill(color)
            .frame(width: size / 2, height: size / 2)
    }
}

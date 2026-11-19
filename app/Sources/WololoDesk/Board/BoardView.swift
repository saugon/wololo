import SwiftUI
import WololoKit

/// The columns side by side, each at least 300 pt wide with a 1 pt divider between them, and underneath two
/// collapsible lists: the paused and orphaned runs, and the archive of runs finished before the last 24 h and of the
/// cancelled ones.
struct BoardView: View {
    static let minColumnWidth: CGFloat = 300
    static let cardMargin: CGFloat = 20

    let board: Board
    let mode: BoardMode
    let now: TimeInterval
    let selectedRunID: String?
    let select: (String) -> Void
    let goToTerminal: (Run) -> Void

    @State private var isOnHoldOpen = false
    @State private var isArchiveOpen = false
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            if mode == .grid {
                grid
            } else {
                columns
            }
            ThemeBand()
            sections
        }
    }

    /// The active runs as large cards, as many per row as fit at `GridCard.minWidth`.
    private var grid: some View {
        let runs = board.columns.first?.runs ?? []
        let finished = board.columns.dropFirst().first?.runs ?? []
        return ScrollView(.vertical) {
            if runs.isEmpty {
                Text(theme.spec.texts.empty)
                    .font(theme.font(.body, size: 13))
                    .foregroundStyle(theme.faint)
                    .frame(maxWidth: .infinity)
                    .padding(22)
                    .overlay(
                        RoundedRectangle(cornerRadius: theme.r(10))
                            .strokeBorder(theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    )
                    .padding(Self.cardMargin)
            }
            gridCards(runs)
                .padding(.top, 20)
                .padding(.bottom, finished.isEmpty ? 28 : 8)
            if !finished.isEmpty {
                let title = theme.spec.columnText(StatusGroup.finished.rawValue, fallback: StatusGroup.finished.label(.es)).title
                HStack(spacing: 8) {
                    Text(title)
                        .font(theme.font(.display, size: 15, weight: .bold))
                        .tracking(theme.tracking(.display, size: 15))
                        .foregroundStyle(theme.columnTitle(.finished))
                    Text("· \(finished.count)")
                        .font(theme.font(.body, size: 15, weight: .bold).monospacedDigit())
                        .foregroundStyle(theme.muted)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, Self.cardMargin)
                .padding(.top, 12)
                .help("Terminados en las últimas 24 h")
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
                gridCards(finished)
                    .padding(.top, 12)
                    .padding(.bottom, 28)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func gridCards(_ runs: [Run]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: GridCard.minWidth), spacing: 16, alignment: .top)], spacing: 16) {
            ForEach(runs, id: \.id) { run in
                GridCard(run: run, now: now, isSelected: run.id == selectedRunID, select: { select(run.id) }) {
                    goToTerminal(run)
                }
            }
        }
        .padding(.horizontal, Self.cardMargin)
    }

    private var columns: some View {
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
                        RunCard(run: run, now: now, isSelected: run.id == selectedRunID, select: { select(run.id) }) {
                            goToTerminal(run)
                        }
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
        case .byStage, .grid:
            return ThemeSpec.ColumnText(title: "\(index + 1) · \(column.label(.es))")
        }
    }

    /// The status group whose colors the column takes: its own, or "working" for a stage column.
    private func group(of column: BoardColumn) -> StatusGroup {
        guard mode == .byStatus, let group = StatusGroup(rawValue: column.id) else { return .working }
        return group
    }

    // MARK: On hold and archive

    /// Under the board, side by side: "En pausa / huérfano · N" (only while there is one) and "Archivo · N". Each label
    /// opens and closes its list, the runs on hold above the older ones.
    private var sections: some View {
        let onHoldTitle = theme.spec.texts.columns.onHold.title
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 28) {
                if !board.onHold.isEmpty {
                    sectionToggle(
                        "\(onHoldTitle) · \(board.onHoldCount)",
                        isOpen: $isOnHoldOpen,
                        help: "En pausa o sin sesión: retomalos desde su terminal con /wololo resume",
                        accessibility: "\(onHoldTitle), \(board.onHoldCount) en pausa o sin sesión"
                    )
                }
                sectionToggle(
                    "\(theme.spec.texts.archive) · \(board.archiveCount)",
                    isOpen: $isArchiveOpen,
                    help: "Terminados hace más de 24 h, y cancelados",
                    accessibility: "\(theme.spec.texts.archive), \(board.archiveCount) terminados hace más de 24 h o cancelados"
                )
            }

            if isOnHoldOpen, !board.onHold.isEmpty {
                sectionList(board.onHold, empty: "") { holdTime($0, now: now) }
                    .padding(.bottom, 14)
            }
            if isArchiveOpen {
                sectionList(board.archive, empty: "Nada archivado todavía.") { $0.finishedAt ?? $0.updatedAt }
                    .padding(.bottom, 14)
            }
        }
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sectionToggle(_ label: String, isOpen: Binding<Bool>, help: String, accessibility: String) -> some View {
        Button {
            isOpen.wrappedValue.toggle()
        } label: {
            Text(label)
                .font(theme.font(.display, size: 13))
                .tracking(theme.tracking(.display, size: 13))
                .foregroundStyle(theme.secondary)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel(accessibility)
        .accessibilityValue(isOpen.wrappedValue ? "abierto" : "cerrado")
    }

    /// The runs as rows, each with how long ago `time` was.
    @ViewBuilder
    private func sectionList(_ runs: [Run], empty: String, time: @escaping (Run) -> TimeInterval) -> some View {
        if runs.isEmpty {
            Text(empty)
                .font(theme.font(.body, size: 12))
                .foregroundStyle(theme.faint)
                .padding(.vertical, 6)
        } else {
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(Array(runs.enumerated()), id: \.element.id) { index, run in
                        ArchiveRow(run: run, now: now, time: time(run), isSelected: run.id == selectedRunID) { select(run.id) }
                        if index < runs.count - 1 {
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

/// A run under the board: its status dot, title, project and when it stopped or finished.
private struct ArchiveRow: View {
    let run: Run
    let now: TimeInterval
    let time: TimeInterval
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
            Text(ago(time, now: now, lang: run.lang))
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
            value: [status.label(run.lang), run.project.display, ago(time, now: now, lang: run.lang)]
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

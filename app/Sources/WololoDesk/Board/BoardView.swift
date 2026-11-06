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
            theme.divider.frame(height: 1)
            archive
        }
    }

    private func columnView(_ column: BoardColumn, index: Int, width: CGFloat) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Circle()
                    .fill(theme.columnIcon(group(of: column)))
                    .frame(width: 10, height: 10)
                Text(label(of: column, index: index))
                    .font(theme.font(.display, size: 14, weight: .medium))
                    .tracking(theme.tracking(.display, size: 14))
                    .foregroundStyle(theme.columnTitle(group(of: column)))
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text("\(column.count)")
                    .font(theme.font(.body, size: 13).monospacedDigit())
                    .foregroundStyle(theme.faint)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            theme.divider.frame(height: 1)

            ScrollView(.vertical) {
                LazyVStack(spacing: 16) {
                    if column.runs.isEmpty {
                        Text("Nada acá")
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
        .accessibilityLabel(label(of: column, index: index))
    }

    private func label(of column: BoardColumn, index: Int) -> String {
        switch mode {
        case .byStatus:
            return column.id == StatusGroup.finished.rawValue ? "\(column.label(.es)) · 24 h" : column.label(.es)
        case .byStage:
            return "\(index + 1) · \(column.label(.es))"
        }
    }

    /// The status group whose colors the column takes: its own, or "working" for a stage column.
    private func group(of column: BoardColumn) -> StatusGroup {
        guard mode == .byStatus, let group = StatusGroup(rawValue: column.id) else { return .working }
        return group
    }

    // MARK: Archive

    private var archive: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                isArchiveOpen.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: isArchiveOpen ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .frame(width: 12)
                    Text("ARCHIVO")
                        .tracking(0.7)
                    Text("\(board.archiveCount)")
                        .foregroundStyle(theme.faint)
                }
                .font(theme.font(.mono, size: 12))
                .foregroundStyle(theme.muted)
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Terminados hace más de 24 h")
            .accessibilityLabel("Archivo, \(board.archiveCount) terminados hace más de 24 h")
            .accessibilityValue(isArchiveOpen ? "abierto" : "cerrado")

            if isArchiveOpen {
                archiveList
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 10)
        .padding(.bottom, 18)
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

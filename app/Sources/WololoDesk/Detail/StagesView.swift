import SwiftUI
import WololoKit

/// The eight stages: a green dot when done, a blue ring on the current one, a gray ring ahead; the gate's outcome
/// and the time spent on the right.
struct StagesView: View {
    let run: Run
    let now: TimeInterval

    var body: some View {
        DetailCard(spacing: 4) {
            CardTitle("Etapas")
                .padding(.bottom, 8)
            ForEach(stageRows(run, now: now)) { row in
                StageRowView(row: row)
            }
        }
    }
}

private struct StageRowView: View {
    let row: StageRow

    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            dot
            Text(row.label)
                .font(theme.font(.body, size: 13, weight: row.state == .current ? .semibold : .regular))
                .foregroundStyle(row.state == .pending ? theme.faint : theme.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let note = row.note {
                Text(note)
                    .font(theme.font(.body, size: 12))
                    .foregroundStyle(theme.faint)
                    .lineLimit(1)
            }
            Text(row.durationText)
                .font(theme.font(.mono, size: 12))
                .foregroundStyle(theme.muted)
                .lineLimit(1)
                .frame(minWidth: 52, alignment: .trailing)
        }
        .frame(minHeight: 26)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var dot: some View {
        let ring: Color
        switch row.state {
        case .done: ring = theme.dot(.done)
        case .current: ring = theme.dot(.running)
        case .pending: ring = theme.borderHover
        }
        return Circle()
            .fill(row.state == .done ? theme.dot(.done) : .clear)
            .overlay(Circle().strokeBorder(ring, lineWidth: 2))
            .frame(width: 10, height: 10)
    }

    private var accessibilityText: String {
        let state: String
        switch row.state {
        case .done: state = "hecha"
        case .current: state = "actual"
        case .pending: state = "pendiente"
        }
        return [row.label, state, row.note, row.durationText.isEmpty ? nil : row.durationText]
            .compactMap { $0 }
            .joined(separator: ", ")
    }
}

import SwiftUI
import WololoKit

/// Time and cost per stage from the run's `time` and `usage`: work, agents, time waiting on the person and USD,
/// with the totals underneath. Tokens show in the cost's tooltip.
struct CostTab: View {
    let table: CostTable

    @Environment(\.theme) private var theme

    var body: some View {
        Group {
            if table.rows.isEmpty {
                Text("Todavía no hay tiempo ni costo registrado.")
                    .font(theme.font(.body, size: 13))
                    .foregroundStyle(theme.faint)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 8)
            } else {
                Grid(alignment: .trailing, horizontalSpacing: 16, verticalSpacing: 0) {
                    GridRow {
                        header("Etapa")
                            .gridColumnAlignment(.leading)
                        header("Trabajo")
                        header("Agentes")
                        header("Esperándote")
                        header("Costo")
                    }
                    ForEach(table.rows) { row in
                        divider
                        line(row, isTotal: false)
                    }
                    divider
                    line(table.total, isTotal: true)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 16)
    }

    private var divider: some View {
        theme.cardDivider
            .frame(height: 1)
            .gridCellUnsizedAxes(.horizontal)
    }

    private func header(_ title: String) -> some View {
        Text(title.uppercased())
            .font(theme.font(.body, size: 11.5, weight: .semibold))
            .tracking(0.7)
            .foregroundStyle(theme.faint)
            .padding(.vertical, 8)
            .accessibilityLabel(title)
    }

    private func line(_ row: CostRow, isTotal: Bool) -> some View {
        GridRow {
            Text(row.label)
                .font(theme.font(.body, size: 13, weight: isTotal ? .semibold : .regular))
                .foregroundStyle(theme.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            time(row.work, isTotal: isTotal)
            time(row.agents, isTotal: isTotal)
            time(row.you, isTotal: isTotal)
            number(usdText(row.usd), isTotal: isTotal)
                .help("\(tokensText(row.tokens)) tokens")
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }

    /// A stage with no time of a kind shows a dash, so the columns read at a glance.
    private func time(_ seconds: TimeInterval, isTotal: Bool) -> some View {
        number(seconds > 0 ? duration(seconds) : "—", isTotal: isTotal, isFaint: seconds <= 0)
    }

    private func number(_ text: String, isTotal: Bool, isFaint: Bool = false) -> some View {
        Text(text)
            .font(theme.font(.mono, size: 12, weight: isTotal ? .semibold : .regular))
            .foregroundStyle(isFaint ? theme.faint : (isTotal ? theme.text : theme.secondary))
            .lineLimit(1)
    }
}

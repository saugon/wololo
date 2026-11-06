import SwiftUI
import WololoKit

/// The plan's items with ✓ done, ● in progress, ○ ahead and the short SHA of each commit; the PR with its CI under
/// them.
struct ItemsView: View {
    let run: Run
    let now: TimeInterval

    @Environment(\.theme) private var theme

    var body: some View {
        DetailCard(spacing: 6) {
            HStack {
                CardTitle("Ítems del plan")
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let chip = itemsChip(run) {
                    Text(chip.text)
                        .font(theme.font(.mono, size: 12))
                        .foregroundStyle(theme.muted)
                        .help(chip.title)
                }
            }
            .padding(.bottom, 6)

            if run.items.list.isEmpty {
                Text("Todavía no hay plan.")
                    .font(theme.font(.body, size: 13))
                    .foregroundStyle(theme.faint)
            }
            ForEach(run.items.list, id: \.n) { item in
                ItemRow(item: item, mark: itemMark(item, in: run, now: now))
            }
            if let pr = prLine(run) {
                PRRow(pr: pr)
                    .padding(.top, 8)
            }
        }
    }
}

private struct ItemRow: View {
    let item: Run.ItemEntry
    let mark: ItemMark

    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            Text(glyph)
                .font(theme.font(.body, size: 13))
                .foregroundStyle(color)
                .frame(width: 18)
            Text("\(item.n). \(item.title)")
                .font(theme.font(.body, size: 13))
                .foregroundStyle(mark == .pending ? theme.muted : theme.text)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let sha = item.sha, !sha.isEmpty {
                Text(String(sha.prefix(7)))
                    .font(theme.font(.mono, size: 11.5))
                    .foregroundStyle(theme.faint)
                    .textSelection(.enabled)
                    .help(sha)
            }
        }
        .frame(minHeight: 26)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.n). \(item.title), \(stateText)")
    }

    private var glyph: String {
        switch mark {
        case .done: return "✓"
        case .active: return "●"
        case .failing: return "!"
        case .pending: return "○"
        }
    }

    private var color: Color {
        switch mark {
        case .done: return theme.dot(.done)
        case .active: return theme.dot(.running)
        case .failing: return theme.ci(.failing)
        case .pending: return theme.pendingMark
        }
    }

    private var stateText: String {
        switch mark {
        case .done: return "hecho"
        case .active: return "en curso"
        case .failing: return "tests fallando"
        case .pending: return "pendiente"
        }
    }
}

private struct PRRow: View {
    let pr: PRLine

    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "arrow.triangle.pull")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(theme.secondary)
                .frame(width: 15, height: 15)
            Group {
                if let url = pr.url {
                    Link(pr.text, destination: url)
                        .foregroundStyle(theme.accent)
                        .help(url.absoluteString)
                } else {
                    Text(pr.text)
                        .foregroundStyle(theme.text)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let ci = pr.ci {
                Text(ci)
                    .foregroundStyle(theme.ci(pr.ciRole))
            }
        }
        .font(theme.font(.body, size: 13))
        .lineLimit(1)
        .padding(.top, 12)
        .overlay(alignment: .top) {
            theme.cardDivider.frame(height: 1)
        }
    }
}

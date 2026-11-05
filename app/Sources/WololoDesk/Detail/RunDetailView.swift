import SwiftUI
import WololoKit

/// A run's detail, in place of the board: the header, the Ahora, Etapas and Ítems cards, and the tabs.
/// "← Volver al tablero" or Escape goes back; so does choosing a project in the sidebar.
struct RunDetailView: View {
    static let bottomPadding: CGFloat = 32

    @Bindable var state: AppState
    let runID: String

    /// Where the tabbed card starts in the scrolled content, to size its panes to the rest of the window.
    @State private var tabsTop: CGFloat = 0

    var body: some View {
        let model = state.model
        Group {
            if let run = model.runs.first(where: { $0.id == runID }) {
                detail(run, model: model)
            } else {
                MissingRunView(id: runID, directory: model.dataDirectory, back: back)
            }
        }
        .background { escapeKey }
    }

    private func back() {
        state.selectedRunID = nil
    }

    /// Escape goes back to the board: a key equivalent works wherever the focus is in the window, except in the
    /// search field, which keeps Escape for itself.
    private var escapeKey: some View {
        Button("Volver al tablero", action: back)
            .keyboardShortcut(.cancelAction)
            .disabled(state.isSearchFocused)
            .opacity(0)
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
    }

    private func detail(_ run: Run, model: RunsModel) -> some View {
        let runDir = model.dataDirectory.runURL(id: run.id)
        return GeometryReader { viewport in
            ScrollView(.vertical) {
                content(run, model: model, runDir: runDir, viewportHeight: viewport.size.height)
            }
            .scrollIndicators(.automatic)
        }
    }

    /// The timeline and the documents scroll inside their pane, which reaches the bottom of the window when there is
    /// room, so the newest event shows without scrolling the page.
    private func content(_ run: Run, model: RunsModel, runDir: URL, viewportHeight: CGFloat) -> some View {
        let paneHeight = max(DetailTabs.minPaneHeight, viewportHeight - tabsTop - DetailTabs.barHeight - Self.bottomPadding)
        return VStack(alignment: .leading, spacing: 20) {
            DetailHeader(run: run, now: model.now, runDir: runDir, back: back) {
                TerminalAction.go(to: run, now: state.model.now, state: state)
            }
            CardRow(spacing: 16) {
                NowView(run: run, now: model.now)
                    .cardBasis(320)
                StagesView(run: run, now: model.now)
                    .cardBasis(300)
                ItemsView(run: run, now: model.now)
                    .cardBasis(300)
            }
            DetailTabs(tab: $state.detailTab, run: run, runDir: runDir, eventsRevision: model.eventsRevision, paneHeight: paneHeight)
                .onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.frame(in: .named(Self.space)).minY
                } action: { top in
                    tabsTop = top
                }
        }
        .padding(.horizontal, 24)
        .padding(.top, MainView.titleBarHeight + 2)
        .padding(.bottom, Self.bottomPadding)
        .coordinateSpace(name: Self.space)
    }

    private static let space = "RunDetailContent"
}

/// The selected run is no longer in the store: deleted, or the data directory changed under it.
private struct MissingRunView: View {
    let id: String
    let directory: DataDirectory
    let back: () -> Void

    var body: some View {
        let runs = (directory.runsURL.path as NSString).abbreviatingWithTildeInPath
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Este run ya no está en")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)
                Text(runs)
                    .font(.system(size: 13).monospaced())
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.ground, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.border, lineWidth: 1))
                    .help(directory.runsURL.path)
                Text("Se borró o se movió la carpeta de \(Text(id).font(.system(size: 13.5).monospaced())). El tablero muestra los runs que quedan.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            Button(action: back) {
                Label("Volver", systemImage: "arrow.left")
            }
            .buttonStyle(DetailButtonStyle())
        }
        .padding(32)
        .frame(maxWidth: 560, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The tabbed card under the sections: Línea de tiempo, Documentos, Capturas, Costo y tiempo.
private struct DetailTabs: View {
    @Binding var tab: LaunchOptions.DetailTab
    let run: Run
    let runDir: URL
    let eventsRevision: Int
    /// The height of the timeline and documents panes.
    let paneHeight: CGFloat

    /// The tab buttons and the divider under them.
    static let barHeight: CGFloat = 49
    static let minPaneHeight: CGFloat = 320

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                ForEach(LaunchOptions.DetailTab.allCases, id: \.self) { item in
                    tabButton(item)
                }
            }
            .padding(.horizontal, 10)
            .frame(height: Self.barHeight - 1)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Detalle del run")

            Theme.cardDivider.frame(height: 1)

            switch tab {
            case .timeline:
                TimelineTab(runDir: runDir, lang: run.lang, eventsRevision: eventsRevision, updatedAt: run.updatedAt)
                    .frame(height: paneHeight)
            case .documents:
                DocumentsTab(runDir: runDir, updatedAt: run.updatedAt)
                    .frame(height: paneHeight)
            case .screenshots:
                ScreenshotsTab(screenshots: run.screenshots, runDir: runDir, updatedAt: run.updatedAt)
            case .cost:
                CostTab(table: costTable(run))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func tabButton(_ item: LaunchOptions.DetailTab) -> some View {
        let isOn = tab == item
        return Button {
            tab = item
        } label: {
            Text(Self.title(item))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(isOn ? Color.white : Theme.muted)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(isOn ? Theme.track : .clear, in: RoundedRectangle(cornerRadius: 6))
                .contentShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }

    static func title(_ tab: LaunchOptions.DetailTab) -> String {
        switch tab {
        case .timeline: return "Línea de tiempo"
        case .documents: return "Documentos"
        case .screenshots: return "Capturas"
        case .cost: return "Costo y tiempo"
        }
    }
}

// MARK: Shared pieces

/// A file's modification date and size, read fresh (no cached resource values), to tell whether it needs reading
/// again. Nil while the file does not exist.
struct FileStamp: Equatable, Sendable {
    let modified: Date
    let size: Int

    init?(_ url: URL) {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let modified = attributes[.modificationDate] as? Date else { return nil }
        self.modified = modified
        size = (attributes[.size] as? NSNumber)?.intValue ?? 0
    }
}

/// A section of the detail: the surface card with its 18 pt padding, filling the height its row gives it.
struct DetailCard<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }
}

/// "AHORA", "ETAPAS": small, uppercase, spaced out and faint.
struct CardTitle: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(0.96)
            .foregroundStyle(Theme.faint)
            .lineLimit(1)
            .accessibilityLabel(text)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The detail's buttons: outlined, or light on dark for the main action, 36 pt tall.
struct DetailButtonStyle: ButtonStyle {
    var isPrimary = false

    func makeBody(configuration: Configuration) -> some View {
        StyledButton(configuration: configuration, isPrimary: isPrimary)
    }

    private struct StyledButton: View {
        let configuration: ButtonStyleConfiguration
        let isPrimary: Bool

        @State private var isHovered = false

        var body: some View {
            configuration.label
                .labelStyle(DetailButtonLabelStyle())
                .font(.system(size: 13, weight: isPrimary ? .semibold : .regular))
                .foregroundStyle(isPrimary ? Theme.ground : Theme.secondary)
                .padding(.horizontal, 14)
                .frame(minHeight: 36)
                .background(background, in: RoundedRectangle(cornerRadius: 8))
                .overlay {
                    if !isPrimary {
                        RoundedRectangle(cornerRadius: 8).strokeBorder(isHovered ? Theme.hoverBorder : Theme.border, lineWidth: 1)
                    }
                }
                .opacity(configuration.isPressed ? 0.8 : 1)
                .contentShape(RoundedRectangle(cornerRadius: 8))
                .onHover { isHovered = $0 }
        }

        private var background: Color {
            if isPrimary { return isHovered ? .white : Theme.text }
            return isHovered ? Theme.hover : .clear
        }
    }
}

private struct DetailButtonLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) {
            configuration.icon
                .font(.system(size: 13, weight: .medium))
                .frame(width: 15, height: 15)
            configuration.title
        }
    }
}

private struct CardBasis: LayoutValueKey {
    static let defaultValue: CGFloat = 300
}

extension View {
    /// The width a card in a `CardRow` starts from before the line's room is shared out.
    func cardBasis(_ width: CGFloat) -> some View {
        layoutValue(key: CardBasis.self, value: width)
    }
}

/// Cards side by side as the mockup's `flex: 1 1 <basis>` with wrapping: as many on a line as their bases allow,
/// sharing what is left of its width, all as tall as the tallest on the line.
struct CardRow: Layout {
    var spacing: CGFloat = 16

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let bases = subviews.map { $0[CardBasis.self] }
        let width = proposal.width ?? (bases.reduce(0, +) + spacing * CGFloat(max(bases.count - 1, 0)))
        let heights = lines(width: width, subviews: subviews).map { line in
            lineHeight(line, widths: widths(line, width: width, subviews: subviews), subviews: subviews)
        }
        return CGSize(width: width, height: heights.reduce(0, +) + spacing * CGFloat(max(heights.count - 1, 0)))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for line in lines(width: bounds.width, subviews: subviews) {
            let widths = widths(line, width: bounds.width, subviews: subviews)
            let height = lineHeight(line, widths: widths, subviews: subviews)
            var x = bounds.minX
            for (index, width) in zip(line, widths) {
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: width, height: height))
                x += width + spacing
            }
            y += height + spacing
        }
    }

    private func lines(width: CGFloat, subviews: Subviews) -> [[Int]] {
        var lines: [[Int]] = []
        var current: [Int] = []
        var used: CGFloat = 0
        for index in subviews.indices {
            let basis = subviews[index][CardBasis.self]
            let needed = current.isEmpty ? basis : used + spacing + basis
            if !current.isEmpty && needed > width {
                lines.append(current)
                current = [index]
                used = basis
            } else {
                current.append(index)
                used = needed
            }
        }
        if !current.isEmpty { lines.append(current) }
        return lines
    }

    /// Room left over is shared evenly, as `flex-grow: 1`; a lone card wider than the line shrinks to it.
    private func widths(_ line: [Int], width: CGFloat, subviews: Subviews) -> [CGFloat] {
        let bases = line.map { subviews[$0][CardBasis.self] }
        let total = bases.reduce(0, +)
        let free = width - total - spacing * CGFloat(max(line.count - 1, 0))
        return bases.map { basis in
            let grown = free >= 0 ? basis + free / CGFloat(line.count) : basis + free * basis / max(total, 1)
            return max(0, grown.rounded(.down))
        }
    }

    private func lineHeight(_ line: [Int], widths: [CGFloat], subviews: Subviews) -> CGFloat {
        zip(line, widths)
            .map { index, width in subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil)).height }
            .max() ?? 0
    }
}

/// Views left to right, wrapping onto a new line when the next one does not fit, as the header's facts.
struct FlowLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let frames = arrange(width: bounds.width, subviews: subviews).frames
        for (subview, frame) in zip(subviews, frames) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), proposal: ProposedViewSize(frame.size))
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], size: CGSize) {
        var frames: [CGRect] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            var size = subview.sizeThatFits(.unspecified)
            size.width = min(size.width, width)
            if x > 0 && x + size.width > width {
                x = 0
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            x += size.width + spacing
            widest = max(widest, x - spacing)
            lineHeight = max(lineHeight, size.height)
        }
        return (frames, CGSize(width: widest, height: frames.isEmpty ? 0 : y + lineHeight))
    }
}

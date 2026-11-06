import SwiftUI
import WololoKit

/// The run's documents that exist, listed on the left; the chosen one rendered as Markdown on the right.
struct DocumentsTab: View {
    let runDir: URL
    /// A new snapshot may come with a new or rewritten document.
    let updatedAt: TimeInterval

    @State private var documents: [RunDocument] = []
    @State private var isListed = false
    @State private var selected: String?
    @State private var blocks: [MarkdownBlock] = []
    @State private var failed = false
    /// The document `blocks` came from, as it was on disk then.
    @State private var loaded: (name: String, stamp: FileStamp?)?
    @Environment(\.theme) private var theme

    private struct LoadKey: Hashable {
        let name: String?
        let updatedAt: TimeInterval
    }

    var body: some View {
        Group {
            if !isListed {
                Color.clear
            } else if documents.isEmpty {
                Text("Este run todavía no escribió documentos.")
                    .font(theme.font(.body, size: 13))
                    .foregroundStyle(theme.faint)
                    .padding(18)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                HStack(alignment: .top, spacing: 0) {
                    list
                        .frame(width: 200)
                    theme.cardDivider.frame(width: 1)
                    article
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .task(id: updatedAt) { await list() }
        .task(id: LoadKey(name: selected, updatedAt: updatedAt)) { await load() }
    }

    private var list: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(documents) { document in
                    let isOn = document.name == selected
                    Button {
                        selected = document.name
                    } label: {
                        Text(document.name)
                            .font(theme.font(.mono, size: 12.5))
                            .foregroundStyle(isOn ? theme.text : theme.secondary)
                            .lineLimit(1)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(isOn ? theme.divider : .clear, in: RoundedRectangle(cornerRadius: theme.r(6)))
                            .contentShape(RoundedRectangle(cornerRadius: theme.r(6)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isOn ? [.isSelected] : [])
                }
            }
            .padding(10)
        }
    }

    private var article: some View {
        ScrollView(.vertical) {
            Group {
                if failed {
                    Text("No se pudo leer \(selected ?? "el documento").")
                        .font(theme.font(.body, size: 13))
                        .foregroundStyle(theme.faint)
                } else {
                    MarkdownView(blocks: blocks)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Lists the documents again off the main thread, keeping the chosen one if it is still there; spec.md first
    /// otherwise.
    private func list() async {
        let runDir = runDir
        let found = await Task.detached(priority: .userInitiated) { runDocuments(runDir: runDir) }.value
        guard !Task.isCancelled else { return }
        documents = found
        isListed = true
        let names = found.map(\.name)
        if selected == nil || !names.contains(selected ?? "") {
            selected = names.contains("spec.md") ? "spec.md" : names.first
        }
    }

    private struct Parsed: Sendable {
        let stamp: FileStamp?
        /// Nil when the file could not be read.
        let blocks: [MarkdownBlock]?
    }

    /// Reads and parses the chosen document off the main thread, unless it is the one already shown and its date
    /// and size did not change.
    private func load() async {
        guard let name = selected else {
            blocks = []
            failed = false
            loaded = nil
            return
        }
        let url = runDir.appendingPathComponent(name)
        let previous = loaded?.name == name ? loaded?.stamp : nil
        let isShown = loaded?.name == name
        let parsed = await Task.detached(priority: .userInitiated) { () -> Parsed? in
            let stamp = FileStamp(url)
            if isShown, stamp != nil, stamp == previous { return nil }
            let text = try? String(contentsOf: url, encoding: .utf8)
            return Parsed(stamp: stamp, blocks: text.map(markdownBlocks))
        }.value
        guard let parsed, !Task.isCancelled else { return }
        loaded = (name, parsed.stamp)
        blocks = parsed.blocks ?? []
        failed = parsed.blocks == nil
    }
}

/// Markdown blocks as text: headings, paragraphs, flat lists, code and rules, with inline styling and links.
struct MarkdownView: View {
    let blocks: [MarkdownBlock]

    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                view(block)
                    .padding(.top, index > 0 && isHeading(block) ? 6 : 0)
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func view(_ block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            Text(inline(text))
                .font(theme.font(.body, size: level == 1 ? 18 : (level == 2 ? 15 : 14), weight: level == 1 ? .bold : .semibold))
                .foregroundStyle(level == 3 ? theme.heading : theme.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
        case .paragraph(let text):
            body(text)
        case .listItem(let number, let text):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(number.map { "\($0)." } ?? "•")
                    .font(theme.font(.body, size: 13.5).monospacedDigit())
                    .foregroundStyle(theme.muted)
                    .frame(minWidth: 14, alignment: .trailing)
                body(text)
            }
            .padding(.leading, 6)
        case .code(_, let text):
            ScrollView(.horizontal) {
                Text(text)
                    .font(theme.font(.mono, size: 12))
                    .foregroundStyle(theme.secondary)
                    .fixedSize()
                    .padding(12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.ground, in: RoundedRectangle(cornerRadius: theme.r(6)))
            .overlay(RoundedRectangle(cornerRadius: theme.r(6)).strokeBorder(theme.cardDivider, lineWidth: 1))
        case .rule:
            theme.cardDivider.frame(height: 1)
        }
    }

    private func body(_ text: String) -> some View {
        Text(inline(text))
            .font(theme.font(.body, size: 13.5))
            .lineSpacing(3)
            .foregroundStyle(theme.secondary)
            .tint(theme.accent)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func isHeading(_ block: MarkdownBlock) -> Bool {
        if case .heading = block { return true }
        return false
    }

    private func inline(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}

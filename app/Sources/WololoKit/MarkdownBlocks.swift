import Foundation

/// A block of a run's Markdown document. The text inside is left as inline Markdown for `AttributedString(markdown:)`.
/// Tables and nested lists come out flat: a table row per paragraph, every list item at one level.
public enum MarkdownBlock: Equatable, Sendable {
    /// Levels 4 to 6 are drawn as 3.
    case heading(level: Int, text: String)
    case paragraph(String)
    /// `number` is nil for a bullet.
    case listItem(number: Int?, text: String)
    case code(language: String?, text: String)
    case rule
}

public func markdownBlocks(_ markdown: String) -> [MarkdownBlock] {
    var parser = MarkdownParser(lines: markdown.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n"))
    return parser.parse()
}

private struct MarkdownParser {
    let lines: [String]
    var blocks: [MarkdownBlock] = []
    /// Lines of the paragraph or list item being read, closed by a blank line or another block.
    var open: (number: Int?, isItem: Bool, lines: [String])?

    init(lines: [String]) {
        self.lines = lines
    }

    mutating func parse() -> [MarkdownBlock] {
        var index = 0
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            index += 1

            if let fence = fenceMarker(trimmed) {
                close()
                let language = trimmed.dropFirst(fence.count).trimmingCharacters(in: .whitespaces)
                    .split(separator: " ").first.map(String.init)
                var body: [String] = []
                while index < lines.count {
                    let inner = lines[index]
                    index += 1
                    let innerTrimmed = inner.trimmingCharacters(in: .whitespaces)
                    if innerTrimmed.hasPrefix(fence), innerTrimmed.allSatisfy({ $0 == fence.first }) { break }
                    body.append(inner)
                }
                blocks.append(.code(language: language, text: body.joined(separator: "\n")))
                continue
            }
            if trimmed.isEmpty {
                close()
                continue
            }
            if let heading = heading(trimmed) {
                close()
                blocks.append(heading)
                continue
            }
            if isRule(trimmed) {
                close()
                blocks.append(.rule)
                continue
            }
            if let item = listItem(trimmed) {
                close()
                open = (item.number, true, [item.text])
                continue
            }
            if trimmed.hasPrefix("|") {
                close()
                if !isTableDivider(trimmed) { blocks.append(.paragraph(tableRow(trimmed))) }
                continue
            }
            let text = trimmed.hasPrefix(">") ? trimmed.dropFirst().trimmingCharacters(in: .whitespaces) : trimmed
            if open == nil { open = (nil, false, []) }
            open?.lines.append(text)
        }
        close()
        return blocks
    }

    private mutating func close() {
        guard let block = open else { return }
        open = nil
        let text = block.lines.joined(separator: " ")
        blocks.append(block.isItem ? .listItem(number: block.number, text: text) : .paragraph(text))
    }

    private func fenceMarker(_ line: String) -> String? {
        for mark in ["```", "~~~"] where line.hasPrefix(mark) {
            return String(line.prefix { $0 == mark.first })
        }
        return nil
    }

    private func heading(_ line: String) -> MarkdownBlock? {
        let hashes = line.prefix { $0 == "#" }.count
        guard (1...6).contains(hashes) else { return nil }
        let rest = line.dropFirst(hashes)
        guard rest.isEmpty || rest.first == " " else { return nil }
        var text = rest.trimmingCharacters(in: .whitespaces)
        // A closing run of #s is decoration.
        if let closing = text.range(of: #"\s+#+$"#, options: .regularExpression) { text.removeSubrange(closing) }
        if text.allSatisfy({ $0 == "#" }) { text = "" }
        return .heading(level: min(hashes, 3), text: text)
    }

    private func isRule(_ line: String) -> Bool {
        let marks = line.filter { $0 != " " }
        guard marks.count >= 3, let first = marks.first, "-*_".contains(first) else { return false }
        return marks.allSatisfy { $0 == first }
    }

    private func listItem(_ line: String) -> (number: Int?, text: String)? {
        if let first = line.first, "-*+".contains(first), line.dropFirst().first == " " {
            return (nil, line.dropFirst(2).trimmingCharacters(in: .whitespaces))
        }
        let digits = line.prefix { $0.isASCII && $0.isNumber }
        guard !digits.isEmpty, digits.count <= 9 else { return nil }
        let rest = line.dropFirst(digits.count)
        guard let mark = rest.first, mark == "." || mark == ")", rest.dropFirst().first == " " else { return nil }
        return (Int(digits), rest.dropFirst(2).trimmingCharacters(in: .whitespaces))
    }

    private func isTableDivider(_ line: String) -> Bool {
        line.allSatisfy { "|-: ".contains($0) }
    }

    private func tableRow(_ line: String) -> String {
        line.split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}

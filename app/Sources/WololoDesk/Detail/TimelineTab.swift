import Foundation
import Observation
import SwiftUI
import WololoKit

/// The run's events in words, oldest first and kept scrolled to the newest. Minor events (usage, time, agents,
/// tasks, steps, permissions) only with the switch on. The events are followed while the tab is visible.
struct TimelineTab: View {
    let runDir: URL
    let lang: Lang
    /// `RunsModel.eventsRevision`: bumped when an events file changes.
    let eventsRevision: Int
    /// The snapshot is rewritten with every event too, so a change here also means reading on.
    let updatedAt: TimeInterval

    @State private var feed: EventFeed?
    @State private var includeMinor = false
    @Environment(\.theme) private var theme

    var body: some View {
        let entries = feed.map { includeMinor ? $0.allEntries : $0.majorEntries } ?? []
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer(minLength: 0)
                Toggle("Mostrar eventos menores", isOn: $includeMinor)
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .font(theme.font(.body, size: 12))
                    .foregroundStyle(theme.muted)
            }
            .frame(minHeight: 32)
            .padding(.horizontal, 18)
            .padding(.top, 8)

            if feed?.isLoaded == true && entries.isEmpty {
                Text("Todavía no hay eventos.")
                    .font(theme.font(.body, size: 13))
                    .foregroundStyle(theme.faint)
                    .padding(18)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                list(entries)
            }
        }
        .onAppear(perform: poll)
        .onChange(of: eventsRevision) { poll() }
        .onChange(of: updatedAt) { poll() }
    }

    private func list(_ entries: [TimelineEntry]) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(entries) { entry in
                        TimelineRow(entry: entry)
                            .id(entry.id)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 14)
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: entries.last?.id) {
                if let last = entries.last?.id { proxy.scrollTo(last, anchor: .bottom) }
            }
        }
    }

    private func poll() {
        let feed = self.feed ?? EventFeed(runDir: runDir, lang: lang)
        if self.feed == nil { self.feed = feed }
        feed.poll()
    }
}

private struct TimelineRow: View {
    let entry: TimelineEntry

    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(TimelineRow.clock.string(from: Date(timeIntervalSince1970: entry.ts)))
                .font(theme.font(.mono, size: 12))
                .foregroundStyle(theme.faint)
                .frame(width: 44, alignment: .leading)
                .help(Date(timeIntervalSince1970: entry.ts).formatted(date: .abbreviated, time: .standard))
            Text(entry.text)
                .font(theme.font(.body, size: 13))
                .foregroundStyle(color)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) {
            theme.rowDivider.frame(height: 1)
        }
        .accessibilityElement(children: .combine)
    }

    static let clock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    /// As in the mockup: what you approved in the color of done, what asks for you in that of waiting, problems in
    /// that of blocked, bookkeeping muted.
    private var color: Color {
        if entry.isMinor { return theme.muted }
        switch entry.type {
        case "gate.resolved", "question.answered", "unblocked", "resumed": return theme.dot(.done)
        case "gate.requested", "question.asked", "decision", "stalled": return theme.style(.waitingUser).activity
        case "blocked", "run.failed": return theme.style(.blocked).activity
        case "run.started", "run.finished", "pr.opened": return theme.text
        default: return theme.secondary
        }
    }
}

/// An `EventTail` read and worded on a serial queue, so a large rotated log never blocks the window. Both lists the
/// switch picks from land on the main actor once ready; the body only chooses one.
@MainActor
@Observable
final class EventFeed {
    /// Without the minor events.
    private(set) var majorEntries: [TimelineEntry] = []
    private(set) var allEntries: [TimelineEntry] = []
    private(set) var isLoaded = false

    @ObservationIgnored private let tail: QueueBound
    @ObservationIgnored private let lang: Lang
    @ObservationIgnored private let queue = DispatchQueue(label: "com.saugon.wololo-desk.timeline")

    init(runDir: URL, lang: Lang) {
        tail = QueueBound(EventTail(runDir: runDir))
        self.lang = lang
    }

    func poll() {
        let tail = tail
        let lang = lang
        queue.async { [weak self] in
            let changed = tail.value.poll() != .unchanged
            let events = tail.value.events
            let major = changed ? timeline(events, lang: lang, includeMinor: false) : nil
            let all = changed ? timeline(events, lang: lang, includeMinor: true) : nil
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self else { return }
                    if let major, let all {
                        self.majorEntries = major
                        self.allEntries = all
                    }
                    self.isLoaded = true
                }
            }
        }
    }
}

/// The tail crosses into the feed's queue in this box: it is only ever used there, one poll at a time.
private final class QueueBound: @unchecked Sendable {
    let value: EventTail

    init(_ value: EventTail) {
        self.value = value
    }
}

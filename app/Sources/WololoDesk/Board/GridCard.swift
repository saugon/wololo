import SwiftUI
import WololoKit

/// A run in the grid: on the left the status, how long ago it changed and the terminal button, the title, what the run
/// is doing and, at the bottom, its origin and agents; on the right every stage, the ones done, the current one lit
/// and the ones to come faint.
struct GridCard: View {
    /// The full card's width, with its stage column; `compactMinWidth` the one without it.
    static let minWidth: CGFloat = 480
    static let compactMinWidth: CGFloat = 300
    static let height: CGFloat = 262

    let run: Run
    let now: TimeInterval
    /// The stage column narrow, three letters a stage: for a row of more cards than fit whole.
    var isCompact = false
    let isSelected: Bool
    let select: () -> Void
    let goToTerminal: () -> Void
    /// Gives the run a title of the person's; nil goes back to its own.
    var rename: (String?) -> Void = { _ in }

    @State private var isHovered = false
    @State private var isEditingTitle = false
    @Environment(\.theme) private var theme

    var body: some View {
        let status = effectiveStatus(run, now: now)
        let style = theme.style(status, of: run)
        HStack(spacing: 0) {
            summary(status, color: style.color, activityColor: style.activity)
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            theme.cardDivider.frame(width: 1)
            stages(color: style.color)
                .padding(.horizontal, isCompact ? 10 : 14)
                .padding(.vertical, 14)
                .frame(width: isCompact ? 74 : 168, alignment: .topLeading)
                .frame(maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity)
        .frame(height: Self.height)
        .themeFrame(theme, fill: isHovered ? theme.surfaceHover : theme.surface) { card in
            card
                .background(isHovered ? theme.surfaceHover : theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: theme.r(12)))
                .overlay(
                    RoundedRectangle(cornerRadius: theme.r(12))
                        .strokeBorder(border, lineWidth: isSelected ? 1.5 : 1)
                )
        }
        .overlay {
            if theme.frameImage != nil && isSelected {
                Rectangle().strokeBorder(theme.focus, lineWidth: 2)
            }
        }
        .onHover { isHovered = $0 }
        .selectable(
            label: run.displayTitle,
            value: accessibilityValue(status),
            isSelected: isSelected,
            cornerRadius: theme.r(12),
            isActive: !isEditingTitle,
            action: select
        )
        .accessibilityAction(named: "Ir a la terminal", goToTerminal)
        // The card reads as one button to VoiceOver, so the PR is one of its actions.
        .accessibilityAction(named: "Abrir el PR") {
            if let url = prURL(run) { NSWorkspace.shared.open(url) }
        }
    }

    private var border: Color {
        if isSelected { return theme.focus }
        return isHovered ? theme.borderHover : theme.border
    }

    private func summary(_ status: RunStatus, color: Color, activityColor: Color) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                HStack(spacing: 6) {
                    Circle().fill(color).frame(width: 6, height: 6)
                    Text(status.label(run.lang))
                        .font(theme.font(.body, size: 12.5, weight: .semibold))
                        .foregroundStyle(color)
                        .lineLimit(1)
                }
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(color.opacity(0.14), in: Capsule())
                Text(ago(run.updatedAt, now: now, lang: run.lang))
                    .font(theme.font(.body, size: 12.5))
                    .foregroundStyle(theme.muted)
                    .lineLimit(1)
                Spacer(minLength: 0)
                terminalButton
            }
            EditableTitle(run: run, isEditing: $isEditingTitle, font: theme.font(.display, size: 18, weight: .bold), rename: rename) {
                Text(run.displayTitle)
                    .font(theme.font(.display, size: 18, weight: .bold))
                    .tracking(theme.tracking(.display, size: 18))
                    .foregroundStyle(theme.title)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let activity = activityLine(run, now: now, prefixed: false)
            if !activity.isEmpty {
                Text(activity)
                    .font(theme.font(.body, size: 13.5))
                    .foregroundStyle(activityColor)
                    .lineSpacing(2)
                    .lineLimit(4)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            theme.cardDivider.frame(height: 1)
            // What does not fit goes, the agents first, then the project beside the PR: a footer wider than the card
            // would push it over the next one.
            ViewThatFits(in: .horizontal) {
                footer(showsProject: true, showsAgents: true)
                footer(showsProject: true, showsAgents: false)
                footer(showsProject: false, showsAgents: false)
            }
            .foregroundStyle(theme.muted)
        }
    }

    private func footer(showsProject: Bool, showsAgents: Bool) -> some View {
        HStack(spacing: 8) {
            if let pr = prLabel(run), let url = prURL(run) {
                if showsProject {
                    Text(run.project.display)
                        .font(theme.font(.mono, size: 12))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(minWidth: 60, alignment: .leading)
                        .help(run.project.branch ?? run.project.display)
                }
                PRLink(text: pr, url: url, size: 12)
            } else {
                Text(gridOrigin(run))
                    .font(theme.font(.mono, size: 12))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(run.project.branch ?? run.project.display)
            }
            if let badge = prReviewBadge(run) { ReviewBadgeView(badge: badge, size: 11.5) }
            Spacer(minLength: 0)
            if showsAgents, let agents = agentsLabel(run, now: now) {
                Text(agents)
                    .font(theme.font(.body, size: 12.5))
                    .lineLimit(1)
                    .fixedSize()
            }
        }
    }

    /// "ETAPA 5/8" over the eight stages: a dot in the status color for each one done, the current one ringed and in
    /// bold, and the ones to come in the faint color.
    private func stages(color: Color) -> some View {
        let progress = RunProgress(run, now: now)
        let current = progress.stageNumber - 1
        let isDone = effectiveStatus(run, now: now) == .done
        return VStack(alignment: .leading, spacing: 9) {
            Text(isCompact ? progress.shortText : "\(run.lang == .es ? "ETAPA" : "STAGE") \(progress.shortText)")
                .font(theme.font(.body, size: 11, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(theme.muted)
                .padding(.bottom, 2)
            ForEach(Array(Stage.all.enumerated()), id: \.element.id) { index, stage in
                let isPast = index < current || isDone
                let isCurrent = index == current && !isDone
                HStack(spacing: isCompact ? 6 : 9) {
                    ZStack {
                        if isCurrent {
                            Circle().fill(color.opacity(0.3)).frame(width: 13, height: 13)
                        }
                        Circle()
                            .fill(isCurrent ? color : isPast ? color.opacity(0.55) : theme.faint.opacity(0.5))
                            .frame(width: 7, height: 7)
                    }
                    .frame(width: 13, height: 13)
                    Text(isCompact ? stage.shortLabel(run.lang) : stage.label(run.lang))
                        .font(theme.font(.body, size: 12.5, weight: isCurrent ? .bold : .regular))
                        .foregroundStyle(isCurrent ? theme.title : isPast ? theme.secondary : theme.faint)
                        .lineLimit(1)
                }
            }
        }
        .accessibilityHidden(true)
    }

    private var terminalButton: some View {
        Button(action: goToTerminal) {
            Image(systemName: "terminal")
                .font(.system(size: 13, weight: .medium))
                .frame(width: 26, height: 26)
                .contentShape(RoundedRectangle(cornerRadius: theme.r(6)))
        }
        .buttonStyle(WidgetIconButtonStyle(color: theme.muted))
        .help(TerminalPlan(run, now: now).triesFocus
            ? "Traer al frente la terminal de la sesión"
            : "Abrir una terminal en la carpeta del run")
        .padding(.vertical, -4)
    }

    private func accessibilityValue(_ status: RunStatus) -> String {
        let parts: [String?] = [
            status.label(run.lang),
            RunProgress(run, now: now).accessibilityLabel,
            agentsLabel(run, now: now),
            prChip(run)?.title,
            activityLine(run, now: now),
            ago(run.updatedAt, now: now, lang: run.lang),
        ]
        return parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

/// Where the PR's review stands, as a small capsule beside it: "conflictos" or "CI falla" in the failing colour,
/// "2 sin responder" in the waiting one, "listo" in the finished one, "en cola · 2" in the accent, the rest muted.
struct ReviewBadgeView: View {
    let badge: ReviewBadge
    let size: CGFloat

    @Environment(\.theme) private var theme

    var body: some View {
        let color = self.color
        Text(badge.text)
            .font(theme.font(.body, size: size, weight: .semibold))
            .foregroundStyle(color)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(color.opacity(0.14), in: Capsule())
            .help(badge.title)
            .accessibilityLabel(badge.title)
    }

    private var color: Color {
        switch badge.tone {
        case .problem: return theme.ci(.failing)
        case .attention: return theme.style(.waitingUser).color
        case .running: return theme.ci(.pending)
        case .ready: return theme.style(.done).color
        case .queued: return theme.accent
        case .idle: return theme.muted
        }
    }
}

/// "PR #4873" as a link to the PR, in the accent color, like the widget's.
struct PRLink: View {
    let text: String
    let url: URL
    let size: CGFloat

    @Environment(\.theme) private var theme

    var body: some View {
        Link(text, destination: url)
            .font(theme.font(.mono, size: size, weight: .semibold))
            .foregroundStyle(theme.accent)
            .lineLimit(1)
            .fixedSize()
            .help("Abrir el PR en el navegador: \(url.absoluteString)")
    }
}

/// The grid's origin: "acme/web #4312", or "acme/web PR #4873" once the run has a PR, which is what the person opens then.
private func gridOrigin(_ run: Run) -> String {
    guard let pr = prLabel(run) else { return originLabel(run) }
    return "\(run.project.display) \(pr)"
}

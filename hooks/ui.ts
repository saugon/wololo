import type { Row, Tone, ViewState } from '../types'
import {
  type Run,
  type RunEvent,
  type Status,
  STAGES,
  activity,
  duration,
  header,
  isTerminal,
  isWaitingOnPerson,
  liveAgents,
  liveTasks,
  pills,
  shortRef,
  stageLabel,
  statusLine,
  t,
} from './model'

export function toneOf(status: Status): Tone {
  if (status === 'done') return 'success'
  if (status === 'failed' || status === 'blocked') return 'error'
  if (isWaitingOnPerson(status) || status === 'orphaned') return 'warning'
  if (isTerminal(status)) return 'subtle'
  return 'claude'
}

function stageSeconds(run: Run, id: string, now: number): number {
  return run.stages.filter(s => s.id === id).reduce((sum, s) => sum + ((s.finished_at ?? now) - s.started_at), 0)
}

function describeEvent(ev: RunEvent): string {
  const d = ev.data
  const text = typeof d.text === 'string' ? d.text : ''
  switch (ev.type) {
    case 'stage.entered':
      return `→ ${String(d.stage)}`
    case 'gate.resolved':
      return `${String(d.gate)}: ${String(d.outcome ?? 'approved')}`
    case 'question.asked':
      return `❓ ${String(d.question ?? '')}`
    case 'question.answered':
      return '✓ respuesta'
    case 'agent.started':
      return `⟳ ${String(d.role ?? 'agent')} ${String(d.description ?? '')}`.trim()
    case 'agent.finished':
      return `✓ ${String(d.role ?? 'agent')} ${String(d.status ?? '')}`.trim()
    case 'task.started':
      return `⏳ ${String(d.label ?? '')}`
    case 'task.finished':
      return `✓ ${String(d.label ?? d.id ?? '')} ${String(d.status ?? '')}`.trim()
    case 'item.started':
      return `item ${String(d.n)}: ${String(d.title ?? '')}`
    case 'item.committed':
      return `✓ item ${String(d.n)} ${String(d.sha ?? '').slice(0, 9)}`.trim()
    case 'item.verified':
      return `item ${String(d.n)} gates ${String(d.result ?? '')}`
    case 'debate.turn':
      return `debate ${String(d.role ?? '')} r${String(d.round ?? '')} ${String(d.verdict ?? '')}`.trim()
    case 'blocked':
      return `⛔ ${String(d.reason ?? '')}`
    case 'pr.opened':
      return `PR ${String(d.url ?? '')}`
    case 'ci.updated':
      return `CI ${String(d.state ?? '')}`
    default:
      return `${ev.type}${text ? `: ${text}` : ''}`
  }
}

function clock(ts: number): string {
  const date = new Date(ts * 1000)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function buildView(run: Run, status: Status, recent: readonly RunEvent[], now: number): ViewState {
  const tone = toneOf(status)
  const lang = run.lang
  const first = [`wololo ${shortRef(run)} ${run.title}`.trim(), '─', stageLabel(run), '·', activity(run, status, now), '·', run.mode].join(
    ' ',
  )
  const band: Row[] = [
    { text: first, tone },
    { text: pills(run), tone: 'subtle' },
  ]

  const pane: Row[] = []
  pane.push({ text: `${shortRef(run)} ${run.title}`, tone: 'text' })
  const where = run.project.worktree ?? run.project.path
  pane.push({ text: `${run.mode} · ${lang === 'es' ? 'riesgo' : 'risk'} ${run.risk} · ${where}`, tone: 'subtle' })
  pane.push({ text: activity(run, status, now), tone })
  pane.push({ text: '', tone: 'subtle' })

  const done = new Set(run.stages.filter(s => s.finished_at !== null).map(s => s.id))
  STAGES.forEach((stage, index) => {
    const isCurrent = run.stage?.index === index && !run.outcome
    const mark = isCurrent ? '▶' : done.has(stage.id) ? '✓' : '·'
    const seconds = stageSeconds(run, stage.id, now)
    const gate = run.gates[stage.id]
    const extra = gate?.resolved_at ? ` ${gate.outcome ?? ''} (${gate.by ?? ''})` : ''
    const items = stage.id === 'implement' && run.items.total > 0 ? ` ${run.items.done}/${run.items.total}` : ''
    pane.push({
      text: `${mark} ${stage.label[lang]}${items}${seconds > 0 ? `  ${duration(seconds)}` : ''}${extra}`,
      tone: isCurrent ? tone : done.has(stage.id) ? 'text' : 'subtle',
    })
    if (!isCurrent) return
    if (run.items.current) pane.push({ text: `    item ${run.items.current.n}: ${run.items.current.title}`, tone: 'text' })
    for (const agent of liveAgents(run)) {
      pane.push({ text: `    ├ ${agent.role} ⟳ ${duration(now - agent.started_at)} ${agent.description}`.trimEnd(), tone: 'claude' })
    }
    for (const task of liveTasks(run)) {
      pane.push({ text: `    ├ ${task.label} ⏳ ${duration(now - task.started_at)}`, tone: 'claude' })
    }
  })

  pane.push({ text: '', tone: 'subtle' })
  const c = run.counts
  pane.push({
    text:
      lang === 'es'
        ? `Supuestos ${c.assumptions} · Decisiones ${c.decisions} · Debate ${c.debate_turns} · Reversiones ${c.reversals}`
        : `Assumptions ${c.assumptions} · Decisions ${c.decisions} · Debate ${c.debate_turns} · Reversals ${c.reversals}`,
    tone: 'subtle',
  })
  if (run.pr) pane.push({ text: `PR ${run.pr.url} · ${run.pr.state}${run.pr.ci ? ` · CI ${run.pr.ci}` : ''}`, tone: 'text' })
  if (run.waiting) pane.push({ text: `${t(lang, 'waitsYou')}: ${run.waiting.question}`, tone: 'warning' })
  for (const ev of recent.slice(-8).reverse()) pane.push({ text: `${clock(ev.ts)} ${describeEvent(ev)}`, tone: 'subtle' })

  return {
    runId: run.id,
    header: header(run, status, now),
    statusLine: statusLine(run, status, now),
    band,
    pane,
    title: `wololo · ${shortRef(run)}`,
  }
}

export function statusTable(runs: ReadonlyArray<{ run: Run; status: Status }>, now: number): string {
  if (runs.length === 0) return 'No wololo runs yet.'
  const rows = runs.map(({ run, status }) => [
    shortRef(run),
    run.project.key.split('__').slice(-1)[0] ?? run.project.key,
    run.stage ? stageLabel(run) : '-',
    activity(run, status, now),
    duration(now - run.updated_at),
    run.id,
  ])
  const head = ['RUN', 'PROJECT', 'STAGE', 'STATUS', 'AGO', 'ID']
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)))
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()
  return [line(head), ...rows.map(line)].join('\n')
}

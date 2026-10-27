import type { Band, Row, Tone, ViewState } from '../types'
import { type Entry, formatEntry, timeline } from './history'
import {
  type Run,
  type RunEvent,
  type Status,
  STAGES,
  activity,
  badge,
  statusDetail,
  duration,
  header,
  isTerminal,
  isWaitingOnPerson,
  liveAgents,
  liveTasks,
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

export function buildView(
  run: Run,
  status: Status,
  recent: readonly RunEvent[],
  now: number,
  runDir?: string,
  history?: readonly Entry[],
): ViewState {
  const tone = toneOf(status)
  const lang = run.lang
  const done = new Set(run.stages.filter(entry => entry.finished_at !== null).map(entry => entry.id))
  const band: Band = {
    title: `wololo · ${run.source.kind === 'github_issue' ? `${shortRef(run)} ${run.title}` : run.title}`,
    mode: run.mode,
    stage: stageLabel(run),
    activity: activity(run, status, now),
    badge: badge(lang, status),
    detail: statusDetail(run, status, now),
    tone,
    pills: STAGES.map((stage, index) => ({
      label: stage.label[lang],
      state: run.stage?.index === index && !run.outcome ? 'current' : done.has(stage.id) ? 'done' : 'pending',
    })),
  }

  const pane: Row[] = []
  pane.push({ text: `${shortRef(run)} ${run.title}`, tone: 'text' })
  const where = run.project.worktree ?? run.project.path
  pane.push({ text: `${run.mode} · ${lang === 'es' ? 'riesgo' : 'risk'} ${run.risk} · ${where}`, tone: 'subtle' })
  pane.push({ text: activity(run, status, now), tone })
  if (runDir) pane.push({ text: `${lang === 'es' ? 'Archivos del run' : 'Run files'}: ${runDir}`, tone: 'subtle' })
  pane.push({ text: '', tone: 'subtle' })

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
        ? `Supuestos ${c.assumptions} · Decisiones ${c.decisions} · Debate ${c.debate_turns} · Reversiones ${c.reversals}${c.unsigned ? ` · Sin firmar ${c.unsigned}` : ''}`
        : `Assumptions ${c.assumptions} · Decisions ${c.decisions} · Debate ${c.debate_turns} · Reversals ${c.reversals}${c.unsigned ? ` · Unsigned ${c.unsigned}` : ''}`,
    tone: 'subtle',
  })
  if (run.pr) pane.push({ text: `PR ${run.pr.url} · ${run.pr.state}${run.pr.ci ? ` · CI ${run.pr.ci}` : ''}`, tone: 'text' })
  if (run.waiting) pane.push({ text: `${t(lang, 'waitsYou')}: ${run.waiting.question}`, tone: 'warning' })
  const entries = history ?? timeline(recent, lang)
  const toRow = (entry: Entry): Row => ({
    text: formatEntry(entry),
    tone: entry.icon === '✕' ? 'error' : entry.icon === '?' || entry.icon === '!' ? 'warning' : entry.isMajor ? 'text' : 'subtle',
  })
  const majorRows = entries.filter(entry => entry.isMajor).map(toRow).reverse()
  const allRows = entries.map(toRow).reverse()
  const latest = entries.filter(entry => entry.isMajor)
  if (latest.length > 0) pane.push({ text: lang === 'es' ? 'Últimos eventos (/wololo-history para todos):' : 'Latest events (/wololo-history for all):', tone: 'subtle' })
  for (const entry of latest.slice(-8).reverse()) pane.push({ text: formatEntry(entry), tone: entry.icon === '✕' ? 'error' : entry.icon === '?' || entry.icon === '!' ? 'warning' : 'subtle' })

  const details = pane.slice(1).filter((row, index) => !(index === 1 && row.text === band.activity))

  return {
    runId: run.id,
    header: header(run, status, now),
    statusLine: statusLine(run, status, now),
    band,
    details,
    history: majorRows,
    historyAll: allRows,
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

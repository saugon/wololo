import type { Band, Row, Tone, ViewState } from '../types'
import { type Entry, formatEntry, timeline } from './history'
import {
  type Run,
  type RunEvent,
  type Status,
  STAGES,
  activity,
  roleName,
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

const MODE_LINES: Record<string, { icon: string; color: string; hint: Record<string, string> }> = {
  full: { icon: '▶▶', color: 'autoAccept', hint: { es: 'no pregunta: decide solo y anota cada supuesto', en: 'never asks: decides alone and records every assumption' } },
  checkpoints: { icon: '⏸', color: 'suggestion', hint: { es: 'frena para aprobar el spec y el PR', en: 'stops to approve the spec and the PR' } },
  guided: { icon: '☰', color: 'planMode', hint: { es: 'pregunta en cada duda relevante', en: 'asks at every relevant doubt' } },
}

export function modeLine(mode: string, lang: string): { icon: string; name: string; hint: string; color: string } {
  const line = MODE_LINES[mode] ?? MODE_LINES.checkpoints
  const es = lang === 'es'
  return {
    icon: line?.icon ?? '',
    name: `${es ? 'modo' : 'mode'} ${mode}`,
    hint: `${line?.hint[es ? 'es' : 'en'] ?? ''} (/wololo config)`,
    color: line?.color ?? 'suggestion',
  }
}

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
    modeLine: modeLine(run.mode, lang),
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

  const es = lang === 'es'
  const summary: Row[] = []
  const gap = () => summary.push({ text: '', tone: 'subtle' })

  summary.push({ text: es ? 'Ahora' : 'Now', tone: 'subtle' })
  const items = run.stage?.id === 'implement' && run.items.total > 0 ? ` · ${run.items.done}/${run.items.total} ${es ? 'ítems' : 'items'}` : ''
  summary.push({ text: `▶ ${stageLabel(run)}${items}`, tone })
  if (run.items.current && run.stage?.id === 'implement') {
    summary.push({ text: `  ${es ? 'Ítem' : 'Item'} ${run.items.current.n}: ${run.items.current.title}`, tone: 'text' })
  }
  if (run.doing) summary.push({ text: `  → ${run.doing.text}`, tone: 'text' })
  for (const agent of liveAgents(run)) {
    const what = agent.description ? `: ${agent.description}` : ''
    summary.push({ text: `  ⟳ ${roleName(lang, agent.role, 1)} (${duration(now - agent.started_at)})${what}`, tone: 'claude' })
  }
  for (const task of liveTasks(run)) summary.push({ text: `  ⟳ ${task.label} (${duration(now - task.started_at)})`, tone: 'claude' })
  if (run.waiting) summary.push({ text: `  ? ${t(lang, 'waitsYou')}: ${run.waiting.question}`, tone: 'warning' })
  if (run.blocked) summary.push({ text: `  ✕ ${run.blocked.reason}`, tone: 'error' })
  gap()

  summary.push({ text: es ? 'Etapas' : 'Stages', tone: 'subtle' })
  const outcomes: Record<string, string> = es ? { approved: 'aprobado', changes: 'con ajustes', rejected: 'rechazado' } : {}
  STAGES.forEach((stage, index) => {
    const isCurrent = run.stage?.index === index && !run.outcome
    const mark = isCurrent ? '▶' : done.has(stage.id) ? '✓' : '·'
    const seconds = stageSeconds(run, stage.id, now)
    const gate = run.gates[stage.id]
    let text = `${mark} ${stage.label[lang]}`
    if (stage.isGate && gate?.resolved_at) {
      const outcome = outcomes[gate.outcome ?? ''] ?? gate.outcome ?? ''
      const who = gate.by === 'auto' ? (es ? 'automático' : 'automatic') : es ? 'vos' : 'you'
      text += `: ${outcome} (${who})${seconds > 0 ? `, ${es ? 'esperó' : 'waited'} ${duration(seconds)}` : ''}`
    } else if (seconds > 0) {
      text += `  ${duration(seconds)}`
    }
    summary.push({ text, tone: isCurrent ? tone : done.has(stage.id) ? 'text' : 'subtle' })
  })
  gap()

  const c = run.counts
  const where = run.project.worktree ?? run.project.path
  summary.push({ text: `${run.mode} · ${es ? 'riesgo' : 'risk'} ${run.risk} · ${where}`, tone: 'subtle' })
  summary.push({
    text: es
      ? `Supuestos ${c.assumptions} · Decisiones ${c.decisions} · Debate ${c.debate_turns} · Reversiones ${c.reversals}${c.unsigned ? ` · Sin firmar ${c.unsigned}` : ''}`
      : `Assumptions ${c.assumptions} · Decisions ${c.decisions} · Debate ${c.debate_turns} · Reversals ${c.reversals}${c.unsigned ? ` · Unsigned ${c.unsigned}` : ''}`,
    tone: 'subtle',
  })
  if (run.pr) summary.push({ text: `PR ${run.pr.url} · ${run.pr.state}${run.pr.ci ? ` · CI ${run.pr.ci}` : ''}`, tone: 'text' })
  if (runDir) summary.push({ text: `${es ? 'Archivos del run' : 'Run files'}: ${runDir}`, tone: 'subtle' })

  const entries = history ?? timeline(recent, lang)
  const toRow = (entry: Entry): Row => ({
    text: formatEntry(entry),
    tone: entry.icon === '✕' ? 'error' : entry.icon === '?' || entry.icon === '!' ? 'warning' : entry.isMajor ? 'text' : 'subtle',
  })
  const majorRows = entries.filter(entry => entry.isMajor).map(toRow).reverse()
  const allRows = entries.map(toRow).reverse()
  if (majorRows.length > 0) {
    gap()
    summary.push({ text: es ? 'Últimos eventos (h: historial completo)' : 'Latest events (h: full history)', tone: 'subtle' })
    summary.push(...majorRows.slice(0, 5))
  }

  const itemRows: Row[] = (run.items.list ?? []).map(item => {
    const mark = { done: '✓', active: '▶', failing: '✕', pending: '·' }[item.state]
    const sha = item.sha ? `  ${item.sha.slice(0, 9)}` : ''
    const itemTone: Tone = item.state === 'done' ? 'text' : item.state === 'active' ? tone : item.state === 'failing' ? 'warning' : 'subtle'
    return { text: `${mark} ${item.n}. ${item.title}${sha}`, tone: itemTone }
  })

  const details = summary
  const pane = summary

  return {
    runId: run.id,
    header: header(run, status, now),
    statusLine: statusLine(run, status, now),
    band,
    details,
    history: majorRows,
    items: itemRows,
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

export type StatusCard = {
  id: string
  project: string
  title: string
  badge: string
  tone: Tone
  stage: string
  current: string
  doing: string
  workers: string[]
  waiting: string
  last: string
  ago: string
}

export function statusCards(runs: ReadonlyArray<{ run: Run; status: Status; last?: Entry }>, now: number): StatusCard[] {
  return runs.map(({ run, status, last }) => {
    const es = run.lang === 'es'
    const items = run.stage?.id === 'implement' && run.items.total > 0 ? ` · ${run.items.done}/${run.items.total} ${es ? 'ítems' : 'items'}` : ''
    const ago = (at: number) => (es ? `hace ${duration(now - at)}` : `${duration(now - at)} ago`)
    const current = run.items.current && run.stage?.id === 'implement' ? `${es ? 'Ítem' : 'Item'} ${run.items.current.n}: ${run.items.current.title}` : ''
    const workers = [
      ...liveAgents(run).map(agent => `⟳ ${roleName(run.lang, agent.role, 1)} (${duration(now - agent.started_at)})${agent.description ? `: ${agent.description}` : ''}`),
      ...liveTasks(run).map(task => `⟳ ${task.label} (${duration(now - task.started_at)})`),
    ]
    const waiting = isWaitingOnPerson(status) || status === 'orphaned' ? statusDetail(run, status, now) : ''
    return {
      id: run.id,
      project: run.project.key.split('__').slice(-1)[0] ?? run.project.key,
      title: run.source.kind === 'github_issue' ? `${shortRef(run)} ${run.title}` : run.title,
      badge: badge(run.lang, status),
      tone: toneOf(status),
      stage: `${run.stage ? stageLabel(run) : es ? 'arrancando' : 'starting'}${items}`,
      current,
      doing: run.doing?.text ?? '',
      workers,
      waiting,
      last: last ? `${es ? 'Último' : 'Last'}: ${last.icon} ${last.text} · ${ago(last.ts)}` : '',
      ago: ago(run.updated_at),
    }
  })
}

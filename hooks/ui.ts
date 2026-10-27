import type { Band, Progress, Row, Segment, Tone, ViewState } from '../types'
import { type Entry, formatEntry, timeline } from './history'
import {
  type AgentEntry,
  type Run,
  type RunEvent,
  type Status,
  STAGES,
  TIME_KINDS,
  type TimeKind,
  activity,
  agentChips,
  agentScope,
  finishedAgents,
  roleMark,
  roleName,
  shortModel,
  tokenTotal,
  tokensText,
  usdText,
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

const SHORT: Record<string, Record<'es' | 'en', string>> = {
  context: { es: 'Con', en: 'Ctx' },
  definition: { es: 'Def', en: 'Def' },
  gate_a: { es: 'Spc', en: 'Spc' },
  plan: { es: 'Pla', en: 'Pln' },
  implement: { es: 'Imp', en: 'Imp' },
  evidence: { es: 'Evi', en: 'Evd' },
  gate_b: { es: 'Rev', en: 'Rev' },
  pr: { es: 'PR', en: 'PR' },
}

const BAR_CELLS = 4

function bar(fraction: number): { filled: string; empty: string } {
  const halves = Math.round(Math.min(1, Math.max(0, fraction)) * BAR_CELLS * 2)
  const filled = '█'.repeat(Math.floor(halves / 2)) + (halves % 2 ? '▌' : '')
  return { filled, empty: '░'.repeat(BAR_CELLS - Math.ceil(halves / 2)) }
}

export function stageText(run: Run): string {
  const es = run.lang === 'es'
  if (!run.stage) return es ? 'arrancando' : 'starting'
  const label = STAGES[run.stage.index]?.label[run.lang] ?? run.stage.id
  if (run.stage.id !== 'implement' || run.items.total === 0) return label
  const current = run.items.current
  if (current) return `${label} · ${es ? 'ítem' : 'item'} ${current.n} ${es ? 'de' : 'of'} ${run.items.total}`
  return `${label} · ${run.items.done}/${run.items.total} ${es ? 'ítems' : 'items'}`
}

export function thinBar(segments: readonly Segment[], width: number): Array<{ text: string; state: Segment['state']; filled: boolean }> {
  const cells = Math.max(3, Math.floor(width / Math.max(1, segments.length)))
  return segments.flatMap(segment => {
    const filled = segment.state === 'done' ? cells : Math.round(segment.fraction * cells)
    return [
      { text: '━'.repeat(filled), state: segment.state, filled: true },
      { text: '─'.repeat(cells - filled), state: segment.state, filled: false },
    ].filter(part => part.text.length > 0)
  })
}

export function barLabels(segments: readonly Segment[], width: number): Array<{ text: string; state: Segment['state'] }> {
  const cells = Math.max(3, Math.floor(width / Math.max(1, segments.length)))
  return segments.map(segment => ({ text: segment.short.padEnd(cells), state: segment.state }))
}

export function progressOf(run: Run): Progress {
  const lang = run.lang
  const done = new Set(run.stages.filter(stage => stage.finished_at !== null).map(stage => stage.id))
  const currentIndex = run.outcome ? -1 : (run.stage?.index ?? -1)
  let total = 0
  const segments: Segment[] = STAGES.map((stage, index) => {
    const isDone = run.outcome === 'done' || (index !== currentIndex && done.has(stage.id)) || (currentIndex >= 0 && index < currentIndex)
    const isCurrent = index === currentIndex
    const within =
      stage.id === 'implement' && run.items.total > 0 ? Math.min(1, run.items.done / run.items.total) : 0.5
    const fraction = isDone ? 1 : isCurrent ? within : 0
    total += fraction
    return { short: SHORT[stage.id]?.[lang] ?? stage.id, state: isDone ? 'done' : isCurrent ? 'current' : 'pending', fraction, ...bar(fraction) }
  })
  return { segments, percent: run.outcome === 'done' ? 100 : Math.round((total / STAGES.length) * 100) }
}

export function toneOf(status: Status): Tone {
  if (status === 'paused') return 'subtle'
  if (status === 'done') return 'success'
  if (status === 'failed' || status === 'blocked') return 'error'
  if (isWaitingOnPerson(status) || status === 'orphaned') return 'warning'
  if (isTerminal(status)) return 'subtle'
  return 'claude'
}

function stageSeconds(run: Run, id: string, now: number): number {
  return run.stages.filter(s => s.id === id).reduce((sum, s) => sum + ((s.finished_at ?? now) - s.started_at), 0)
}

const TIME_NAMES: Record<'es' | 'en', Record<TimeKind | 'unmeasured', string>> = {
  es: { work: 'trabajando', agents: 'agentes', tests: 'tests y CI', you: 'te esperó', paused: 'pausado', unmeasured: 'sin medir' },
  en: { work: 'working', agents: 'agents', tests: 'tests and CI', you: 'waited for you', paused: 'paused', unmeasured: 'unmeasured' },
}

function timeSection(run: Run, now: number): Row[] {
  const lang = run.lang
  const es = lang === 'es'
  const names = TIME_NAMES[lang]
  const stages = STAGES.flatMap(stage => {
    const time = run.time?.[stage.id]
    const wall = stageSeconds(run, stage.id, now)
    return time && wall > 0 ? [{ id: stage.id, label: stage.label[lang], time, wall }] : []
  })
  if (stages.length === 0) return []
  const labelWidth = Math.max(5, ...stages.map(stage => stage.label.length))
  const wallTotal = stages.reduce((sum, stage) => sum + stage.wall, 0)
  const wallWidth = Math.max(...stages.map(stage => duration(stage.wall).length), duration(wallTotal).length)
  const parts = (time: Partial<Record<TimeKind, number>>, wall: number) => {
    const measured = TIME_KINDS.reduce((sum, kind) => sum + (time[kind] ?? 0), 0)
    const list = TIME_KINDS.filter(kind => (time[kind] ?? 0) >= 1).map(kind => `${names[kind]} ${duration(time[kind] ?? 0)}`)
    if (wall - measured >= 60) list.push(`${names.unmeasured} ${duration(wall - measured)}`)
    return list.join(' · ')
  }
  const indent = ' '.repeat(2 + labelWidth + 2 + wallWidth + 2)
  const rows: Row[] = [{ text: es ? 'Tiempo por etapa' : 'Time by stage', tone: 'subtle' }]
  const totals: Partial<Record<TimeKind, number>> = {}
  for (const { label, time, wall } of stages) {
    for (const kind of TIME_KINDS) totals[kind] = (totals[kind] ?? 0) + (time[kind] ?? 0)
    rows.push({ text: `  ${label.padEnd(labelWidth)}  ${duration(wall).padStart(wallWidth)}  ${parts(time, wall)}`.trimEnd(), tone: 'text' })
    const roles = Object.entries(time.roles)
      .sort(([, a], [, b]) => b - a)
      .map(([role, seconds]) => `${roleName(lang, role, 1)} ${duration(seconds)}`)
    if (roles.length > 0) rows.push({ text: `${indent}${es ? 'agentes en total' : 'agents in all'}: ${roles.join(' · ')}`, tone: 'subtle' })
  }
  rows.push({ text: `  ${'Total'.padEnd(labelWidth)}  ${duration(wallTotal).padStart(wallWidth)}  ${parts(totals, wallTotal)}`.trimEnd(), tone: 'text' })
  return rows
}

function usageSection(run: Run): Row[] {
  const lang = run.lang
  const es = lang === 'es'
  const stages = STAGES.flatMap(stage => {
    const used = run.usage?.[stage.id]
    return used && tokenTotal(used) > 0 ? [{ label: stage.label[lang], used }] : []
  })
  if (stages.length === 0) return []
  const hasUsd = stages.some(stage => stage.used.usd > 0)
  const money = (usd: number, tokens: number) => (hasUsd ? usdText(usd) : `${tokensText(tokens)} tok`)
  const total = stages.reduce(
    (sum, { used }) => ({
      usd: sum.usd + used.usd,
      tokens: sum.tokens + tokenTotal(used),
      cache: sum.cache + used.cache_read,
      output: sum.output + used.output,
    }),
    { usd: 0, tokens: 0, cache: 0, output: 0 },
  )
  const labelWidth = Math.max(5, ...stages.map(stage => stage.label.length))
  const moneyWidth = Math.max(...stages.map(({ used }) => money(used.usd, tokenTotal(used)).length), money(total.usd, total.tokens).length)
  const rows: Row[] = [{ text: es ? 'Consumo por etapa (aprox.)' : 'Usage by stage (approx.)', tone: 'subtle' }]
  for (const { label, used } of stages) {
    const roles = Object.entries(used.roles)
      .filter(([, role]) => role.tokens > 0)
      .sort(([, a], [, b]) => (hasUsd ? b.usd - a.usd : b.tokens - a.tokens))
      .map(([role, part]) => `${roleName(lang, role, 1)} ${money(part.usd, part.tokens)}`)
    const tokens = hasUsd ? `  ${tokensText(tokenTotal(used)).padStart(6)} tok` : ''
    rows.push({ text: `  ${label.padEnd(labelWidth)}  ${money(used.usd, tokenTotal(used)).padStart(moneyWidth)}${tokens}  ${roles.join(' · ')}`, tone: 'text' })
  }
  const cached = total.tokens > 0 ? Math.round((total.cache / total.tokens) * 100) : 0
  const totalTokens = hasUsd ? `  ${tokensText(total.tokens).padStart(6)} tok` : ''
  rows.push({
    text: `  ${(es ? 'Total' : 'Total').padEnd(labelWidth)}  ${money(total.usd, total.tokens).padStart(moneyWidth)}${totalTokens}  ${cached}% ${es ? 'de caché' : 'cached'} · ${tokensText(total.output)} ${es ? 'de salida' : 'output'}`,
    tone: 'text',
  })
  return rows
}

const SHOWS_AGENTS: ReadonlySet<Status> = new Set<Status>(['running', 'waiting_agents', 'waiting_tests', 'waiting_ci', 'pausing'])

function agentRows(run: Run, now: number, tone: Tone): Row[] {
  const live = liveAgents(run)
  const finished = finishedAgents(run)
  const all = [...live, ...finished]
  if (all.length === 0) return []
  const es = run.lang === 'es'
  const roleWidth = Math.max(...all.map(a => roleName(run.lang, a.role, 1).length))
  const modelWidth = Math.max(...all.map(a => shortModel(a.model).length))
  const took = (agent: AgentEntry) => duration((agent.finished_at ?? now) - agent.started_at)
  const timeWidth = Math.max(...all.map(a => took(a).length))
  const failure: Record<string, string> = es ? { failed: 'falló', killed: 'cancelado' } : { failed: 'failed', killed: 'killed' }
  const line = (agent: AgentEntry) => {
    const outcome = failure[agent.status] ? ` ${failure[agent.status]}` : ''
    const cells = [roleMark(agent.role).icon, roleName(run.lang, agent.role, 1).padEnd(roleWidth)]
    if (modelWidth > 0) cells.push(shortModel(agent.model).padEnd(modelWidth))
    cells.push(`${took(agent).padStart(timeWidth)}${outcome}`)
    return `  ${cells.join(' ')}${agent.description ? `  ${agent.description}` : ''}`
  }
  const rows: Row[] = live.map(agent => ({ text: line(agent), tone }))
  const scope = agentScope(run)
  if (finished.length > 0 && scope) {
    rows.push({ text: `  ${es ? `Terminados en ${scope.label}` : `Finished in ${scope.label}`}`, tone: 'subtle' })
    rows.push(...finished.map(agent => ({ text: line(agent), tone: failure[agent.status] ? ('error' as const) : ('subtle' as const) })))
  }
  return rows
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
  const agents = SHOWS_AGENTS.has(status) ? agentChips(run, now) : []
  const band: Band = {
    title: `wololo · ${run.source.kind === 'github_issue' ? `${shortRef(run)} ${run.title}` : run.title}`,
    mode: run.mode,
    heading: run.source.kind === 'github_issue' ? `${shortRef(run)} ${run.title}` : run.title,
    modeChip: `${modeLine(run.mode, lang).icon} ${run.mode}`,
    stageText: stageText(run),
    modeLine: modeLine(run.mode, lang),
    stage: stageLabel(run),
    activity: activity(run, status, now),
    badge: badge(lang, status),
    detail: statusDetail(run, status, now, agents.length === 0),
    agents,
    tone,
    progress: progressOf(run),
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
  summary.push(...agentRows(run, now, 'claude'))
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
    const used = run.usage?.[stage.id]
    if (used) text += ` · ${used.usd > 0 ? usdText(used.usd) : `${tokensText(tokenTotal(used))} tok`}`
    summary.push({ text, tone: isCurrent ? tone : done.has(stage.id) ? 'text' : 'subtle' })
  })
  gap()
  for (const section of [timeSection(run, now), usageSection(run)]) {
    if (section.length === 0) continue
    summary.push(...section)
    gap()
  }

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
      ...liveAgents(run).map(agent => {
        const model = shortModel(agent.model)
        return `${roleMark(agent.role).icon} ${roleName(run.lang, agent.role, 1)}${model ? ` (${model})` : ''} ${duration(now - agent.started_at)}${agent.description ? `: ${agent.description}` : ''}`
      }),
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

export function fitChips<T extends { icon: string; text: string }>(chips: readonly T[], width: number): Array<T & { label: string }> {
  const fitted: Array<T & { label: string }> = []
  let used = 0
  for (const chip of chips) {
    const gap = fitted.length > 0 ? 3 : 0
    const label = `${chip.icon} ${chip.text}`
    if (used + gap + label.length > width) {
      const room = width - used - gap
      if (room > 4) fitted.push({ ...chip, label: `${label.slice(0, room - 1)}…` })
      break
    }
    fitted.push({ ...chip, label })
    used += gap + label.length
  }
  return fitted
}

export function wrapLines(text: string, width: number, max: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= width) line = next
    else {
      if (line) lines.push(line)
      line = word.length > width ? word.slice(0, width) : word
    }
  }
  if (line) lines.push(line)
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  const last = kept[max - 1] ?? ''
  kept[max - 1] = `${last.length >= width ? last.slice(0, width - 1) : last}…`
  return kept
}

export function pageOf(rows: Row[], size: number, wanted: number, focus: number): { rows: Row[]; start: number; size: number; total: number } {
  const total = rows.length
  const last = Math.max(0, total - size)
  const start = wanted >= 0 ? Math.min(wanted, last) : focus >= 0 ? Math.min(Math.max(0, focus - 2), last) : 0
  return { rows: rows.slice(start, start + size), start, size, total }
}

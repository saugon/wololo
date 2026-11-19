import type { Band, Block, Line, PaneView, Progress, Row, Segment, Span, Tone, ViewState } from '../types'
import { type Entry, formatEntry, timeline } from './history'
import {
  type AgentEntry,
  type Lang,
  type Run,
  type RunEvent,
  type Status,
  type TaskEntry,
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
  durationUp,
  header,
  isTerminal,
  isWaitingOnPerson,
  itemsText,
  liveAgents,
  liveTasks,
  shortRef,
  stageLabel,
  statusLine,
  t,
  busyTasks,
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
  mockup: { es: 'Mck', en: 'Mck' },
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
  const items = itemsText(run)
  return items ? `${label} · ${items}` : label
}

// While an item is being built, the card's detail line says which one, and what the orchestrator noted it is doing, in place of the
// background shells: those say little, and one a subagent left open stays there until the session ends.
function bandDetail(run: Run, status: Status, now: number, withAgents: boolean): string {
  const item = run.stage?.id === 'implement' ? run.items.current : null
  if (item && (status === 'running' || status === 'waiting_agents')) return [item.title, run.doing?.text].filter(Boolean).join(' · ')
  return statusDetail(run, status, now, withAgents)
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
    const isDone = run.outcome === 'done' || (currentIndex >= 0 ? index < currentIndex : done.has(stage.id))
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
  if (status === 'in_review') return 'merged'
  if (status === 'done') return 'success'
  if (status === 'failed' || status === 'blocked') return 'error'
  if (isWaitingOnPerson(status) || status === 'orphaned') return 'warning'
  if (isTerminal(status)) return 'subtle'
  return 'claude'
}

// The time measured as work: the session's turns, its agents, and the tests and CI it waited on.
function activeSeconds(time: Partial<Record<TimeKind, number>>): number {
  return (time.work ?? 0) + (time.agents ?? 0) + (time.tests ?? 0)
}

function stageSeconds(run: Run, id: string, now: number): number {
  return run.stages.filter(s => s.id === id).reduce((sum, s) => sum + ((s.finished_at ?? now) - s.started_at), 0)
}

const TIME_NAMES: Record<'es' | 'en', Record<TimeKind | 'unmeasured', string>> = {
  es: { work: 'trabajando', agents: 'agentes', tests: 'tests y CI', you: 'te esperó', paused: 'pausado', review: 'en revisión', unmeasured: 'sin medir' },
  en: { work: 'working', agents: 'agents', tests: 'tests and CI', you: 'waited for you', paused: 'paused', review: 'in review', unmeasured: 'unmeasured' },
}

export type WorktreeInfo = {
  head: string | null
  subject: string | null
  ahead: number | null
  behind: number | null
  dirty: number | null
  ports: Array<{ name: string; port: number; listening: boolean | null }>
  // Whether the slot is the instance the project gave the work tree (config.instance.read).
  instance?: boolean
  // The instance the project's registry gives the work tree, when it has one; differs from the run's slot while instance.used holds another.
  registered?: number | null
  // The instance's databases with their open connections, and the local Postgres' total against its max_connections.
  databases?: { list: Array<{ name: string; connections: number }>; total: number | null; max: number | null } | null
  // Other ports served from inside the work tree: servers the run left up beside the configured ones.
  others?: Array<{ name: string; port: number }>
}

function home(path: string, homeDir: string | undefined): string {
  return homeDir && path.startsWith(`${homeDir}/`) ? `~${path.slice(homeDir.length)}` : path
}

const span = (text: string, tone?: Span['tone'], bold?: boolean): Span => ({ text, ...(tone ? { tone } : {}), ...(bold ? { bold } : {}) })

// The git, ports and path rows, each fact under its own name: the branch, its base and how far the branch is from it, HEAD,
// what is left uncommitted, the run's slot and ports, and the directory.
function placeBlocks(run: Run, info: WorktreeInfo | undefined, homeDir: string | undefined): Block[] {
  const es = run.lang === 'es'
  const dir = run.project.worktree ?? run.project.path
  if (!dir) return []
  const blocks: Block[] = []
  const named = (rows: Array<[string, Span[]]>): Line[] => {
    const width = Math.max(...rows.map(([name]) => name.length))
    return rows.map(([name, rest]) => [span(`${name.padEnd(width)}  `, 'subtle'), ...rest])
  }
  const git: Array<[string, Span[]]> = []
  if (run.project.branch) git.push([es ? 'rama' : 'branch', [span(run.project.branch, 'text')]])
  if (run.project.base) {
    const line: Span[] = [span(run.project.base, 'text')]
    const ahead = info?.ahead ?? null
    const behind = info?.behind ?? null
    if (ahead !== null && behind !== null) {
      line.push(span(' · ', 'subtle'))
      if (ahead === 0 && behind === 0) line.push(span(es ? 'al día' : 'up to date', 'success'))
      else {
        const parts: Span[] = []
        if (ahead > 0) parts.push(span(es ? `${ahead} commits adelante` : `${ahead} commits ahead`, 'success'))
        if (behind > 0) parts.push(span(es ? `${behind} atrás` : `${behind} behind`, 'warning'))
        parts.forEach((part, i) => line.push(...(i > 0 ? [span(', ', 'subtle')] : []), part))
      }
    }
    git.push(['base', line])
  }
  if (info?.head) git.push([es ? 'último' : 'last', [span(info.head, 'suggestion'), span(info.subject ? ` ${info.subject}` : '', 'text')]])
  if (info?.dirty) {
    const files = es ? (info.dirty === 1 ? 'archivo sin commitear' : 'archivos sin commitear') : info.dirty === 1 ? 'uncommitted file' : 'uncommitted files'
    git.push([es ? 'cambios' : 'changes', [span(`${info.dirty} ${files}`, 'warning')]])
  }
  if (git.length > 0) blocks.push({ label: 'git', lines: named(git), gap: true })
  const others = info?.others ?? []
  if (info && (info.ports.length > 0 || info.instance || others.length > 0)) {
    const slot: Span[] = [span(String(run.slot), 'text')]
    const registered = info.registered ?? null
    if (run.instance_used && registered !== null && registered !== run.slot) slot.push(span(es ? `  (worktree: ${registered})` : `  (work tree: ${registered})`, 'subtle'))
    const ports: Array<[string, Span[]]> = [[info.instance || run.instance_used ? (es ? 'instancia' : 'instance') : 'slot', slot]]
    for (const port of info.ports) {
      const state =
        port.listening === null ? [] : port.listening ? [span(es ? '  en uso' : '  in use', 'claude')] : [span(es ? '  libre' : '  free', 'subtle')]
      ports.push([port.name, [span(String(port.port), 'text'), ...state]])
    }
    for (const other of others) ports.push([other.name.length > 24 ? `${other.name.slice(0, 23)}…` : other.name, [span(String(other.port), 'text'), span(es ? '  en uso' : '  in use', 'claude')]])
    blocks.push({ label: es ? 'puertos' : 'ports', lines: named(ports) })
  }
  const databases = info?.databases
  if (databases && databases.list.length > 0) {
    const rows: Array<[string, Span[]]> = databases.list.map(db => [
      db.name,
      db.connections > 0
        ? [span(es ? `${db.connections} ${db.connections === 1 ? 'conexión' : 'conexiones'}` : `${db.connections} connection${db.connections === 1 ? '' : 's'}`, 'claude')]
        : [span(es ? 'sin conexiones' : 'no connections', 'subtle')],
    ])
    if (databases.total !== null) {
      const full = databases.max !== null && databases.total >= databases.max * 0.9
      const of = databases.max !== null ? (es ? ` de ${databases.max}` : ` of ${databases.max}`) : ''
      rows.push(['postgres', [span(`${databases.total}${of} ${es ? 'conexiones en total' : 'connections in all'}`, full ? 'warning' : 'subtle')]])
    }
    blocks.push({ label: es ? 'bases' : 'databases', lines: named(rows) })
  }
  blocks.push({ label: es ? 'ruta' : 'path', lines: [[span(home(dir, homeDir), 'text')]], gap: blocks.length === 0 })
  return blocks
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
  // Active is what was measured as work; total is the wall time, the waits and what went unmeasured (the machine asleep) included.
  const active = (time: Partial<Record<TimeKind, number>>, wall: number) => Math.min(wall, activeSeconds(time))
  const wallTotal = stages.reduce((sum, stage) => sum + stage.wall, 0)
  const activeTotal = stages.reduce((sum, stage) => sum + active(stage.time, stage.wall), 0)
  const heads = es ? { active: 'activo', wall: 'total' } : { active: 'active', wall: 'total' }
  const activeWidth = Math.max(heads.active.length, ...stages.map(stage => durationUp(active(stage.time, stage.wall)).length), durationUp(activeTotal).length)
  const wallWidth = Math.max(heads.wall.length, ...stages.map(stage => durationUp(stage.wall).length), durationUp(wallTotal).length)
  const parts = (time: Partial<Record<TimeKind, number>>, wall: number) => {
    const measured = TIME_KINDS.reduce((sum, kind) => sum + (time[kind] ?? 0), 0)
    const list = TIME_KINDS.filter(kind => (time[kind] ?? 0) >= 1).map(kind => `${names[kind]} ${durationUp(time[kind] ?? 0)}`)
    if (wall - measured >= 60) list.push(`${names.unmeasured} ${durationUp(wall - measured)}`)
    return list.join(' · ')
  }
  const line = (label: string, time: Partial<Record<TimeKind, number>>, wall: number, activeSeconds: number) =>
    `  ${label.padEnd(labelWidth)}  ${durationUp(activeSeconds).padStart(activeWidth)}  ${durationUp(wall).padStart(wallWidth)}  ${parts(time, wall)}`.trimEnd()
  const indent = ' '.repeat(2 + labelWidth + 2 + activeWidth + 2 + wallWidth + 2)
  const rows: Row[] = [
    { text: es ? 'Tiempo por etapa' : 'Time by stage', tone: 'subtle' },
    { text: `  ${''.padEnd(labelWidth)}  ${heads.active.padStart(activeWidth)}  ${heads.wall.padStart(wallWidth)}`, tone: 'subtle' },
  ]
  const totals: Partial<Record<TimeKind, number>> = {}
  for (const { label, time, wall } of stages) {
    for (const kind of TIME_KINDS) totals[kind] = (totals[kind] ?? 0) + (time[kind] ?? 0)
    rows.push({ text: line(label, time, wall, active(time, wall)), tone: 'text' })
    const roles = Object.entries(time.roles)
      .sort(([, a], [, b]) => b - a)
      .map(([role, seconds]) => `${roleName(lang, role, 1)} ${durationUp(seconds)}`)
    if (roles.length > 0) rows.push({ text: `${indent}${es ? 'agentes en total' : 'agents in all'}: ${roles.join(' · ')}`, tone: 'subtle' })
  }
  rows.push({ text: line('Total', totals, wallTotal, activeTotal), tone: 'text' })
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

const LIVE: ReadonlySet<Status> = new Set<Status>(['running', 'waiting_agents', 'waiting_tests', 'waiting_ci', 'pausing'])

// When the state the badge names began: the question, the block, the pause, the oldest agent or suite still running, or the end.
function statusSince(run: Run, status: Status): number | null {
  const oldest = (times: number[]) => (times.length > 0 ? Math.min(...times) : null)
  switch (status) {
    case 'waiting_user':
    case 'waiting_permission':
      return run.waiting?.since ?? null
    case 'blocked':
      return run.blocked?.since ?? null
    case 'paused':
      return run.paused?.since ?? null
    case 'in_review':
      return run.pr_review?.since ?? null
    case 'waiting_agents':
      return oldest([...liveAgents(run), ...busyTasks(run)].map(entry => entry.started_at))
    case 'waiting_tests':
    case 'waiting_ci': {
      const kind = status === 'waiting_ci' ? 'ci' : 'tests'
      return oldest(liveTasks(run).filter(task => task.kind === kind).map(task => task.started_at))
    }
    case 'running':
    case 'pausing':
      return run.doing?.since ?? run.stage?.since ?? null
    case 'done':
    case 'failed':
    case 'cancelled':
      return run.finished_at
    default:
      return null
  }
}

// A background shell as the pane lists it: its port, from the event or the label, and its label without the verb and the port.
export function taskParts(task: TaskEntry): { port: number | null; name: string } {
  const label = task.label.trim()
  const found = /\b(?:port|puerto)\s+:?(\d{2,5})\b/i.exec(label) ?? /\b(?:on|en)\s+:?(\d{4,5})\b/i.exec(label) ?? /:(\d{4,5})\b/.exec(label)
  const port = task.port ?? (found?.[1] ? Number(found[1]) : null)
  const name =
    task.name ??
    label
      .replace(/^(?:run|start|serve|launch|boot|levantar|correr|arrancar)\s+(?:the\s+|el\s+|la\s+|los\s+)?/i, '')
      .replace(/\s+(?:on|at|en)\s+(?:port\s+|puerto\s+)?:?\d{2,5}\b/i, '')
      .replace(/\s*\((?:port|puerto)?\s*:?\d{2,5}\)/i, '')
      .trim()
  return { port, name: name || label }
}

const PROCESS_NAME_MAX = 32

// Background shells, one row per label: the same server started again reads as one row with each run's age and how many there are.
function processBlock(run: Run, now: number): Block | null {
  const groups = new Map<string, { port: number | null; name: string; kind: TaskEntry['kind']; ages: number[] }>()
  for (const task of liveTasks(run)) {
    const { port, name } = taskParts(task)
    const key = `${port ?? ''}|${name}`
    const group = groups.get(key) ?? { port, name, kind: task.kind, ages: [] }
    group.ages.push(now - task.started_at)
    groups.set(key, group)
  }
  if (groups.size === 0) return null
  const list = [...groups.values()].map(group => ({ ...group, ages: [...group.ages].sort((a, b) => b - a) }))
  const portWidth = Math.max(0, ...list.map(group => (group.port === null ? 0 : `:${group.port}`.length)))
  // A long label is cut so the ages stay near the names instead of past the pane's edge.
  const clipName = (name: string) => (name.length > PROCESS_NAME_MAX ? `${name.slice(0, PROCESS_NAME_MAX - 1)}…` : name)
  const nameWidth = Math.max(...list.map(group => clipName(group.name).length))
  const lines = list.map(group => {
    const line: Line = [span('↻ ', group.kind === 'server' || group.kind === 'other' ? 'success' : 'claude')]
    if (portWidth > 0) line.push(span(`${group.port === null ? '' : `:${group.port}`}`.padEnd(portWidth + 2), 'text'))
    line.push(span(clipName(group.name).padEnd(nameWidth + 3), 'text'))
    const shown = group.ages.slice(0, 3).map(age => duration(age))
    line.push(span(`${shown.join(' · ')}${group.ages.length > 3 ? ' · …' : ''}`, 'subtle'))
    if (group.ages.length > 1) line.push(span(`  ${group.ages.length}×`, 'warning'))
    return line
  })
  return { label: run.lang === 'es' ? 'procesos' : 'processes', lines, gap: true, table: true }
}

// What is going on now: what waits for the person or blocks, the item being built, what the orchestrator noted it is doing, each
// live agent with what it was asked to do, and how many finished or failed in the current item or stage.
function nowBlock(run: Run, now: number): Block | null {
  const es = run.lang === 'es'
  const lines: Line[] = []
  if (run.waiting) {
    const label = run.waiting.on === 'permission' ? (es ? '! Pide permiso' : '! Needs permission') : es ? '? Te espera' : '? Waiting for you'
    lines.push([span(`${label}: ${run.waiting.question}`, 'warning')])
  }
  if (run.blocked) lines.push([span(`✕ ${run.blocked.reason}`, 'error')])
  if (run.items.current && run.stage?.id === 'implement') {
    lines.push([span(`${es ? 'Ítem' : 'Item'} ${run.items.current.n}: ${run.items.current.title}`, 'text', true)])
  }
  // A note written before the run started waiting on CI or a suite is about earlier work.
  const waits = liveTasks(run).filter(task => task.kind === 'ci' || task.kind === 'tests')
  const isStale = run.doing && waits.length > 0 && run.doing.since < Math.min(...waits.map(task => task.started_at))
  if (run.doing?.text && !run.outcome && !isStale) lines.push([span(run.doing.text, 'text')])
  const agents = liveAgents(run)
  for (const agent of agents) {
    const mark = roleMark(agent.role)
    const line: Line = [span(`${mark.icon} ${roleName(run.lang, agent.role, 1)}`, mark.color)]
    const model = shortModel(agent.model)
    if (model) line.push(span(` · ${model}`, 'subtle'))
    line.push(span(` · ${duration(now - agent.started_at)}`, 'subtle'))
    lines.push(line)
    if (agent.description) lines.push([span(agent.description, 'text')])
  }
  const finished = finishedAgents(run)
  const failed = finished.filter(agent => agent.status === 'failed' || agent.status === 'killed').length
  const tally: Line = []
  if (finished.length > failed) tally.push(span(`+ ${finished.length - failed} ${es ? (finished.length - failed === 1 ? 'listo' : 'listos') : 'done'}`, 'subtle'))
  if (failed > 0) tally.push(span(`${tally.length > 0 ? ' · ' : ''}✕ ${failed} ${es ? (failed === 1 ? 'falló' : 'fallaron') : 'failed'}`, 'error'))
  if (tally.length > 0 && !run.outcome) lines.push(tally)
  return lines.length > 0 ? { label: es ? 'ahora' : 'now', lines, gap: true } : null
}

// One row per stage with its active time, its wall time and its cost, and the total of each under them. How a gate was answered
// is in the history, not here.
function stagesBlock(run: Run, now: number, tone: Tone): Block {
  const lang = run.lang
  const es = lang === 'es'
  const done = new Set(run.stages.filter(entry => entry.finished_at !== null).map(entry => entry.id))
  const hasUsd = Object.values(run.usage ?? {}).some(used => (used?.usd ?? 0) > 0)
  const money = (usd: number, tokens: number) => (hasUsd ? usdText(usd) : `${tokensText(tokens)} tok`)
  const time = (seconds: number) => (seconds >= 1 ? durationUp(seconds) : '')
  const totals = { active: 0, waited: 0, wall: 0, usd: 0, tokens: 0 }
  const rows = STAGES.map((stage, index) => {
    const isCurrent = run.stage?.index === index && !run.outcome
    const isAhead = !run.outcome && run.stage !== null && index > run.stage.index
    const wall = stageSeconds(run, stage.id, now)
    const parts = run.time?.[stage.id]
    // Active is what was measured as work (the session, its agents, tests and CI); waited is the rest of the wall time: the person, a
    // pause, the PR's reviewers, and what nobody measured, such as the machine asleep or the session closed. A stage without
    // measures (a run from before them) counts all of it as active.
    const active = parts ? Math.min(wall, activeSeconds(parts)) : wall
    const waited = wall - active
    const used = run.usage?.[stage.id]
    totals.active += active
    totals.waited += waited
    totals.wall += wall
    totals.usd += used?.usd ?? 0
    totals.tokens += used ? tokenTotal(used) : 0
    const state = isCurrent ? 'current' : done.has(stage.id) ? (isAhead ? 'redo' : 'done') : 'pending'
    return {
      state,
      label: stage.label[lang],
      cells: [wall > 0 ? durationUp(active) : '', time(waited), wall > 0 ? durationUp(wall) : '', used ? money(used.usd, tokenTotal(used)) : ''],
    }
  })
  const heads = es ? ['activo', 'esperando', 'total', 'costo'] : ['active', 'waiting', 'total', 'cost']
  const total = [durationUp(totals.active), time(totals.waited), durationUp(totals.wall), money(totals.usd, totals.tokens)]
  const nameWidth = Math.max(...rows.map(row => row.label.length))
  const widths = heads.map((head, i) => Math.max(head.length, (total[i] ?? '').length, ...rows.map(row => (row.cells[i] ?? '').length)))
  const cells = (values: readonly string[], from = 0, to = values.length) =>
    values
      .slice(from, to)
      .map((value, i) => value.padStart(widths[from + i] ?? 0))
      .join('  ')
  const marks = { current: ['●', tone], done: ['✓', 'success'], redo: ['↺', 'subtle'], pending: ['○', 'subtle'] } as const
  const lines: Line[] = rows.map(row => {
    const [mark, markTone] = marks[row.state as keyof typeof marks]
    const rowTone = row.state === 'current' ? tone : row.state === 'done' ? 'text' : 'subtle'
    const isCurrent = row.state === 'current'
    return [span(`${mark} `, markTone), span(row.label.padEnd(nameWidth), rowTone, isCurrent), span(`  ${cells(row.cells)}`, rowTone, isCurrent)]
  })
  const numbers = widths.reduce((sum, width) => sum + width, 0) + 2 * (widths.length - 1)
  lines.push([span(`${''.padEnd(2 + nameWidth)}  ${'─'.repeat(numbers)}`, 'subtle')])
  lines.push([
    span(`${'total'.padStart(2 + nameWidth)}  `, 'subtle'),
    span(`${cells(total, 0, 3)}  `, 'text'),
    span(cells(total, 3), 'text', true),
  ])
  const head: Line = [span(`${''.padEnd(2 + nameWidth)}  ${cells(heads)}`, 'subtle')]
  return { label: es ? 'etapas' : 'stages', head: [head], lines, gap: true, table: true }
}

const strip = (rows: readonly Row[]): Line[] => rows.map(row => [span(row.text.replace(/^ {2}/, ''), row.tone)])

// The Detail tab: time and usage split their parts, the agents of the item or stage, the run's counts, its PR, files and events.
function detailBlocks(run: Run, now: number, runDir: string | undefined, events: readonly Row[]): Block[] {
  const es = run.lang === 'es'
  const blocks: Block[] = []
  const time = timeSection(run, now).slice(1)
  if (time.length > 0) blocks.push({ label: es ? 'tiempo' : 'time', head: strip(time.slice(0, 1)), lines: strip(time.slice(1)), gap: true, table: true })
  const usage = usageSection(run).slice(1)
  if (usage.length > 0) blocks.push({ label: es ? 'consumo' : 'usage', lines: strip(usage), gap: true, table: true })
  const agents = agentRows(run, now, 'claude')
  if (agents.length > 0) blocks.push({ label: es ? 'agentes' : 'agents', lines: strip(agents), gap: true, table: true })
  const c = run.counts
  blocks.push({
    label: 'run',
    gap: true,
    lines: [
      [span(`${run.mode} · ${es ? 'riesgo' : 'risk'} ${run.risk}`, 'text')],
      [
        span(
          es
            ? `Supuestos ${c.assumptions} · Decisiones ${c.decisions} · Debate ${c.debate_turns} · Reversiones ${c.reversals}${c.unsigned ? ` · Sin firmar ${c.unsigned}` : ''}`
            : `Assumptions ${c.assumptions} · Decisions ${c.decisions} · Debate ${c.debate_turns} · Reversals ${c.reversals}${c.unsigned ? ` · Unsigned ${c.unsigned}` : ''}`,
          'subtle',
        ),
      ],
    ],
  })
  if (run.pr) {
    const ci = run.pr.ci
    const line: Line = [span(run.pr.url, 'suggestion'), span(` · ${run.pr.state}`, 'text')]
    if (ci) line.push(span(` · CI ${ci}`, ci === 'passing' ? 'success' : ci === 'failing' ? 'error' : 'claude'))
    blocks.push({ label: 'pr', lines: [line] })
  }
  if (runDir) blocks.push({ label: es ? 'archivos' : 'files', lines: [[span(runDir, 'text')]] })
  if (events.length > 0) blocks.push({ label: es ? 'eventos' : 'events', lines: events.slice(0, 8).map(row => [span(row.text, row.tone)]), gap: true, table: true })
  return blocks
}

// The pane's blocks as plain rows, for the card above the prompt: each label above its lines, the lines indented under it.
export function flatten(blocks: readonly Block[]): Row[] {
  const rows: Row[] = []
  for (const block of blocks) {
    if (block.gap && rows.length > 0) rows.push({ text: '', tone: 'subtle' })
    rows.push({ text: block.label, tone: 'subtle' })
    for (const line of [...(block.head ?? []), ...block.lines]) {
      const main = line.reduce<Span | undefined>((best, part) => (part.text.trim().length > (best?.text.trim().length ?? -1) ? part : best), undefined)
      const tone = (['text', 'subtle', 'claude', 'warning', 'error', 'success', 'merged'] as const).find(name => name === main?.tone) ?? 'text'
      rows.push({ text: `  ${line.map(part => part.text).join('')}`.trimEnd(), tone })
    }
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
  worktree?: WorktreeInfo,
  homeDir?: string,
): ViewState {
  const tone = toneOf(status)
  const lang = run.lang
  const es = lang === 'es'
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
    detail: bandDetail(run, status, now, agents.length === 0),
    agents,
    tone,
    progress: progressOf(run),
    pr: run.pr ? { label: run.pr.number ? `#${run.pr.number}` : 'PR', url: run.pr.url } : null,
  }

  const entries = history ?? timeline(recent, lang)
  const toRow = (entry: Entry): Row => ({
    text: formatEntry(entry),
    tone: entry.icon === '✕' ? 'error' : entry.icon === '?' || entry.icon === '!' ? 'warning' : entry.isMajor ? 'text' : 'subtle',
  })
  const majorRows = entries.filter(entry => entry.isMajor).map(toRow).reverse()
  const allRows = entries.map(toRow).reverse()

  const summary = [nowBlock(run, now), processBlock(run, now), stagesBlock(run, now, tone), ...placeBlocks(run, worktree, homeDir)].filter(
    (block): block is Block => block !== null,
  )
  const detail = detailBlocks(run, now, runDir, majorRows)

  const since = statusSince(run, status)
  const ago = since === null ? '' : `${isTerminal(status) ? (es ? 'hace' : '') : es ? 'desde hace' : 'for'} ${duration(now - since)}${isTerminal(status) && !es ? ' ago' : ''}`.trim()
  const pane: PaneView = {
    ref: run.source.kind === 'github_issue' ? shortRef(run) : '',
    title: run.title,
    status: { badge: band.badge, tone, since: ago },
    stage: {
      icon: LIVE.has(status) ? '✱' : (band.badge.split(' ')[0] ?? '·'),
      label: run.stage ? (STAGES[run.stage.index]?.label[lang] ?? run.stage.id) : t(lang, 'noStage'),
      position: run.stage ? `${run.stage.index + 1}/${STAGES.length}` : '',
    },
    summary,
    detail,
  }

  const itemRows: Row[] = (run.items.list ?? []).map(item => {
    const mark = { done: '✓', active: '●', failing: '✕', pending: '○' }[item.state]
    const sha = item.sha ? `  ${item.sha.slice(0, 9)}` : ''
    const itemTone: Tone = item.state === 'done' ? 'text' : item.state === 'active' ? tone : item.state === 'failing' ? 'warning' : 'subtle'
    return { text: `${mark} ${item.n}. ${item.title}${sha}`, tone: itemTone }
  })

  return {
    runId: run.id,
    header: header(run, status, now),
    statusLine: statusLine(run, status, now),
    band,
    details: flatten(summary),
    more: flatten(detail),
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
    const items = itemsText(run) ? ` · ${itemsText(run)}` : ''
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

// A run another tool drives without a session, as its own JSON status said: its state, who it waits on, and what unblocks it.
export type MirrorRun = { id: string; issue: string; state: string; waiting_on: string; unblock: string | null; exit: number }

export function mirrorCards(runs: readonly MirrorRun[], project: string, lang: Lang): StatusCard[] {
  const es = lang === 'es'
  return runs.map(run => {
    const person = run.exit === 2
    return {
      id: run.id,
      project,
      title: `runner ${run.issue ? `#${run.issue}` : run.id}`,
      badge: person ? (es ? '✋ te espera' : '✋ waiting for you') : run.exit === 3 ? (es ? '⏳ sigue solo' : '⏳ goes on by itself') : run.state,
      tone: person ? 'warning' : 'subtle',
      stage: run.state,
      current: '',
      doing: person ? '' : run.waiting_on,
      workers: [],
      waiting: person ? [run.waiting_on, run.unblock].filter(Boolean).join(' · ') : '',
      last: '',
      ago: '',
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

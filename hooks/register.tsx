import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, TurnUsage } from 'claude-code'

import {
  ADAPTER_POINTS,
  type AdapterPoint,
  type Config,
  DEFAULT_CONFIG,
  envPrefix,
  expand,
  LAUNCH_FLAGS,
  merge,
  type Overrides,
  parseFlags,
  parseJson,
  planTouched,
  ports,
  projectKey,
  resolve,
  riskyFiles,
  shellQuote,
  slugify,
  touchedPattern,
  validate,
  withEnv,
  withOverrides,
} from './config'
import {
  type AdapterJob,
  type EventType,
  type Live,
  type Run,
  type RunEvent,
  type Snapshot,
  type Source,
  type StageId,
  type TimeKind,
  STAGES,
  apply,
  clip,
  rebuild,
  deriveStatus,
  effectiveStatus,
  emptyRun,
  header,
  isTerminal,
  ORPHAN_AFTER_SECONDS,
  nextSeq,
  sinceLastSeen,
  stageIndex,
  timeKind,
} from './model'
import { GITHUB_BODY_LIMIT, type PublishKind, decide, ghArgs, urlIn } from './github'
import {
  type PolicyContext,
  commandRules,
  githubWriteDenial,
  isAllowedBash,
  isAllowedPath,
  isInside,
  isReadInside,
  pushDenial,
  renamedBranch,
  hasPush,
  segments,
} from './policy'
import {
  type Field,
  type InitChoice,
  type InitQuestion,
  SECTIONS,
  applyChoice,
  chosenIndex,
  detectedRows,
  fieldValue,
  initQuestions,
  parseInput,
  setAt,
} from './configui'
import { helpLangOf, helpNow, helpSections, helpText } from './help'
import { type Entry, formatEntry, historyMarkdown, timeline } from './history'
import { changedSinceApproval, checkEvent, hintFor, stageForFile } from './rules'
import {
  type Paths,
  appendLines,
  git,
  lastSeqOnDisk,
  listRuns,
  loadRun,
  pathsFor,
  projectConfigPath,
  readEvents,
  readJson,
  readText,
  rotateIfLarge,
  runDir,
  writeAtomic,
  writeJson,
} from './store'
import type { Block, ConfigDialog, Line, Row, Tab, ViewState } from '../types'
import {
  type MirrorRun,
  type StatusCard,
  type WorktreeInfo,
  barLabels,
  buildView,
  fitChips,
  mirrorCards,
  statusCards,
  statusTable,
  thinBar,
  wrapLines,
} from './ui'

type Engine = EngineInterface

const TOOL_PREFIX = 'mcp__wololo__'
const PANE = 'wololo'
const TICK_MS = 1_000
// keep_awake holds the machine up in five-minute leases, renewed every four while a run is active: the lease ends on its own when the run or
// the session does.
const AWAKE_LEASE_SECONDS = 300
const AWAKE_RENEW_TICKS = 240
// The tick at which the next lease is due: the first tick a run is active, then every AWAKE_RENEW_TICKS.
let awakeRenewAt = 0
const HEARTBEAT_TICKS = 15
const REDRAW_TICKS = 30
const MAX_NUDGES = 2
const RECENT = 40
const AGENT_GRACE_SECONDS = 20
const HEADER_WINDOW_SECONDS = 15
const FINISHED = /^(completed|failed|killed|stopped|cancelled|error)/i

const viewAtom = atom({ plugin: 'wololo', key: 'view' } as const, null)
const expandedAtom = atom({ plugin: 'wololo', key: 'expanded' } as const, false)
const tabAtom = atom({ plugin: 'wololo', key: 'tab' } as const, 'summary')
const detailAtom = atom({ plugin: 'wololo', key: 'detail' } as const, false)
const dialogAtom = atom({ plugin: 'wololo', key: 'dialog' } as const, null)
const CONFIG_PANE = 'wololo-config'
const ownerAtom = atom({ plugin: 'wololo', key: 'owner' } as const, '')
const INSTANCE = Math.random().toString(36).slice(2, 10)
// The session.end reasons on which the process exits, and its background shells with it. /clear and resume go on in the same process.
const EXITS: ReadonlySet<string> = new Set(['prompt_input_exit', 'logout', 'other'])
// The sessions this process ran a run in and let go of on /clear: a resume from the cleared session takes it back without waiting for
// the old one's heartbeat to go stale.
const released = new Set<string>()

let paths: Paths | undefined
let root = ''
let sessionId = ''
let config: Config = DEFAULT_CONFIG
let run: Run | undefined
let recent: RunEvent[] = []
let pending: RunEvent[] = []
// Bumped each time run and pending are replaced (a start, a resume, a run loaded at session start, a restore): a flush that began on an
// earlier load does not hand its events to this one's pending, nor number this one's from them.
let loadGeneration = 0
// Batches a flush could not write once their load was replaced, each with its run's directory and the run as that load left it: the next
// flush writes them first.
let orphaned: Array<{ dir: string; events: RunEvent[]; of: Run }> = []
// Events a flush took out of pending and has not settled yet: written, put back or dropped.
let inFlight = 0
let isDirty = false
let isWriting = false
let ticks = 0
let timer: { cancel: () => void } | undefined
let live: Live = { isTurnRunning: false, question: null, permission: null }
let priorUserAt: number | null = null
let lastTurnEndAt = 0
let reorient = false
let historyCache: Entry[] | undefined
let pendingPermission: { toolUseId: string; tool: string; what: string } | null = null
let asks = new Map<string, { tool: string; what: string; key: string }>()
let worktreeInfo: WorktreeInfo | null = null
let homeDir = ''
let pendingUsage = new Map<
  string,
  { stage: StageId; role: string; input: number; output: number; cache_read: number; cache_write: number; usd: number }
>()
let lastUsd: number | null = null
let timeMark: { stage: StageId; kind: TimeKind; since: number } | null = null
let pendingTime = new Map<string, { stage: StageId; kind: TimeKind; seconds: number }>()
const headers = new Map<string, string>()
const statusRenders = new Map<string, StatusCard[]>()

function describeCall(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Bash' && typeof input.command === 'string') return clip(input.command.replace(/\s+/g, ' '), 80)
  if (tool === 'Agent') return [input.subagent_type, input.description].filter(part => typeof part === 'string' && part).join(': ')
  for (const key of ['file_path', 'notebook_path', 'path', 'url']) if (typeof input[key] === 'string') return clip(String(input[key]), 80)
  return ''
}

function isRunAgent(type: unknown): boolean {
  return typeof type === 'string' && (type.startsWith('wololo:') || Object.values(config.project_agents).includes(type))
}

async function liftBlock($: Engine, by: 'answer' | 'message') {
  if (!run?.blocked || run.outcome) return
  await emit($, 'unblocked', { auto: true, by })
}

function askKey(tool: string, input: unknown): string {
  return `${tool}\u0000${JSON.stringify(input ?? null)}`
}

async function notePermission($: Engine, tool: string, input: Record<string, unknown>) {
  const key = askKey(tool, input)
  const found = [...asks].reverse().find(([, ask]) => ask.key === key) ?? [...asks].reverse().find(([, ask]) => ask.tool === tool)
  const toolUseId = found?.[0] ?? ''
  const what = found?.[1].what ?? describeCall(tool, input)
  live.permission = what ? `${tool} · ${what}` : tool
  pendingPermission = { toolUseId, tool, what }
  await emit($, 'permission.asked', { tool, what })
}

async function settlePermission($: Engine, toolUseId: string, outcome: 'approved' | 'denied' | 'not_run') {
  const asked = pendingPermission
  if (!asked) {
    if (outcome === 'not_run' && run?.waiting?.on === 'permission') {
      live.permission = null
      await emit($, 'permission.resolved', { tool: run.waiting.question, what: '', outcome })
    }
    return
  }
  if (outcome !== 'not_run' && asked.toolUseId !== toolUseId) return
  pendingPermission = null
  live.permission = null
  await emit($, 'permission.resolved', { tool: asked.tool, what: asked.what, outcome })
}

const TABS = [
  { id: 'summary', key: 'r' },
  { id: 'detail', key: 'd' },
  { id: 'items', key: 'i' },
  { id: 'history', key: 'h' },
] as const

function tabName(lang: string, which: Tab): string {
  const names =
    lang === 'es'
      ? { summary: 'Resumen', detail: 'Detalle', items: 'Ítems', history: 'Historial' }
      : { summary: 'Summary', detail: 'Detail', items: 'Items', history: 'History' }
  return names[which]
}

function detailLabel(lang: string, withDetail: boolean): string {
  if (lang === 'es') return withDetail ? 'sin detalle' : 'con detalle'
  return withDetail ? 'less detail' : 'more detail'
}

function tabRows(view: ViewState, tab: Tab, withDetail: boolean, lang: string): Row[] {
  if (tab === 'summary') return view.details ?? []
  if (tab === 'detail') return view.more ?? []
  if (tab === 'items') {
    return (view.items ?? []).length > 0
      ? (view.items ?? [])
      : [{ text: lang === 'es' ? 'El plan todavía no tiene ítems.' : 'The plan has no items yet.', tone: 'subtle' }]
  }
  const rows = (withDetail ? view.historyAll : view.history) ?? []
  return rows.length > 0 ? rows : [{ text: lang === 'es' ? 'Todavía no pasó nada que contar.' : 'Nothing to tell yet.', tone: 'subtle' }]
}

function paint(tone: string): string {
  const colors = config.view.colors
  if (tone === 'claude') return colors.working
  if (tone === 'warning') return colors.waiting
  if (tone === 'error') return colors.blocked
  if (tone === 'success') return colors.done
  return tone
}

async function quietly(work: () => Promise<void> | void) {
  try {
    await work()
  } catch {
    // The run's bookkeeping never fails the session's own event.
  }
}

async function nowSeconds($: Engine): Promise<number> {
  return (await $.clock.now()) / 1000
}

function hex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2))
  crypto.getRandomValues(bytes)
  return [...bytes]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}

function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ProjectInfo = { key: string; toplevel: string; mainPath: string; repoName: string }

async function projectInfo($: Engine, cwd: string): Promise<ProjectInfo | null> {
  const toplevel = await git($, cwd, ['rev-parse', '--show-toplevel'])
  if (!toplevel) return null
  const common = (await git($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) ?? `${toplevel}/.git`
  const remote = (await git($, cwd, ['remote', 'get-url', 'origin'])) ?? ''
  const mainPath = common.replace(/\/\.git\/?$/, '')
  return { key: projectKey(remote, common), toplevel, mainPath, repoName: mainPath.split('/').pop() ?? 'repo' }
}

async function loadConfig($: Engine, key: string): Promise<{ config: Config; errors: string[]; projectExists: boolean }> {
  if (!paths) return { config: DEFAULT_CONFIG, errors: [], projectExists: false }
  const globalText = await readText($, paths.globalConfig)
  const projectText = await readText($, projectConfigPath(paths, key))
  const global = parseJson(globalText)
  const project = parseJson(projectText)
  const parseErrors = [
    ...(global.error ? [`global config.json: ${global.error}`] : []),
    ...(project.error ? [`project config.json: ${project.error}`] : []),
  ]
  const resolved = resolve(global.value, project.value)
  return { config: resolved.config, errors: [...parseErrors, ...resolved.errors], projectExists: projectText !== undefined }
}

// The help shows, next to each launch flag, what this project does without it: its config, not a run's flags.
let helpConfig: Config = DEFAULT_CONFIG

async function help($: Engine): Promise<string> {
  const info = await projectInfo($, await $.session.cwd())
  helpConfig = info ? (await loadConfig($, info.key)).config : DEFAULT_CONFIG
  return helpText(run?.lang ?? config.languages.chat, helpConfig)
}

// The project's config, with the active run's launch flags over it.
async function runConfig($: Engine, key: string): Promise<Config> {
  const loaded = (await loadConfig($, key)).config
  return run && run.project.key === key ? withOverrides(loaded, run.overrides as Overrides | undefined) : loaded
}

function policyContext(): PolicyContext | null {
  if (!run || run.outcome || !paths) return null
  const rules = commandRules(
    [
      ...config.tests.suite,
      ...config.tests.e2e,
      ...config.tests.touched.map(entry => entry.cmd),
      ...config.commands.start.map(start => start.cmd),
      // The wait for a background adapter step is wololo's own.
      ...(run.adapter_job?.wait ? [run.adapter_job.wait] : []),
    ],
    touchedPattern,
  )
  return { branch: run.project.branch, workdir: workdir(), runDir: runDir(paths, run.id), ...rules, envPrefix: envPrefix(config.env) }
}

function workdir(): string {
  return run ? (run.project.worktree ?? run.project.path) : ''
}

function contextLine(): string {
  if (!run || !paths) return ''
  return `wololo: run ${run.id} is active in this session (stage ${run.stage?.id ?? 'none'}, status ${run.status}, mode ${run.mode}). Run files: ${runDir(paths, run.id)}. Skill files: ${root}. Record every transition with ${TOOL_PREFIX}event.`
}

function pauseNotice(): string | null {
  if (!run || run.outcome || !run.pause_requested_at || run.paused) return null
  return `wololo: the person asked to pause run ${run.id}. Start nothing new: let the agents already running report, commit an item that is already verified, note in log.md what comes next, record paused {note: "<where it stopped and what comes next>"} with ${TOOL_PREFIX}event, and end your turn telling them it is safe to close the session.`
}

function orientation(): string {
  if (!run || !paths) return ''
  const dir = runDir(paths, run.id)
  return [
    `wololo: the conversation was compacted while run ${run.id} was active.`,
    `Before continuing, call ${TOOL_PREFIX}get with scope "run", then re-read ${root}/SKILL.md and the stage file for ${run.stage?.id ?? 'the current stage'}.`,
    `The durable record is in ${dir}: spec.md, plan.md, log.md and events.jsonl.`,
  ].join(' ')
}

async function isOwner($: Engine): Promise<boolean> {
  const owner = await read($, ownerAtom)
  return !owner || owner === INSTANCE
}

async function refresh($: Engine, ts?: number) {
  if (!(await isOwner($))) return
  if (!run) {
    timeMark = null
    await update($, viewAtom, () => null)
    return
  }
  const at = ts ?? (await nowSeconds($))
  const status = deriveStatus(run, live)
  const previous = run.status
  run.status = status
  noteTime(at)
  const history = historyCache && pending.length === 0 ? historyCache : undefined
  const view = buildView(
    run,
    status,
    recent,
    at,
    paths ? runDir(paths, run.id) : undefined,
    history,
    worktreeInfo ?? undefined,
    homeDir || undefined,
  )
  await update($, viewAtom, () => view)
  $.ui.status(config.view.statusline ? view.statusLine : undefined)
  if (status !== previous && config.view.notify.includes(status)) {
    void $.ui.notify(`${view.header}${run.waiting ? ` ${run.waiting.question}` : ''}`, { title: 'wololo' }).catch(() => undefined)
  }
  isDirty = true
}

// Only the instance that owns the session records: an older load of the mod in it drops the event, and says so with false.
async function emit($: Engine, type: EventType, data: Record<string, unknown> = {}): Promise<boolean> {
  if (!run) return false
  const ts = await nowSeconds($)
  if (!(await isOwner($)) || !run) return false
  const ev: RunEvent = { v: 1, seq: nextSeq(run), ts, run: run.id, type, data }
  run = apply(run, ev)
  pending.push(ev)
  recent = [...recent, ev].slice(-RECENT)
  await refresh($, ts)
  return true
}

function closeTime(at: number) {
  if (!timeMark) return
  const seconds = at - timeMark.since
  if (seconds > 0) {
    const key = `${timeMark.stage}|${timeMark.kind}`
    const was = pendingTime.get(key) ?? { stage: timeMark.stage, kind: timeMark.kind, seconds: 0 }
    pendingTime.set(key, { ...was, seconds: was.seconds + seconds })
  }
  timeMark = { ...timeMark, since: at }
}

function noteTime(at: number) {
  const kind = run && !run.outcome ? timeKind(run.status) : null
  const stage = run?.stage?.id ?? null
  if (timeMark && timeMark.kind === kind && timeMark.stage === stage) return
  closeTime(at)
  timeMark = kind && stage ? { stage, kind, since: at } : null
}

async function costDelta($: Engine): Promise<number> {
  const usd = (await $.session.usage().catch(() => undefined))?.cost?.usd
  if (typeof usd !== 'number') return 0
  const was = lastUsd
  lastUsd = usd
  if (was === null) return 0
  return usd >= was ? usd - was : usd
}

async function noteUsage($: Engine, agentId: string | undefined, usage: TurnUsage | null) {
  if (!run || run.outcome) return
  const usd = await costDelta($)
  if (!run.stage || run.paused || !usage) return
  const role = agentId === undefined ? 'main' : (run.agents.find(a => a.id === agentId)?.role ?? 'other')
  const key = `${run.stage.id}|${role}`
  const was = pendingUsage.get(key) ?? { stage: run.stage.id, role, input: 0, output: 0, cache_read: 0, cache_write: 0, usd: 0 }
  pendingUsage.set(key, {
    ...was,
    input: was.input + usage.input_tokens,
    output: was.output + usage.output_tokens,
    cache_read: was.cache_read + usage.cache_read_input_tokens,
    cache_write: was.cache_write + usage.cache_creation_input_tokens,
    usd: was.usd + usd,
  })
}

async function flushMeasures($: Engine) {
  closeTime(await nowSeconds($))
  const times = [...pendingTime.values()]
  const usage = [...pendingUsage.values()]
  pendingTime = new Map()
  pendingUsage = new Map()
  for (const entry of times) await emit($, 'time', entry)
  for (const entry of usage) await emit($, 'usage', { ...entry, usd: Math.round(entry.usd * 1e6) / 1e6 })
}

let flushing: Promise<unknown> = Promise.resolve()

// Flushes run one at a time, so two never take the same events or write them out of order; one that fails does not hold back the next.
// Never call flush from inside a flush: it would wait for itself.
function flush($: Engine): Promise<boolean> {
  const done = flushing.then(() => flushOnce($))
  flushing = done.catch(() => undefined)
  return done
}

// True when every event of the run that was pending at the start is in its events.jsonl.
async function flushOnce($: Engine): Promise<boolean> {
  if (!paths || (!run && orphaned.length === 0)) return false
  // What an instance that no longer owns the session holds came from a run another one now writes.
  if (!(await isOwner($))) {
    pending = []
    orphaned = []
    return false
  }
  await flushOrphaned($)
  // The run, its load and its batch are taken together, with no wait between them.
  const held = run
  if (!held) return false
  const id = held.id
  const generation = loadGeneration
  const dir = runDir(paths, id)
  // Older events of this run still wait to be written: newer ones do not go in front of them.
  if (orphaned.some(kept => kept.dir === dir)) return false
  const isSameLoad = () => run?.id === id && loadGeneration === generation
  let isAppended = true
  const batch = pending.filter(ev => ev.run === id)
  if (batch.length > 0) {
    pending = pending.filter(ev => ev.run !== id)
    inFlight += batch.length
    try {
      isAppended = await writeBatch($, held, dir, batch, isSameLoad)
    } finally {
      inFlight -= batch.length
    }
    if (!isAppended) return false
  }
  if (isDirty && run?.id === id) {
    if (!(await isOwner($)) || run?.id !== id) return isAppended
    isDirty = false
    await writeJson($, `${dir}/run.json`, run)
  }
  return isAppended
}

// Appends a batch taken from pending to its run's events, then the history; true once it is written. A batch whose load was replaced
// meanwhile writes that load's run.json too: nothing writes it after.
async function writeBatch($: Engine, held: Run, dir: string, batch: RunEvent[], isSameLoad: () => boolean): Promise<boolean> {
  const id = held.id
  // Nothing of it can have been written: back to pending while the session holds the same load of the run, kept apart with its
  // directory once another load replaced it.
  const putBack = () => {
    if (isSameLoad()) pending = [...batch, ...pending]
    else orphaned.push({ dir, events: batch, of: held })
  }
  let diskLast: number
  try {
    await rotateIfLarge($, dir)
    diskLast = await lastSeqOnDisk($, dir)
  } catch {
    putBack()
    return false
  }
  if (!(await isOwner($))) {
    pending = []
    orphaned = []
    return false
  }
  if (diskLast >= (batch[0]?.seq ?? Infinity)) {
    // What is pending of the same load goes after the batch; a load that replaced it numbers its own events.
    const last = renumber(isSameLoad() ? [...batch, ...pending.filter(ev => ev.run === id)] : batch, diskLast)
    held.last_seq = Math.max(held.last_seq, last)
    if (isSameLoad() && run) {
      run.last_seq = Math.max(run.last_seq, last)
      isDirty = true
    }
  }
  let isAppended: boolean
  try {
    isAppended = await appendLines(
      $,
      `${dir}/events.jsonl`,
      batch.map(ev => JSON.stringify(ev)),
    )
  } catch {
    // Launched, the append may have written the batch: tried again, it could write it twice.
    return false
  }
  if (!isAppended) {
    putBack()
    return false
  }
  await writeHistory($, dir, held)
  if (run?.id !== id) await writeReplaced($, dir, held)
  return true
}

// The run.json of a run this instance no longer holds, as its load left it.
async function writeReplaced($: Engine, dir: string, of: Run) {
  if (!(await isOwner($))) return
  await writeJson($, `${dir}/run.json`, of)
}

// Another load of the mod that wrote after this one took the events, or before it took the session, used their seqs: they move past the
// last one on disk, never down. Answers the last seq given.
function renumber(events: readonly RunEvent[], diskLast: number): number {
  let seq = Math.max(events[0]?.seq ?? 0, diskLast + 1)
  for (const ev of events) ev.seq = seq++
  return seq - 1
}

// Writes the batches kept from a replaced load, each to its own run's file and numbered against it; one that cannot be written yet stays.
async function flushOrphaned($: Engine) {
  const waiting = orphaned
  orphaned = []
  // A batch that cannot be written yet holds back the later ones of its run, never another run's.
  const blocked = new Set<string>()
  for (const kept of waiting) {
    const { dir, events, of } = kept
    const keep = () => {
      orphaned.push(kept)
      blocked.add(dir)
    }
    if (blocked.has(dir)) {
      keep()
      continue
    }
    let diskLast: number
    try {
      diskLast = await lastSeqOnDisk($, dir)
    } catch {
      keep()
      continue
    }
    if (!(await isOwner($))) {
      orphaned = []
      return
    }
    if (diskLast >= (events[0]?.seq ?? Infinity)) of.last_seq = Math.max(of.last_seq, renumber(events, diskLast))
    try {
      if (
        !(await appendLines(
          $,
          `${dir}/events.jsonl`,
          events.map(ev => JSON.stringify(ev)),
        ))
      ) {
        keep()
        continue
      }
    } catch {
      // Launched, the append may have written them: tried again, it could write them twice.
      continue
    }
    await writeHistory($, dir, of)
    if (run?.id !== of.id) await writeReplaced($, dir, of)
  }
}

async function writeHistory($: Engine, dir: string, of: Run) {
  const entries = timeline(await readEvents($, dir), of.lang)
  if (run?.id === of.id) historyCache = entries
  if (!(await isOwner($))) return
  await writeAtomic($, `${dir}/history.md`, historyMarkdown(`wololo · ${of.title}`, entries))
}

async function reviveRun($: Engine, id: string): Promise<Run | undefined> {
  if (!paths) return undefined
  const snapshot = await loadRun($, paths, id)
  const events = await readEvents($, runDir(paths, id))
  if (events.length === 0) return snapshot
  const rebuilt = rebuild(id, events)
  if (!snapshot) return rebuilt
  return {
    ...rebuilt,
    status: snapshot.status,
    last_user_at: snapshot.last_user_at,
    owner: { ...rebuilt.owner, heartbeat_at: Math.max(rebuilt.owner.heartbeat_at, snapshot.owner.heartbeat_at) },
  }
}

function configOpened(answer: string): string {
  if (answer.startsWith('ERROR')) return answer
  const es = (run?.lang ?? config.languages.chat) === 'es'
  return es ? 'wololo: la config está abierta en el panel. Esc la cierra.' : 'wololo: the config is open in the pane. Esc closes it.'
}

function statusStamp(ts: number, lang: string): string {
  const date = new Date(ts * 1000)
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
  return lang === 'es' ? `estado a las ${time}` : `status at ${time}`
}

async function readObject($: Engine, path: string): Promise<Record<string, unknown>> {
  const parsed = parseJson(await readText($, path))
  const value = parsed.value
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

// A /wololo that will run init (a run in a project without its config, or init itself) opens the init pane at once, while the
// session detects the project: opened for the person's command it is drawn at any width, which review_config, opened from a tool
// call, is not below 144 columns. review_config then fills the pane already open. A full run's init asks nothing, so nothing opens.
const NOT_A_RUN = /^(help|status|history|pause|resume|panel|config|cancel)\b/
async function openInitEarly($: Engine, args: string) {
  if (!paths || args === '' || NOT_A_RUN.test(args)) return
  const info = await projectInfo($, await $.session.cwd())
  if (!info) return
  const loaded = await loadConfig($, info.key)
  const isInit = /^init\b/.test(args)
  if (loaded.projectExists && !isInit) return
  const full = /(^|\s)--full\b/.test(args) || (loaded.config.autonomy === 'full' && !/(^|\s)--(checkpoints|guided)\b/.test(args))
  if (full && !isInit) return
  const projectPath = projectConfigPath(paths, info.key)
  await update($, dialogAtom, () => ({
    mode: 'review' as const,
    target: 'project' as const,
    section: 0,
    projectKey: info.key,
    paths: { project: projectPath, global: paths?.globalConfig ?? '' },
    files: { project: {}, global: {} },
    dirty: false,
    message: '',
    step: 'detect' as const,
    chosen: [],
    cursor: 0,
  }))
  await $.ui.open({ id: CONFIG_PANE, title: 'wololo · init', holdToasts: true, rows: 32 }).catch(() => undefined)
}

function initKey(question: InitQuestion, effective: unknown): string {
  return `init-${question.id}-${question.choices[chosenIndex(question, effective)]?.id ?? ''}`
}

// Puts the keyboard on the init question now asked and scrolls it into view: a pane shorter than the wizard scrolls, and its arrows
// scroll it: the ui.scroll hook turns them into moves between the options.
async function revealInit($: Engine, key: string, active = true) {
  await $.ui.focus({ requestId: CONFIG_PANE, key }).catch(() => undefined)
  await $.ui.scroll({ to: { key: active ? 'init-active' : key }, in: CONFIG_PANE }).catch(() => undefined)
}

// What the arrows walk on the config screen now shown, and where the focus starts: the options of the init question asked, the ones
// that end the questions, the sections to pick, or every field of a section screen (an Input too) and its buttons.
type Stop = { key: string; show: string }

// Each field's controls, and the box that holds its label, which a move scrolls into view whole.
function fieldStops(fields: readonly Field[]): Stop[] {
  return fields.flatMap(field =>
    (field.kind === 'radio' ? field.options.map(option => `${field.path}=${option.value}`) : [field.path]).map(key => ({
      key,
      show: `field-${field.path}`,
    })),
  )
}

const own = (keys: string[], show?: string): Stop[] => keys.map(key => ({ key, show: show ?? key }))

// Puts the keyboard on the first field of a section screen, which draws no autoFocus of its own, with the screen at its top so its
// title shows.
async function revealField($: Engine, section: (typeof SECTIONS)[number] | undefined) {
  const first = section ? fieldStops(section.fields)[0] : undefined
  if (!first) return
  await $.ui.focus({ requestId: CONFIG_PANE, key: first.key }).catch(() => undefined)
  await $.ui.scroll({ to: 'start', in: CONFIG_PANE }).catch(() => undefined)
}

function arrowStops(dialog: ConfigDialog): { stops: Stop[]; start: number; top?: true } | null {
  if (dialog.mode === 'config') {
    const section = SECTIONS[dialog.section] ?? SECTIONS[0]
    return { stops: [...fieldStops(section?.fields ?? []), ...own(['target-project', 'target-global', 'save'])], start: 0, top: true }
  }
  if (dialog.step === 'section') {
    const section = SECTIONS.filter(item => dialog.chosen.includes(item.id))[dialog.cursor]
    return { stops: [...fieldStops(section?.fields ?? []), ...own(['next', 'back'])], start: 0, top: true }
  }
  if (dialog.step === 'choose') return { stops: own([...SECTIONS.map(section => `choose-${section.id}`), 'continue', 'back']), start: 0 }
  if (dialog.step !== 'ask') return null
  const effective = effectiveOf(dialog)
  const question = initQuestions(effective, dialog.proposed)[dialog.cursor]
  if (!question) return { stops: own(['save-as-is', 'review', 'cancel'], 'init-active'), start: 0 }
  return {
    stops: own(
      question.choices.map(choice => `init-${question.id}-${choice.id}`),
      'init-active',
    ),
    start: chosenIndex(question, effective),
  }
}

async function openConfig($: Engine, mode: 'config' | 'review', proposal?: Record<string, unknown>): Promise<string> {
  if (!paths) return fail('wololo is not ready yet.')
  const info = await projectInfo($, await $.session.cwd())
  if (!info) return fail('This folder is not inside a git repository.')
  const projectPath = projectConfigPath(paths, info.key)
  const dialog: ConfigDialog = {
    mode,
    target: 'project',
    section: 0,
    projectKey: info.key,
    paths: { project: projectPath, global: paths.globalConfig },
    files: { project: proposal ?? (await readObject($, projectPath)), global: await readObject($, paths.globalConfig) },
    dirty: mode === 'review',
    message: '',
    step: 'ask',
    chosen: [],
    cursor: 0,
    ...(mode === 'review' && proposal ? { proposed: proposal } : {}),
  }
  await update($, dialogAtom, () => dialog)
  const opened = await $.ui
    .open({
      id: CONFIG_PANE,
      title: mode === 'review' ? 'wololo · init' : 'wololo · config',
      focus: true,
      closeOnEscape: true,
      holdToasts: true,
      rows: 32,
    })
    .catch((error: unknown) => ({ isPlaced: false as const, reason: error instanceof Error ? error.message : String(error) }))
  if (!opened.isPlaced) {
    // An undrawn pane would leave the person waiting on a dialog they cannot see.
    await $.ui.close({ id: CONFIG_PANE }).catch(() => undefined)
    await update($, dialogAtom, () => null)
    return fail(`The config pane could not be shown (${opened.reason}). Show the config in the chat instead.`)
  }
  if (mode === 'review') {
    const first = initQuestions(effectiveOf(dialog), dialog.proposed)[0]
    if (first) void revealInit($, initKey(first, effectiveOf(dialog)))
  }
  return ok({ opened: true, project_key: info.key, project_path: projectPath })
}

function effectiveOf(dialog: ConfigDialog): unknown {
  return merge(merge(DEFAULT_CONFIG, dialog.files.global), dialog.files.project)
}

async function setField($: Engine, field: Field, value: unknown) {
  await update($, dialogAtom, (dialog): ConfigDialog | null => {
    if (!dialog) return dialog
    const files = { ...dialog.files, [dialog.target]: setAt(dialog.files[dialog.target], field.path, value) }
    return { ...dialog, files, dirty: true, message: '' }
  })
}

async function saveConfig($: Engine, lang: string): Promise<boolean> {
  const dialog = await read($, dialogAtom)
  if (!dialog) return false
  const content = dialog.files[dialog.target]
  const errors = validate(content)
  if (errors.length > 0) {
    await update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, message: errors.slice(0, 3).join(' · ') } : d))
    return false
  }
  await writeJson($, dialog.paths[dialog.target], content)
  if (run) config = await runConfig($, run.project.key)
  await update($, dialogAtom, (d): ConfigDialog | null =>
    d ? { ...d, dirty: false, message: lang === 'es' ? `Guardado en ${d.paths[d.target]}` : `Saved to ${d.paths[d.target]}` } : d,
  )
  return true
}

async function finishReview($: Engine, saved: boolean) {
  const dialog = await read($, dialogAtom)
  await $.ui.close({ id: CONFIG_PANE }).catch(() => undefined)
  await update($, dialogAtom, () => null)
  if (run && !run.outcome) {
    live.question = null
    await emit($, 'question.answered', {
      pairs: [{ header: 'init', question: 'config', answer: saved ? 'saved' : 'cancelled' }],
      response: null,
    })
  }
  const text = saved
    ? `wololo: the person reviewed and saved the project config at ${dialog?.paths.project ?? 'its path'}. Continue.`
    : 'wololo: the person cancelled the config review; nothing was written. Ask them how to go on.'
  void $.prompt.submit({ text }).catch(() => undefined)
}

type Els = ElementTable<'terminal'>

// The pane's left column, wide enough for its longest label and two cells of air; below PANE_NARROW the labels go above instead.
const PANE_GUTTER = 11
const PANE_NARROW = 70

// The pane's and the card's grey is the theme's readable one: subtle is near the background on a dark theme, kept for rules and the bar's rest.
function paneColor(tone: string): string {
  return tone === 'subtle' ? 'inactive' : paint(tone)
}

function paneLine(els: Els, line: Line | Array<Line[number] & { inverse?: boolean; href?: string }>, isTable: boolean) {
  const { Text } = els
  const only = line.length === 1 ? line[0] : undefined
  if (only && !isTable)
    return (
      <Text color={paneColor(only.tone ?? 'text')} bold={only.bold} wrap="wrap">
        {only.text || ' '}
      </Text>
    )
  return (
    <Text wrap="truncate-end">
      {line.map(part =>
        'href' in part && part.href ? (
          <els.Link href={part.href}>
            <Text color={paneColor(part.tone ?? 'text')}>{part.text}</Text>
          </els.Link>
        ) : (
          <Text color={paneColor(part.tone ?? 'text')} bold={part.bold} inverse={'inverse' in part ? part.inverse : undefined}>
            {part.text}
          </Text>
        ),
      )}
    </Text>
  )
}

// One section of the pane: its head lines (a table's column names) over the label row, then the label beside its lines.
function paneBlock(
  els: Els,
  columns: number,
  block: Block | (Omit<Block, 'lines'> & { lines: Array<Array<Line[number] & { inverse?: boolean; href?: string }>> }),
) {
  const { Box, Text } = els
  const isTable = block.table === true
  if (columns < PANE_NARROW) {
    return (
      <Box flexDirection="column" marginTop={block.gap ? 1 : 0}>
        <Text color="inactive">{block.label}</Text>
        <Box flexDirection="column" paddingLeft={2}>
          {[...(block.head ?? []), ...block.lines].map(line => paneLine(els, line, isTable))}
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" marginTop={block.gap ? 1 : 0}>
      {(block.head ?? []).map(line => (
        <Box flexDirection="row" paddingLeft={PANE_GUTTER}>
          {paneLine(els, line, isTable)}
        </Box>
      ))}
      <Box flexDirection="row">
        <Box width={PANE_GUTTER} flexShrink={0}>
          <Text color="inactive">{block.label}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {block.lines.map(line => paneLine(els, line, isTable))}
        </Box>
      </Box>
    </Box>
  )
}

function fieldRows(els: Els, $: Engine, fields: readonly Field[], effective: unknown, lang: 'es' | 'en') {
  const { Box, Button, Input, Text } = els
  return fields.map(field => {
    const current = fieldValue(field, effective)
    if (field.kind === 'radio') {
      return (
        <Box key={`field-${field.path}`} flexDirection="column" marginTop={1}>
          <Text bold>{field.label[lang]}</Text>
          {field.options.map(option => (
            <Box flexDirection="row" columnGap={2}>
              <Button
                key={`${field.path}=${option.value}`}
                plain
                dimColor={current !== option.value}
                label={`${current === option.value ? '●' : '○'} ${option.label[lang]}`}
                onPress={() => setField($, field, option.value)}
              />
              {option.help && <Text color="subtle">{option.help[lang]}</Text>}
            </Box>
          ))}
        </Box>
      )
    }
    if (field.kind === 'check') {
      const isOn = current === 'true'
      return (
        <Box key={`field-${field.path}`} flexDirection="row" columnGap={2} marginTop={1}>
          <Button
            key={field.path}
            plain
            dimColor={!isOn}
            label={`${isOn ? '☑' : '☐'} ${field.label[lang]}`}
            onPress={() => setField($, field, !isOn)}
          />
          {field.help && <Text color="subtle">{field.help[lang]}</Text>}
        </Box>
      )
    }
    return (
      <Box key={`field-${field.path}`} flexDirection="column" marginTop={1}>
        <Text bold>{field.label[lang]}</Text>
        <Input
          key={field.path}
          value={current}
          rows={field.kind === 'list' ? Math.min(8, Math.max(3, current.split('\n').length + 1)) : 1}
          placeholder={field.help?.[lang] ?? ''}
          onSubmit={async text => {
            const parsed = parseInput(field, text)
            if (parsed.error) await update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, message: parsed.error ?? '' } : d))
            else await setField($, field, parsed.value)
          }}
        />
        {field.help && <Text color="subtle">{field.help[lang]}</Text>}
      </Box>
    )
  })
}

async function pauseRun($: Engine): Promise<{ text: string }> {
  const es = (run?.lang ?? config.languages.chat) === 'es'
  if (!run || run.outcome) return { text: es ? 'wololo: no hay un run activo en esta sesión.' : 'wololo: no active run in this session.' }
  if (!(await isOwner($))) {
    return {
      text: es
        ? `wololo: otra instancia de wololo es la dueña de este run en esta sesión. Retomalo acá con /wololo resume ${run.id}, o recargá la sesión.`
        : `wololo: another wololo instance owns this run in this session. Take it back here with /wololo resume ${run.id}, or reload the session.`,
    }
  }
  if (run.paused)
    return {
      text: es
        ? 'wololo: el run ya está pausado. /wololo resume lo retoma.'
        : 'wololo: the run is already paused. /wololo resume picks it up.',
    }
  if (!run.pause_requested_at) await emit($, 'pause.requested', { by: 'person' })
  if (run.status === 'paused') {
    await emit($, 'paused', { note: es ? 'pausado entre pasos, sin nada corriendo' : 'paused between steps, nothing running' })
    await flush($)
    return {
      text: es
        ? 'wololo: run pausado. Podés cerrar la sesión; /wololo resume lo retoma.'
        : 'wololo: run paused. You can close the session; /wololo resume picks it up.',
    }
  }
  await flush($)
  return {
    text: es
      ? 'wololo: pausa pedida. El run termina el paso en curso y se pausa; la tarjeta pasa a ⏸ PAUSADO y te aviso cuando sea seguro cerrar.'
      : 'wololo: pause requested. The run finishes the current step and pauses; the card turns ⏸ PAUSED and you get a notice when it is safe to close.',
  }
}

async function statusOutput($: Engine, args: string): Promise<{ text: string }> {
  if (!paths) return { text: 'wololo is not ready yet.' }
  await flush($)
  const ts = await nowSeconds($)
  const isAll = /\ball\b/.test(args)
  const listed = (await listRuns($, paths))
    .map(r => ({ run: r, status: effectiveStatus(r, ts) }))
    .filter(x => isAll || !isTerminal(x.status))
  const runs = []
  for (const item of listed) {
    const entries = timeline(await readEvents($, runDir(paths, item.run.id)), item.run.lang).filter(
      entry => entry.isMajor && entry.icon !== '→',
    )
    runs.push({ ...item, last: entries[entries.length - 1] })
  }
  const lang = run?.lang ?? config.languages.chat
  const stamp = statusStamp(ts, lang)
  const cwd = await $.session.cwd()
  const mirrored = await mirrorRuns($, cwd)
  const project = (await projectInfo($, cwd))?.key.split('__').slice(-1)[0] ?? ''
  statusRenders.set(stamp, [...statusCards(runs, ts), ...mirrorCards(mirrored, project, lang)])
  const lines = mirrored.map(
    m => `runner ${m.issue ? `#${m.issue}` : m.id} · ${m.state} · ${m.waiting_on}${m.exit === 2 && m.unblock ? ` · ${m.unblock}` : ''}`,
  )
  return { text: [statusTable(runs, ts), ...(lines.length > 0 ? ['', ...lines] : []), '', stamp].join('\n') }
}

async function keepAwake($: Engine) {
  await $.process
    .run(['sh', '-c', `command -v caffeinate >/dev/null && (caffeinate -i -t ${AWAKE_LEASE_SECONDS} >/dev/null 2>&1 &)`], {
      timeoutMs: 5_000,
    })
    .catch(() => undefined)
}

// The runs config.mirror points at that have not ended, each with where it stands; none when the config names no command or it fails.
async function mirrorRuns($: Engine, cwd: string): Promise<MirrorRun[]> {
  if (!config.mirror.list) return []
  const answer = async (cmd: string) => {
    const ran = await $.process.run(['sh', '-c', withEnv(cmd, envPrefix(config.env))], { cwd, timeoutMs: 20_000 }).catch(() => undefined)
    const parsed = ran ? parseJson(ran.stdout.trim().split('\n').pop() ?? '').value : undefined
    return ran && isObject(parsed) ? { exit: ran.exitCode, json: parsed as Record<string, unknown> } : null
  }
  const listed = await answer(config.mirror.list)
  const data = listed && isObject(listed.json.data) ? listed.json.data : {}
  const rows = Array.isArray(data.runs) ? data.runs.filter(isObject) : []
  const open = rows.filter(
    row => !['merged', 'staged', 'already_satisfied', 'cancelled', 'superseded', 'accepted'].includes(String(row.state)),
  )
  const mirrored: MirrorRun[] = []
  for (const row of open.slice(0, 8)) {
    const id = String(row.id)
    const one = config.mirror.run ? await answer(expand(config.mirror.run, { run: id })) : null
    const json = one?.json ?? {}
    mirrored.push({
      id,
      issue: row.issue === undefined || row.issue === null ? '' : String(row.issue),
      state: String(json.state ?? row.state),
      waiting_on: String(json.waiting_on ?? row.waiting_on ?? ''),
      unblock: typeof json.unblock === 'string' ? json.unblock : null,
      exit: one?.exit ?? 0,
    })
  }
  return mirrored
}

async function writePointer($: Engine) {
  if (!run || !paths || !sessionId) return
  if (!(await isOwner($))) return
  await writeJson($, `${paths.sessions}/${sessionId}.json`, {
    session_id: sessionId,
    run_id: run.id,
    heartbeat_at: run.owner.heartbeat_at,
    cwd: run.owner.cwd,
  })
}

async function reconcileAgents($: Engine, ts: number) {
  if (!run) return
  const open = run.agents.filter(a => a.finished_at === null)
  if (open.length === 0) return
  const listed = await $.agent.list().catch(() => undefined)
  if (!listed) return
  for (const agent of open) {
    const seen = listed.find(x => x.id === agent.id)
    const isGone = !seen && ts - agent.started_at > AGENT_GRACE_SECONDS
    if (isGone || (seen && FINISHED.test(seen.status))) {
      await emit($, 'agent.finished', { id: agent.id, role: agent.role, status: seen?.status ?? 'completed' })
    }
  }
}

async function listening($: Engine, port: number): Promise<boolean | null> {
  const ran = await $.process.run(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeoutMs: 5_000 }).catch(() => undefined)
  if (!ran) return null
  return ran.exitCode === 0 && ran.stdout.trim().length > 0
}

// The branch the run's worktree is on. When the run's branch was renamed (in the session or outside it), records the new
// name, so that the push, the PR and the card follow it.
async function syncBranch($: Engine): Promise<string | null> {
  if (!run || run.outcome || !run.project.worktree) return null
  const dir = run.project.worktree
  const current = await git($, dir, ['branch', '--show-current'])
  const branch = run.project.branch
  if (!current || !branch || current === branch) return current || null
  const exists = (await git($, dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) !== null
  const to = renamedBranch(branch, current, exists, run.project.base ?? config.pr.base)
  if (to) await emit($, 'branch.renamed', { from: branch, to })
  return current
}

async function inspectWorktree($: Engine) {
  if (!run || run.outcome) {
    worktreeInfo = null
    return
  }
  const dir = run.project.worktree ?? run.project.path
  if (!dir) return
  await syncBranch($)
  const base = run.project.base ?? config.pr.base
  const upstream = base.startsWith('origin/') ? base : `origin/${base}`
  const [head, counts, status] = await Promise.all([
    git($, dir, ['log', '-1', '--format=%h%x00%s']),
    git($, dir, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]),
    git($, dir, ['status', '--porcelain']),
  ])
  const [sha, subject] = head ? head.split('\u0000') : [null, null]
  const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [NaN, NaN]
  const started = ports(config, run.slot).flatMap(p => (p.port === null ? [] : [{ name: p.name, port: p.port }]))
  worktreeInfo = {
    head: sha ?? null,
    subject: subject ?? null,
    ahead: Number.isFinite(ahead) ? (ahead as number) : null,
    behind: Number.isFinite(behind) ? (behind as number) : null,
    dirty: status === null ? null : status.split('\n').filter(Boolean).length,
    ports: await Promise.all(started.map(async p => ({ ...p, listening: await listening($, p.port) }))),
  }
}

async function heartbeat($: Engine) {
  if (!run || !paths || run.outcome) return
  const ts = await nowSeconds($)
  run.owner.heartbeat_at = ts
  config = await runConfig($, run.project.key)
  const id = run.id
  const isOnDisk = pending.length === 0 && inFlight === 0 && !orphaned.some(kept => kept.of.id === id)
  if (run.items.total > 0 && (run.items.list ?? []).length < run.items.total && isOnDisk) {
    const before = run
    const revived = await reviveRun($, id)
    // An event recorded while the run was read is not in what was read: the run in memory stays.
    if (revived && run === before && revived.last_seq >= before.last_seq) {
      run = { ...revived, owner: before.owner, status: before.status, last_user_at: before.last_user_at }
    }
  }
  if (!run) return
  await reconcileAgents($, ts)
  await flushMeasures($)
  await inspectWorktree($)
  if (!(await isOwner($))) return
  await writeJson($, `${runDir(paths, run.id)}/owner.json`, run.owner)
  await writePointer($)
  isDirty = true
}

async function followSession($: Engine) {
  const id = await $.session.id()
  if (!id || id === sessionId) return
  sessionId = id
  if (run && !run.outcome) {
    await emit($, 'owner.changed', { session_id: id, cwd: await $.session.cwd() })
    await writePointer($)
  }
}

function ok(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function fail(message: string): string {
  return `ERROR: ${message}`
}

type Held = { run: Run | undefined; historyCache: Entry[] | undefined; recent: RunEvent[]; pending: RunEvent[]; live: Live; config: Config }

// Puts back what a start or a resume replaced when its first event was dropped.
function restore(held: Held) {
  loadGeneration += 1
  run = held.run
  historyCache = held.historyCache
  recent = held.recent
  pending = held.pending
  live = held.live
  config = held.config
}

function notOwner(id?: string): string {
  return fail(
    `Another wololo instance owns this run in this session. Take it back here with /wololo resume ${id ?? '<run>'}, or reload the session.`,
  )
}

async function freeSlot($: Engine, ts: number): Promise<number> {
  if (!paths) return 1
  const taken = new Set(
    (await listRuns($, paths))
      .filter(r => {
        const status = effectiveStatus(r, ts)
        return !isTerminal(status) && status !== 'orphaned'
      })
      .map(r => r.slot),
  )
  let slot = 1
  while (taken.has(slot)) slot += 1
  return slot
}

async function excludeInsideRepo($: Engine, mainPath: string, worktree: string) {
  if (!worktree.startsWith(`${mainPath}/`)) return
  const parent = worktree.slice(mainPath.length).replace(/\/[^/]+$/, '/')
  const ignored = await git($, mainPath, ['check-ignore', '-q', `${worktree}/x`])
  if (ignored !== null) return
  const exclude = `${mainPath}/.git/info/exclude`
  const current = (await readText($, exclude)) ?? ''
  if (current.split('\n').includes(parent)) return
  await $.fs.write(exclude, `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}${parent}\n`).catch(() => undefined)
}

async function startRun($: Engine, input: Record<string, unknown>): Promise<string> {
  if (!paths) return fail('wololo is not ready yet.')
  if (run && !run.outcome) return fail(`Run ${run.id} is already active in this session. Finish or cancel it first.`)
  const source = input.source as Source | undefined
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!source || !['github_issue', 'text', 'file'].includes(source.kind) || !title) {
    return fail('start needs source {kind: github_issue|text|file, ref, url?} and a title.')
  }
  const cwd = await $.session.cwd()
  const info = await projectInfo($, cwd)
  if (!info) return fail(`${cwd} is not inside a git repository.`)
  const flags = parseFlags(Array.isArray(input.flags) ? input.flags.map(String) : [])
  if (flags.errors.length > 0) return fail(`${flags.errors.join('; ')}. Launch flags: ${LAUNCH_FLAGS.join(' ')}`)
  const loaded = await loadConfig($, info.key)
  const configBefore = config
  config = withOverrides(loaded.config, flags.overrides)
  const ts = await nowSeconds($)
  const slot = await freeSlot($, ts)
  const ref =
    source.kind === 'github_issue'
      ? source.ref.replace(/^#/, '')
      : source.kind === 'file'
        ? slugify(source.ref.split('/').pop() ?? 'plan', 16)
        : 'txt'
  const id = `${slugify(info.repoName, 24)}-${slugify(ref, 16)}-${hex(6)}`
  const vars = { repo: info.repoName, run: id, ref, slug: slugify(title, 30) }
  const branch = expand(config.branch, vars)
  const worktree = config.isolation === 'worktree' ? normalize(`${info.mainPath}/${expand(config.worktree_dir, vars)}`) : null
  if (worktree) await excludeInsideRepo($, info.mainPath, worktree)
  const mode = ['full', 'checkpoints', 'guided'].includes(String(input.mode)) ? String(input.mode) : (flags.mode ?? config.autonomy)
  const risk = ['low', 'high', 'unknown'].includes(String(input.risk)) ? String(input.risk) : 'unknown'
  const review = input.review === 'pr' || input.review === 'local' ? input.review : (flags.review ?? config.review.approval)

  await costDelta($)
  const before = { run, historyCache, recent, pending, live, config: configBefore }
  loadGeneration += 1
  run = emptyRun(id, ts)
  historyCache = undefined
  recent = []
  pending = []
  live = { isTurnRunning: true, question: null, permission: null }
  const isStarted = await emit($, 'run.started', {
    title,
    source: { kind: source.kind, ref: source.ref, url: source.url ?? null },
    project: { key: info.key, path: info.mainPath, worktree, branch, base: config.pr.base },
    mode,
    review,
    overrides: flags.overrides,
    risk,
    lang: config.languages.chat,
    slot,
    session_id: sessionId,
    cwd,
  })
  if (!isStarted) {
    // Left in place, the run that was never recorded would hold the session against a resume.
    restore(before)
    return notOwner()
  }
  run.last_user_at = ts
  await flush($)
  await writePointer($)
  if (config.view.pane === 'auto') void $.ui.open({ id: PANE, title: `wololo · ${run.id}` }).catch(() => undefined)

  await exposeRunTools($)
  return ok({
    tools: RUN_TOOLS_NOTE,
    run_id: id,
    run_dir: runDir(paths, id),
    header: header(run, run.status, ts),
    mode,
    risk,
    slot,
    ports: ports(config, slot).map(port => ({ ...port, cmd: withEnv(port.cmd, envPrefix(config.env)) })),
    isolation: config.isolation,
    worktree,
    branch,
    base: config.pr.base,
    project_key: info.key,
    project_path: info.mainPath,
    config_paths: { global: paths.globalConfig, project: projectConfigPath(paths, info.key) },
    project_config_exists: loaded.projectExists,
    config_errors: loaded.errors,
    config,
    stages: STAGES.map(s => s.id),
    skill_root: root,
    next: `Read ${root}/stages/01-context.md, then record stage.entered for context.`,
  })
}

// A run whose branch changes a path in config.risk_paths is high risk: it cannot claim less, nor reach the evidence, Aprobar PR or
// the PR, without risk.set high.
async function riskyChange($: Engine, type: string, data: Record<string, unknown>): Promise<string | null> {
  if (!run) return null
  const lowering = type === 'risk.set' && data.risk !== 'high'
  const late =
    type === 'stage.entered' &&
    ['evidence', 'gate_b', 'pr'].includes(String(data.stage)) &&
    stageIndex(data.stage as StageId) > (run.stage?.index ?? -1)
  if (!lowering && !(late && run.risk !== 'high')) return null
  const files = riskyFiles(await changedFiles($, workdir(), run.project.base ?? config.pr.base), config.risk_paths)
  if (files.length === 0) return null
  return `The branch changes ${files.slice(0, 5).join(', ')}${files.length > 5 ? ` and ${files.length - 5} more` : ''}, in config.risk_paths: the run is high risk. Record risk.set {risk: "high", reason}${lowering ? ' instead' : ' before moving on'}.`
}

const LOG_KEEP_BYTES = 1024 * 1024

// A finished run takes its servers down and leaves its logs readable: each server recorded in servers.json that is still running one of the
// project's start commands is stopped, with its process group, and each log past 5 MB keeps its last megabyte.
async function cleanUp($: Engine, dir: string): Promise<{ stopped: string[]; trimmed: string[] }> {
  const stopped: string[] = []
  const recorded = parseJson(await readText($, `${dir}/servers.json`)).value
  const entries = Array.isArray(recorded) ? recorded : isObject(recorded) ? Object.values(recorded) : []
  // A start command as ps shows it: its first two words, without the VAR=value assignments before it.
  const starts = config.commands.start.map(start =>
    start.cmd
      .split(/\s+/)
      .filter(word => !/^\w+=/.test(word))
      .slice(0, 2)
      .join(' '),
  )
  for (const entry of entries) {
    const pid = isObject(entry) ? Number(entry.pid) : NaN
    if (!Number.isInteger(pid) || pid <= 1) continue
    const shown = await $.process.run(['ps', '-o', 'pgid=,command=', '-p', String(pid)], { timeoutMs: 5_000 }).catch(() => undefined)
    const [pgid, ...command] = (shown?.stdout ?? '').trim().split(/\s+/)
    if (!pgid || !starts.some(start => start && command.join(' ').includes(start))) continue
    await $.process.run(['kill', '-TERM', `-${pgid}`], { timeoutMs: 5_000 }).catch(() => undefined)
    stopped.push(`${pid} (${command.join(' ').slice(0, 60)})`)
  }
  const trimmed: string[] = []
  const found = await $.process.run(['find', dir, '-name', '*.log', '-size', '+5M'], { timeoutMs: 10_000 }).catch(() => undefined)
  for (const file of (found?.stdout ?? '').split('\n').filter(Boolean)) {
    const tail = await $.process.run(['tail', '-c', String(LOG_KEEP_BYTES), file], { timeoutMs: 10_000 }).catch(() => undefined)
    if (!tail || tail.exitCode !== 0) continue
    await writeAtomic(
      $,
      file,
      `[wololo kept the last ${LOG_KEEP_BYTES / 1024 / 1024} MB of this log when the run finished]\n${tail.stdout}`,
    )
    trimmed.push(file.slice(dir.length + 1))
  }
  return { stopped, trimmed }
}

// The tree `git add -A && git commit` would make of the work tree now, built in a scratch index so the real one is left alone.
async function worktreeTree($: Engine, worktree: string, dir: string): Promise<string | null> {
  const env = { GIT_INDEX_FILE: `${dir}/verified.index` }
  for (const args of [
    ['read-tree', 'HEAD'],
    ['add', '-A'],
  ]) {
    const ran = await $.process.run(['git', ...args], { cwd: worktree, env, timeoutMs: 30_000 }).catch(() => undefined)
    if (!ran || ran.exitCode !== 0) return null
  }
  const ran = await $.process.run(['git', 'write-tree'], { cwd: worktree, env, timeoutMs: 30_000 }).catch(() => undefined)
  return ran && ran.exitCode === 0 ? ran.stdout.trim() : null
}

// The hashes a gate approves: spec.md and plan.md in the run directory, and the worktree's committed tree.
async function snapshot($: Engine, dir: string, worktree: string | null): Promise<Snapshot> {
  const hash = async (name: string) =>
    (await readText($, `${dir}/${name}`)) === undefined ? null : await git($, dir, ['hash-object', `${dir}/${name}`])
  return {
    spec: await hash('spec.md'),
    plan: await hash('plan.md'),
    tree: worktree ? await git($, worktree, ['rev-parse', 'HEAD^{tree}']) : null,
  }
}

async function recordEvent($: Engine, input: Record<string, unknown>): Promise<string> {
  if (!run || !paths) return fail('No active run in this session. Start one with /wololo, or resume one with /wololo resume <run>.')
  const type = String(input.type ?? '')
  // The tool's input arrives frozen; copy it so the snapshot and tree hashes can be added.
  const data: Record<string, unknown> = isObject(input.data) ? { ...input.data } : {}
  const worktree = run.project.worktree
  if (type === 'base.changed') {
    if (typeof data.to === 'string') data.to = data.to.trim().replace(/^origin\//, '')
    data.from = run.project.base ?? config.pr.base
  }
  if (worktree && type === 'item.verified' && data.result !== 'fail')
    data.worktree_tree = await worktreeTree($, worktree, runDir(paths, run.id))
  if (worktree && type === 'item.committed' && typeof data.sha === 'string')
    data.commit_tree = await git($, worktree, ['rev-parse', `${data.sha}^{tree}`])
  const problem = checkEvent(run, type, data, config.budgets)
  if (problem) return fail(problem)
  if (config.risk_paths.length > 0 && worktree) {
    const risky = await riskyChange($, type, data)
    if (risky) return fail(risky)
  }
  const guarded = ['stage.entered', 'pr.opened'].includes(type) || (type === 'gate.resolved' && (data.outcome ?? 'approved') === 'approved')
  if (guarded) {
    const current = await snapshot($, runDir(paths, run.id), run.project.worktree)
    const changed = changedSinceApproval(run, type, data, current)
    if (changed) return fail(changed)
    if (type === 'gate.resolved') data.snapshot = current
  }
  if (!(await emit($, type as EventType, data))) return notOwner(run.id)
  let cleanup: { stopped: string[]; trimmed: string[] } | null = null
  if (type === 'run.finished') {
    // Once its line is written the run is finished, whoever owns the session after; dropped, the owner still has it running.
    if (!(await flush($)) && !(await isOwner($))) return notOwner(run.id)
    cleanup = await cleanUp($, runDir(paths, run.id))
  }
  // Kept short: the answer stays in the conversation and is read again on every request after it. The card already shows the header,
  // and get still returns it.
  const hint = hintFor(type, data, root)
  return ok({ ok: true, status: run.status, ...(hint ? { hint } : {}), ...(cleanup ? { cleanup } : {}) })
}

async function getState($: Engine, input: Record<string, unknown>): Promise<string> {
  if (!paths) return fail('wololo is not ready yet.')
  const scope = String(input.scope ?? 'run')
  const ts = await nowSeconds($)
  if (scope === 'all') {
    const runs = (await listRuns($, paths)).map(r => ({ run: r, status: effectiveStatus(r, ts) }))
    const limit = typeof input.limit === 'number' ? input.limit : 20
    const shown = runs.filter(x => input.include_finished === true || !isTerminal(x.status)).slice(0, limit)
    return ok({ table: statusTable(shown, ts), data_dir: paths.root, count: shown.length, hidden_finished: runs.length - shown.length })
  }
  if (scope === 'config') {
    const cwd = await $.session.cwd()
    const info = await projectInfo($, cwd)
    if (!info) return fail(`${cwd} is not inside a git repository.`)
    const loaded = await loadConfig($, info.key)
    const flagged = run && !run.outcome && run.project.key === info.key ? run.overrides : undefined
    return ok({
      project_key: info.key,
      project_path: info.mainPath,
      global_config_path: paths.globalConfig,
      project_config_path: projectConfigPath(paths, info.key),
      project_config_exists: loaded.projectExists,
      errors: loaded.errors,
      effective: withOverrides(loaded.config, flagged as Overrides | undefined),
      ...(flagged ? { run_flags: flagged } : {}),
      defaults: DEFAULT_CONFIG,
    })
  }
  if (scope === 'history') {
    const target = typeof input.run_id === 'string' ? await loadRun($, paths, input.run_id) : run
    if (!target) return fail('No run to show: pass run_id, or start or resume one in this session.')
    if (target === run) await flush($)
    const entries = timeline(await readEvents($, runDir(paths, target.id)), target.lang)
    const shown = input.include_minor === true ? entries : entries.filter(entry => entry.isMajor)
    return ok({ run_id: target.id, lines: [...shown].reverse().map(formatEntry), file: `${runDir(paths, target.id)}/history.md` })
  }
  if (!run) return fail('No active run in this session. Use scope "all" to list runs, or /wololo resume <run>.')
  await flush($)
  const dir = runDir(paths, run.id)
  if (scope === 'since_last_seen') {
    const events = await readEvents($, dir)
    return ok({ header: header(run, run.status, ts), since: priorUserAt, lines: sinceLastSeen(run, events, priorUserAt), run_dir: dir })
  }
  return ok({ header: header(run, run.status, ts), run_dir: dir, skill_root: root, config, run })
}

async function resumeRun($: Engine, input: Record<string, unknown>): Promise<string> {
  if (!paths) return fail('wololo is not ready yet.')
  // After a /clear the process goes on under another session id: the run is taken by that one.
  await followSession($)
  const id = String(input.run_id ?? run?.id ?? '')
  // In an instance that no longer owns the session, its run is not what the session runs: another one may be resumed in its place.
  if (run && !run.outcome && run.id !== id && (await isOwner($)))
    return fail(`Run ${run.id} is active in this session; finish or cancel it before resuming another.`)
  // Only reads until the run can be taken: a resume that fails leaves the session's owner as it was.
  const found = await reviveRun($, id)
  if (!found) return fail(`No run ${id} in ${paths.runs}.`)
  const ts = await nowSeconds($)
  const status = effectiveStatus(found, ts)
  if (found.outcome || isTerminal(status)) return fail(`Run ${id} already finished (${found.outcome ?? status}).`)
  const isStale = ts - found.owner.heartbeat_at > ORPHAN_AFTER_SECONDS
  if (found.owner.session_id !== sessionId && !isStale && !released.has(found.owner.session_id)) {
    return fail(`Run ${id} is owned by a live session (heartbeat ${Math.round(ts - found.owner.heartbeat_at)}s ago). Resume it there.`)
  }
  await update($, ownerAtom, () => INSTANCE)
  startTicking($)
  // What this instance still holds of the run goes to disk first, so the rebuild reads it.
  await flush($)
  // Rebuilt again now that this instance owns the session: the one that owned it may have written, even finished the run, meanwhile.
  const target = await reviveRun($, id)
  if (!target) return fail(`No run ${id} in ${paths.runs}.`)
  if (target.outcome) {
    // This instance owns the session now: it holds the run as it ended, so its tick and flush cannot write it back as running.
    const events = await readEvents($, runDir(paths, id))
    loadGeneration += 1
    run = target
    historyCache = undefined
    recent = events.slice(-RECENT)
    pending = []
    await refresh($)
    return fail(`Run ${id} already finished (${target.outcome}).`)
  }
  const dir = runDir(paths, id)
  const events = await readEvents($, dir)
  await costDelta($)
  const before = { run, historyCache, recent, pending, live, config }
  loadGeneration += 1
  run = target
  historyCache = undefined
  recent = events.slice(-RECENT)
  pending = []
  config = await runConfig($, target.project.key)
  live = { isTurnRunning: true, question: null, permission: null }
  if (!(await emit($, 'owner.changed', { session_id: sessionId, cwd: await $.session.cwd() }))) {
    restore(before)
    return notOwner(id)
  }
  if (run.paused || run.pause_requested_at) await emit($, 'resumed', {})
  await flush($)
  await writePointer($)
  await exposeRunTools($)
  return ok({
    tools: RUN_TOOLS_NOTE,
    header: header(run, run.status, ts),
    run_dir: dir,
    skill_root: root,
    worktree: run.project.worktree,
    branch: run.project.branch,
    stage: run.stage?.id ?? null,
    since: sinceLastSeen(run, events, target.last_user_at),
    next: `Read ${root}/stages/resume.md.`,
  })
}

// A value at a dotted path of a JSON answer, or the first group of /regex/ in the output.
function captured(spec: string, answer: Record<string, unknown> | null, output: string): string | null {
  const regex = /^\/(.+)\/$/.exec(spec)
  if (regex?.[1]) return new RegExp(regex[1]).exec(output)?.[1] ?? null
  let value: unknown = answer
  for (const key of spec.split('.')) value = isObject(value) ? value[key] : undefined
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

type Ran = { exitCode: number; stdout: string; stderr: string }

const WAIT_NOTE =
  'The step runs in the background. Run `wait` with Bash and run_in_background (it ends when the step does), end your turn, and when it ends call run_adapter for this point again: it goes on from that step.'
// The most of a background step's output read back: its answer is its last line.
const JOB_OUTPUT_BYTES = 200_000
const JOB_STATUS_SECONDS = 60
let jobStatusAt = 0
let jobStatusText = ''

async function adapterVars($: Engine): Promise<Record<string, string>> {
  if (!run || !paths) return {}
  const head = run.project.worktree ? await git($, run.project.worktree, ['rev-parse', 'HEAD']) : null
  return {
    ...(run.adapter_vars ?? {}),
    issue: run.source.kind === 'github_issue' ? run.source.ref.replace(/^#/, '') : '',
    branch: run.project.branch ?? '',
    base: run.project.base ?? config.pr.base,
    worktree: workdir(),
    run_dir: runDir(paths, run.id),
    sha: head ?? '',
  }
}

// Starts a step that may outlast the ten minutes a command is given, detached so it lives on without the session, writing its output and
// then its exit code next to job. Returns the command that waits for it, or why it could not start.
async function startJob(
  $: Engine,
  point: string,
  step: number,
  cmd: string,
  known: Record<string, string>,
): Promise<{ wait: string } | string> {
  if (!run || !paths) return 'No active run.'
  const job = `${runDir(paths, run.id)}/adapters/${point}-${step}-${hex(6)}`
  const q = (suffix: string) => shellQuote(`${job}${suffix}`)
  await $.fs.write(
    `${job}.sh`,
    [
      `cd ${shellQuote(workdir())} || exit 1`,
      `${cmd} > ${q('.out')} 2> ${q('.err')}`,
      `echo $? > ${q('.code.tmp')}`,
      `mv ${q('.code.tmp')} ${q('.code')}`,
      '',
    ].join('\n'),
  )
  const started = await $.process
    .run(['sh', '-c', `nohup sh ${q('.sh')} </dev/null >/dev/null 2>&1 & echo $!`], { cwd: workdir(), timeoutMs: 10_000 })
    .catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  const pid = Number(started.stdout.trim())
  if (started.exitCode !== 0 || !Number.isInteger(pid) || pid <= 0)
    return `\`${cmd}\` could not start in the background: ${started.stderr.trim() || 'no pid'}`
  await $.fs.write(`${job}.wait`, `while [ ! -f ${q('.code')} ] && kill -0 ${pid} 2>/dev/null; do sleep 15; done\n`)
  const wait = `sh ${q('.wait')}`
  await emit($, 'adapter.started', { point, step, cmd, job, pid, known, wait })
  await emit($, 'doing', { text: `${point}: \`${cmd}\` runs in the background` })
  jobStatusAt = 0
  jobStatusText = ''
  return { wait }
}

// What a background step ended with, null while it still runs. One that died without an exit code ends as a failure.
async function finishedJob($: Engine, job: AdapterJob): Promise<Ran | null> {
  const code = await readText($, `${job.job}.code`)
  if (code === undefined) {
    const alive = await $.process.run(['kill', '-0', String(job.pid)], { timeoutMs: 5_000 }).then(
      r => r.exitCode === 0,
      () => false,
    )
    if (alive) return null
  }
  const stdout = ((await readText($, `${job.job}.out`)) ?? '').slice(-JOB_OUTPUT_BYTES)
  const stderr = ((await readText($, `${job.job}.err`)) ?? '').slice(-JOB_OUTPUT_BYTES)
  if (code === undefined) return { exitCode: 1, stdout, stderr: `${stderr}\n\`${job.cmd}\` stopped before it finished` }
  return { exitCode: Number.parseInt(code.trim(), 10) || 0, stdout, stderr }
}

// While a background step runs, its status command says on the card what the tool is doing, at most once a minute.
async function checkJob($: Engine) {
  const job = run?.adapter_job
  if (!run || run.outcome || !job) return
  const status = config.adapters[job.point as AdapterPoint]?.steps[job.step]?.status
  if (!status) return
  const ts = await nowSeconds($)
  if (ts - jobStatusAt < JOB_STATUS_SECONDS) return
  jobStatusAt = ts
  const vars = await adapterVars($)
  if ([...status.matchAll(/\{(\w+)\}/g)].some(m => !vars[m[1] ?? ''])) return
  const ran = await $.process
    .run(['sh', '-c', withEnv(expand(status, vars), envPrefix(config.env))], { cwd: workdir(), timeoutMs: 60_000 })
    .catch(() => null)
  const answer = ran ? parseJson(ran.stdout.trim().split('\n').pop() ?? '').value : undefined
  if (!isObject(answer)) return
  const text = [answer.state, answer.waiting_on].filter(part => typeof part === 'string' && part).join(' · ')
  if (!text || text === jobStatusText) return
  jobStatusText = text
  await emit($, 'doing', { text: `${job.point}: ${text}` })
}

async function runAdapter($: Engine, input: Record<string, unknown>): Promise<string> {
  if (!run || !paths) return fail('No active run in this session.')
  const point = String(input.point) as AdapterPoint
  const job = run.adapter_job ?? null
  if (job && job.point !== point) {
    return fail(
      `The ${job.point} adapter still runs \`${job.cmd}\` in the background. Wait for it with \`${job.wait}\` (run_in_background), then call run_adapter for ${job.point} again.`,
    )
  }
  const adapter = config.adapters[point]
  if (!adapter) return ok({ ran: false, reason: `config.adapters has nothing for ${point}: the stage does its own work.` })
  // A point that comes back to its background step goes on from it, judging the steps after it by what was known when the point started.
  const resumed = job ? await finishedJob($, job) : null
  if (job && !resumed) return ok({ point, ran: true, running: true, since: job.since, wait: job.wait, next: WAIT_NOTE })
  const known = job ? job.known : { ...(run.adapter_vars ?? {}) }
  const vars = await adapterVars($)
  const prefix = envPrefix(config.env)
  const results: Array<Record<string, unknown>> = []
  for (const [index, step] of adapter.steps.entries()) {
    if (job && index < job.step) continue
    const resuming = job !== null && index === job.step
    if (!resuming) {
      if (step.if_missing && known[step.if_missing]) continue
      if (step.if_present && !known[step.if_present]) continue
      const missing = [...step.cmd.matchAll(/\{(\w+)\}/g)].map(m => m[1] ?? '').filter(name => !vars[name])
      if (missing.length > 0) {
        const reason = `The ${point} adapter needs ${missing.join(', ')} for \`${step.cmd}\`, and the run has none yet.`
        await emit($, 'blocked', { reason })
        return fail(reason)
      }
    }
    const cmd = resuming && job ? job.cmd : withEnv(expand(step.cmd, vars), prefix)
    if (step.background && !resuming) {
      const started = await startJob($, point, index, cmd, known)
      if (typeof started === 'string') {
        await emit($, 'blocked', { reason: `${point}: ${started}` })
        return ok({ point, ran: true, blocked: true, results })
      }
      return ok({ point, ran: true, running: true, results, wait: started.wait, next: WAIT_NOTE })
    }
    const ran: Ran =
      resuming && resumed
        ? resumed
        : await $.process
            .run(['sh', '-c', cmd], { cwd: workdir(), timeoutMs: 600_000 })
            .catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }))
    const output = `${ran.stdout}\n${ran.stderr}`
    const answer = (() => {
      const last = ran.stdout.trim().split('\n').pop() ?? ''
      const parsed = parseJson(last).value
      return isObject(parsed) ? (parsed as Record<string, unknown>) : null
    })()
    const got: Record<string, string> = {}
    for (const [name, spec] of Object.entries(step.capture ?? {})) {
      const value = captured(spec, answer, output)
      if (value !== null) got[name] = value
    }
    Object.assign(vars, got)
    const refused = answer ? answer.ok === false : ran.exitCode !== 0
    const code = typeof answer?.code === 'string' ? answer.code : null
    const message = typeof answer?.message === 'string' ? answer.message : ran.stderr.trim().split('\n').slice(-3).join(' ')
    const state = typeof answer?.state === 'string' ? answer.state : null
    const waiting = typeof answer?.waiting_on === 'string' ? answer.waiting_on : null
    const unblock = typeof answer?.unblock === 'string' ? answer.unblock : null
    await emit($, 'adapter.ran', {
      point,
      cmd,
      ok: !refused,
      exit: ran.exitCode,
      code,
      state,
      message: refused ? message : null,
      captured: got,
    })
    results.push({ cmd, exit: ran.exitCode, ok: !refused, code, state, waiting_on: waiting, unblock, data: answer?.data ?? null })
    if (refused && !(code && step.accept_codes?.includes(code))) {
      // The tool refused: the run stops on its words.
      await emit($, 'blocked', { reason: `${point}: ${message || `\`${cmd}\` failed (exit ${ran.exitCode})`}` })
      return ok({ point, ran: true, blocked: true, results })
    }
    if (!refused && ran.exitCode === 2 && !(state && step.accept_states?.includes(state))) {
      await emit($, 'blocked', { reason: `${point}: waiting on ${waiting ?? 'a person'}${unblock ? ` — ${unblock}` : ''}` })
      return ok({ point, ran: true, blocked: true, results })
    }
    if (!refused && ran.exitCode === 3) await emit($, 'doing', { text: `${point}: ${waiting ?? 'the tool goes on by itself'}` })
  }
  return ok({ point, ran: true, blocked: false, replaces: adapter.replaces === true, results, vars: run.adapter_vars ?? {} })
}

async function externalTurn($: Engine, input: Record<string, unknown>): Promise<string> {
  if (!run || !paths) return fail('No active run in this session.')
  const promptFile = String(input.prompt_file ?? '')
  const outFile = String(input.out_file ?? '')
  const prompt = await readText($, promptFile)
  if (!prompt) return fail(`Cannot read prompt_file ${promptFile}.`)
  if (!outFile) return fail('out_file is required.')
  const command = config.debate.external_cmd
  if (command.length === 0) return fail('debate.external_cmd is empty in the config.')
  const role = String(input.role ?? 'critic')
  const taskId = `external-${hex(6)}`
  const label = `${command[0]} ${role}`
  await emit($, 'task.started', { id: taskId, label, kind: 'external' })
  const ran = await $.process
    .run(command, { cwd: await $.session.cwd(), stdin: prompt, timeoutMs: 600_000 })
    .catch(error => ({ exitCode: 1, stdout: '', stderr: String(error), isStdoutTruncated: false, isStderrTruncated: false }))
  await emit($, 'task.finished', { id: taskId, label, status: ran.exitCode === 0 ? 'completed' : 'failed' })
  const body = ran.stdout.trim()
  const verdict = /VERDICT:\s*([a-z]+)/i.exec(body)?.[1]?.toLowerCase() ?? null
  const frontmatter = [
    '---',
    `role: ${role}`,
    `model: ${command[0]}`,
    `round: ${String(input.round ?? 1)}`,
    `stage: ${String(input.stage ?? run.stage?.id ?? '')}`,
    `verdict: ${verdict ?? 'none'}`,
    '---',
    '',
  ].join('\n')
  await $.fs.write(outFile, `${frontmatter}${body}\n`)
  if (ran.exitCode === 0) {
    await emit($, 'debate.turn', {
      stage: input.stage ?? run.stage?.id,
      role,
      round: input.round ?? 1,
      model: command[0],
      verdict,
      file: outFile,
    })
  }
  return ok({
    exit_code: ran.exitCode,
    verdict,
    out_file: outFile,
    text: body.slice(0, 60_000),
    stderr: ran.exitCode === 0 ? '' : ran.stderr.slice(-2_000),
  })
}

async function togglePane($: Engine, input: Record<string, unknown>): Promise<string> {
  if (input.open === false) {
    await $.ui.close({ id: PANE })
    return ok({ open: false })
  }
  const opened = await $.ui.open({ id: PANE, title: run ? `wololo · ${run.id}` : 'wololo' })
  return ok({ open: true, placed: opened })
}

// The tools only a run uses: deferred until one is active in the session.
const RUN_TOOLS: ReadonlySet<string> = new Set(['event', 'tests', 'publish', 'external_turn', 'run_adapter'])
const RUN_TOOLS_NOTE = `Until the next prompt, the run's own tools load with ToolSearch "select:${[...RUN_TOOLS].map(name => `${TOOL_PREFIX}${name}`).join(',')}".`

async function exposeRunTools($: Engine): Promise<void> {
  for (const tool of TOOLS) if (RUN_TOOLS.has(tool.name)) await $.tool.register({ ...tool, isDeferred: false }).catch(() => undefined)
}

const TOOLS: ReadonlyArray<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [
  {
    name: 'start',
    description:
      'Starts a wololo run in this session: creates its record, allocates a port slot and returns the run directory, the effective config, the branch and worktree to create, and the header. Call once, at the start of /wololo <input>.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['github_issue', 'text', 'file'] },
            ref: { type: 'string', description: 'Issue number (e.g. "4312"), the file path, or a short label for text.' },
            url: { type: 'string' },
          },
          required: ['kind', 'ref'],
        },
        title: { type: 'string', description: 'Short human title of what the run delivers.' },
        mode: { type: 'string', enum: ['full', 'checkpoints', 'guided'], description: 'Overrides the configured autonomy for this run.' },
        review: {
          type: 'string',
          enum: ['local', 'pr'],
          description: 'Overrides config.review.approval: approve the change at Aprobar PR (local) or on the PR once CI is green (pr).',
        },
        flags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'The --flags the person launched the run with, as typed (--base=<branch> with its value). Unknown flags are refused.',
        },
        risk: { type: 'string', enum: ['low', 'high', 'unknown'] },
      },
      required: ['source', 'title'],
    },
  },
  {
    name: 'event',
    description:
      "Records a transition or a fact of the active run so the person can see it (band, pane, status line, dashboards). The run refuses transitions out of order: a skipped stage, a gate resolved without the person's answer. Types: stage.entered {stage, reason?}, stage.completed {stage, note?}, gate.requested {gate}, gate.resolved {gate, outcome: approved|changes|rejected, by: user|auto}, risk.set {risk, reason}, plan.ready {items:[titles]}, item.started {n, title, reversal?}, item.verified {n, result: pass|fail, tree}, item.reviewed {n, findings, verdict}, item.committed {n, sha, title}, debate.turn {stage, role, round, model, verdict, file}, doing {text} (one plain sentence on what is being done and why, whenever something long starts), assumption {text, stage}, decision {text, by}, corrected {text}, blocked {reason}, unblocked {}, ci.updated {state: pending|passing|failing}, base.changed {to, reason?} (when the branch moves onto another base, e.g. the base merged and the branch was rebased onto main), pr.opened {url, number, draft}, pr.ready {}, screenshot.saved {file, caption}, run.finished {outcome: done|failed|cancelled, summary}.",
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        data: { type: 'object' },
      },
      required: ['type'],
    },
  },
  {
    name: 'get',
    description:
      'Reads wololo state. scope "run": the active run, its header and run_dir. "since_last_seen": what happened since the person\'s previous message. "all": every run across projects as a table (include_finished to show finished ones). "config": the effective config for the current repository and the paths of its config files.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['run', 'since_last_seen', 'all', 'config', 'history'] },
        run_id: { type: 'string', description: 'For scope "history": another run than this session\'s.' },
        include_minor: { type: 'boolean', description: 'For scope "history": also agents, tasks and stage moves.' },
        include_finished: { type: 'boolean' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'resume',
    description:
      "Takes over a run whose session closed (or this session's own run after a restart) and returns what happened since the person last looked.",
    inputSchema: { type: 'object', properties: { run_id: { type: 'string', description: "Left out: this session's run." } } },
  },
  {
    name: 'run_adapter',
    description:
      "Runs the steps config.adapters gives a point of the run (definition, gate_a, plan, item, pr, poll), in the work tree, and reads each answer as JSON (ok, state, waiting_on, unblock, code, message, data). A refusal blocks the run with the tool's message; a wait on a person blocks it with what to do; a wait on the machine shows as what the run is doing. Call it at each point the stage files name, when that point has an adapter.",
    inputSchema: { type: 'object', properties: { point: { type: 'string', enum: [...ADAPTER_POINTS] } }, required: ['point'] },
  },
  {
    name: 'external_turn',
    description:
      'Runs the configured external model (debate.external_cmd, e.g. codex) on a prompt file and writes its answer to out_file as one debate turn of the active run. Use for the critic or reviewer when the config asks for an external model.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['critic', 'reviewer'] },
        stage: { type: 'string' },
        round: { type: 'number' },
        prompt_file: { type: 'string' },
        out_file: { type: 'string' },
      },
      required: ['role', 'prompt_file', 'out_file'],
    },
  },
  {
    name: 'panel',
    description: 'Opens (or closes, with open: false) the wololo pane beside the chat.',
    inputSchema: { type: 'object', properties: { open: { type: 'boolean' } } },
  },
  {
    name: 'review_config',
    description:
      "Opens the config review for the person, as /wololo init asks: what was detected, the first-time questions (who delivers, when it proposes adapters; autonomy, isolation, approval, PR, suite, spec in the issue), then save or adjust more by section. Pass the proposed project config (only the keys that differ from the defaults). It returns at once; end your turn: the person's save or cancel arrives as a message.",
    inputSchema: { type: 'object', properties: { proposal: { type: 'object' } }, required: ['proposal'] },
  },
  {
    name: 'tests',
    description:
      'Says which tests to run now, from the config\'s tests block. scope "touched": the test files this run created or changed (committed or not) against its base, grouped into ready-to-run commands, plus the ones no configured command matches. scope "suite": the full-suite and e2e commands, and whether they run locally or are left to CI. Run every command it returns exactly as written, from the work tree.',
    inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['touched', 'suite'] } }, required: ['scope'] },
  },
  {
    name: 'publish',
    description:
      'The only way a run writes to GitHub. Sends body_file as an issue body, an issue comment, a new issue or a new pull request. When the text is longer than GitHub accepts, it sends nothing and asks for summary_file: then it publishes the summary and the full text stays in body_file. For issue writes it does nothing when the config says spec.to_github is false, and says so.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['issue_body', 'issue_comment', 'issue_create', 'pr_create'] },
        body_file: { type: 'string' },
        summary_file: { type: 'string', description: 'A short version, for when body_file does not fit.' },
        number: { type: 'number', description: 'Issue number, for issue_body and issue_comment.' },
        title: { type: 'string', description: 'For issue_create and pr_create.' },
        base: { type: 'string' },
        head: { type: 'string' },
        draft: { type: 'boolean' },
      },
      required: ['kind', 'body_file'],
    },
  },
]

async function publish($: Engine, input: Record<string, unknown>): Promise<string> {
  if (!run) return fail('No active run in this session.')
  const kind = String(input.kind) as PublishKind
  if (kind !== 'pr_create' && !config.spec.to_github) {
    return ok({ published: false, reason: 'spec.to_github is false: the text stays in its file only.', file: input.body_file })
  }
  const bodyFile = String(input.body_file ?? '')
  const body = await readText($, bodyFile)
  if (body === undefined) return fail(`Cannot read body_file ${bodyFile}.`)
  const summaryFile = typeof input.summary_file === 'string' ? input.summary_file : null
  const summary = summaryFile ? await readText($, summaryFile) : undefined
  const decision = decide(body.length, summary === undefined ? null : summary.length)
  if (decision.send === 'nothing') return ok({ published: false, reason: decision.reason, length: body.length, limit: GITHUB_BODY_LIMIT })
  const file = decision.send === 'summary' && summaryFile ? summaryFile : bodyFile
  const args = ghArgs(
    {
      kind,
      number: typeof input.number === 'number' ? input.number : undefined,
      title: typeof input.title === 'string' ? input.title : undefined,
      base: typeof input.base === 'string' ? input.base : undefined,
      head: typeof input.head === 'string' ? input.head : undefined,
      draft: input.draft === true,
    },
    file,
  )
  if (typeof args === 'string') return fail(args)
  const ran = await $.process
    .run(['gh', ...args], { cwd: workdir(), timeoutMs: 60_000 })
    .catch(error => ({ exitCode: 1, stdout: '', stderr: String(error), isStdoutTruncated: false, isStderrTruncated: false }))
  if (ran.exitCode !== 0) return fail(`gh ${args.slice(0, 2).join(' ')} failed: ${ran.stderr.trim().slice(-1_000)}`)
  const url = urlIn(`${ran.stdout}\n${ran.stderr}`)
  // A PR opened against another base moves the run's base there, so the card and the push compare against what the PR does.
  const prBase = kind === 'pr_create' && typeof input.base === 'string' ? input.base.trim().replace(/^origin\//, '') : ''
  const runBase = (run.project.base ?? config.pr.base).replace(/^origin\//, '')
  if (prBase && prBase !== runBase) await emit($, 'base.changed', { from: runBase, to: prBase, reason: 'pr_create' })
  await emit($, 'github.published', { kind, mode: decision.send, url, file, length: body.length })
  return ok({ published: true, mode: decision.send, url, full_text: bodyFile, length: body.length })
}

async function changedFiles($: Engine, dir: string, base: string): Promise<string[]> {
  const ref = (await git($, dir, ['rev-parse', '--verify', '--quiet', `origin/${base}`])) ? `origin/${base}` : base
  const lists = await Promise.all([
    git($, dir, ['diff', '--name-only', '--diff-filter=d', `${ref}...HEAD`]),
    git($, dir, ['diff', '--name-only', '--diff-filter=d', 'HEAD']),
    git($, dir, ['ls-files', '--others', '--exclude-standard']),
  ])
  return lists.flatMap(list => (list ? list.split('\n') : [])).filter(Boolean)
}

async function testsToRun($: Engine, input: Record<string, unknown>): Promise<string> {
  if (!run) return fail('No active run in this session.')
  const tests = config.tests
  const prefix = envPrefix(config.env)
  const common = {
    work_tree: workdir(),
    follow: tests.follow,
    rules_from: tests.rules_from,
    background: tests.background,
    logs_dir: paths ? `${runDir(paths, run.id)}/tests` : null,
  }
  if (input.scope === 'suite') {
    return ok({
      ...common,
      suite: tests.suite.map(command => withEnv(command, prefix)),
      suite_runs: tests.suite_runs,
      e2e: tests.e2e.map(command => withEnv(command, prefix)),
      e2e_runs: tests.e2e_runs,
      e2e_needs_servers: tests.e2e.length > 0 && config.commands.start.length > 0,
    })
  }
  const changed = await changedFiles($, workdir(), run.project.base ?? config.pr.base)
  const plan = planTouched(changed, tests)
  return ok({
    ...common,
    ...plan,
    commands: plan.commands.map(command => ({ ...command, cmd: withEnv(command.cmd, prefix) })),
    note:
      plan.files.length === 0
        ? 'No test file was created or changed yet. A behaviour change without a test is not done.'
        : plan.unmatched.length > 0
          ? 'No tests.touched command matches the unmatched files: run them the way the project documents, and record an assumption.'
          : null,
  })
}

// What an instance that no longer owns the session may still answer: the tools that only read, and resume, which takes the run back. Any
// other tool, one added later too, is refused there.
const STALE_TOOLS: ReadonlySet<string> = new Set(['get', 'panel', 'resume'])

async function handleOwnTool($: Engine, name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'start':
      return startRun($, input)
    case 'event':
      return recordEvent($, input)
    case 'get':
      return getState($, input)
    case 'resume':
      return resumeRun($, input)
    case 'external_turn':
      return externalTurn($, input)
    case 'run_adapter':
      return runAdapter($, input)
    case 'panel':
      return togglePane($, input)
    case 'tests':
      return testsToRun($, input)
    case 'review_config': {
      const proposal = isObject(input.proposal) ? input.proposal : {}
      const opened = await openConfig($, 'review', proposal)
      if (run && !run.outcome && !opened.startsWith('ERROR')) {
        live.question = 'init: revisar la config'
        await emit($, 'question.asked', {
          question: 'init: revisar la config del proyecto',
          count: 1,
          questions: [{ header: 'init', question: 'config' }],
        })
      }
      return opened.startsWith('ERROR')
        ? opened
        : ok({ opened: true, next: 'End your turn. The person reviews the config in the pane; their save or cancel arrives as a message.' })
    }
    case 'publish':
      return publish($, input)
    default:
      return fail(`Unknown wololo tool ${name}.`)
  }
}

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!match) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  for (const line of (match[1] ?? '').split('\n')) {
    const pair = /^([\w-]+):\s*(.*)$/.exec(line)
    if (pair?.[1]) meta[pair[1]] = (pair[2] ?? '').trim()
  }
  return { meta, body: (match[2] ?? '').trim() }
}

async function registerRoles($: Engine, models: Config['models']) {
  const entries = await $.fs.list(`${root}/roles`).catch(() => [])
  for (const entry of entries) {
    if (!entry.name.endsWith('.md')) continue
    const text = await readText($, `${root}/roles/${entry.name}`)
    if (!text) continue
    const { meta, body } = parseFrontmatter(text)
    const name = meta.name ?? entry.name.replace(/\.md$/, '')
    const model = models[name as keyof Config['models']]?.model ?? meta.model
    await $.agent
      .register({
        name,
        description: meta.description ?? name,
        prompt: body,
        ...(meta.tools ? { tools: meta.tools.split(',').map(tool => tool.trim()) } : {}),
        ...(model ? { model } : {}),
      })
      .catch(() => undefined)
  }
}

function parseNotifications(text: string): Array<{ id: string; status: string }> {
  const found: Array<{ id: string; status: string }> = []
  for (const block of text.match(/<task-notification>[\s\S]*?<\/task-notification>/g) ?? []) {
    const id = /<task-id>\s*([^<]+?)\s*<\/task-id>/.exec(block)?.[1]
    const status = /<status>\s*([^<]+?)\s*<\/status>/.exec(block)?.[1] ?? ''
    if (id) found.push({ id, status })
  }
  return found
}

async function noteNotifications($: Engine, text: string) {
  if (!run || run.outcome || !text.includes('<task-notification>')) return
  for (const note of parseNotifications(text)) {
    if (!FINISHED.test(note.status)) continue
    const task = run.tasks.find(t => t.id === note.id && t.finished_at === null)
    if (task) await emit($, 'task.finished', { id: task.id, label: task.label, status: note.status.toLowerCase() })
    const agent = run.agents.find(a => a.id === note.id && a.finished_at === null)
    if (agent) await emit($, 'agent.finished', { id: agent.id, role: agent.role, status: note.status.toLowerCase() })
  }
}

// A /clear starts a conversation that knows nothing of the run, so the run does not follow it: it is paused where it was, with its card
// and pane gone, and /wololo resume takes it back. Its background shells go on in the process and are left to the resume.
async function releaseRun($: Engine, endingSession: string) {
  if (!run || run.outcome || !(await isOwner($))) return
  const es = run.lang === 'es'
  if (!run.paused)
    await emit($, 'paused', {
      note: es ? 'la sesión se limpió con /clear' : 'the session was cleared with /clear',
    })
  await flush($)
  released.add(endingSession || sessionId)
  loadGeneration += 1
  run = undefined
  historyCache = undefined
  recent = []
  pending = []
  worktreeInfo = null
  live = { isTurnRunning: false, question: null, permission: null }
  await refresh($)
  await $.ui.close({ id: PANE }).catch(() => undefined)
  for (const tool of TOOLS) if (RUN_TOOLS.has(tool.name)) await $.tool.register({ ...tool, isDeferred: true }).catch(() => undefined)
}

// A session's background shells die with its process: what is still open of them is closed as gone when the process exits (taking the run
// back, owner.changed, closes them too). Codex jobs (external) outlive the session and are followed by checkJob.
async function closeTasks($: Engine) {
  if (!run || run.outcome) return
  for (const task of run.tasks.filter(t => t.finished_at === null && t.kind !== 'external')) {
    await emit($, 'task.finished', { id: task.id, label: task.label, status: 'gone' })
  }
}

// The port a background command serves on, when it says so: PORT=4060 (or BACKEND_PORT=4060), --port 4060 or -p 4060.
export function portOf(command: string): number | null {
  const found =
    /\b[A-Z_]*PORT=(\d{2,5})\b/.exec(command) ?? /--port[= ](\d{2,5})\b/.exec(command) ?? /(?:^|\s)-p\s+(\d{2,5})\b/.exec(command)
  return found?.[1] ? Number(found[1]) : null
}

function classifyTask(command: string): 'ci' | 'tests' | 'external' | 'server' | 'other' {
  if (/\bgh\s+(pr\s+checks|run\s+watch)\b/.test(command)) return 'ci'
  if (/\bcodex\b/.test(command)) return 'external'
  const tests = config.tests
  const parts = segments(command)
  if ([...tests.suite, ...tests.e2e].some(cmd => segments(cmd).every(part => parts.includes(part)))) return 'tests'
  if (
    tests.touched.some(entry =>
      parts.some(part => touchedPattern(segments(entry.cmd).find(s => s.includes('{files}')) ?? entry.cmd).test(part)),
    )
  ) {
    return 'tests'
  }
  if (config.commands.start.some(s => s.cmd && command.includes(s.cmd.split(' ').slice(0, 2).join(' ')))) return 'server'
  return 'other'
}

function startTicking($: Engine) {
  timer?.cancel()
  timer = $.clock.every(TICK_MS, () => {
    if (isWriting) return
    isWriting = true
    void quietly(async () => {
      if (!(await isOwner($))) {
        timer?.cancel()
        return
      }
      ticks += 1
      if (ticks % HEARTBEAT_TICKS === 0) await heartbeat($)
      if (ticks % HEARTBEAT_TICKS === 0) await checkJob($)
      if (ticks % REDRAW_TICKS === 0 && run && !run.outcome) await refresh($)
      if (config.keep_awake && run && !run.outcome && ticks >= awakeRenewAt) {
        await keepAwake($)
        awakeRenewAt = ticks + AWAKE_RENEW_TICKS
      }
      await flush($)
    }).finally(() => {
      isWriting = false
    })
  })
}

function dataRoot(options: Readonly<Record<string, unknown>>, home: string): string {
  const configured = typeof options.data_dir === 'string' ? options.data_dir.trim() : ''
  if (!configured) return `${home}/.claude/wololo`
  return configured.replace(/^~(?=\/|$)/, home)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Owning the session comes before reading or writing anything, and the tick right after: whatever fails later, the run still beats
    // and flushes.
    await quietly(async () => {
      await update($, ownerAtom, () => INSTANCE)
      startTicking($)
    })
    await quietly(async () => {
      root = $.plugin.root
      const home = (await $.env.get('HOME')) ?? ''
      homeDir = home
      paths = pathsFor(dataRoot(options, home))
      sessionId = await $.session.id()
      await costDelta($)

      // A session with no run keeps the run's own tools behind ToolSearch; they come forward once a run is active.
      for (const tool of TOOLS) await $.tool.register({ ...tool, isDeferred: RUN_TOOLS.has(tool.name) })
      await $.command
        .register({ name: 'wololo-more', description: 'Expands or collapses the wololo card above the prompt' })
        .catch(() => undefined)
      await $.command
        .register({ name: 'wololo-config', description: "Opens wololo's config: this project's and yours" })
        .catch(() => undefined)
      await $.command
        .register({ name: 'wololo-pause', description: 'Pauses the wololo run at the next clean point, so the session can be closed' })
        .catch(() => undefined)
      await $.command.register({ name: 'wololo-help', description: 'What every wololo command and key does' }).catch(() => undefined)
      await $.command
        .register({ name: 'wololo-status', description: 'Shows every wololo run across projects (add "all" for finished ones)' })
        .catch(() => undefined)
      await $.command
        .register({
          name: 'wololo-history',
          description: 'Shows what happened in this session\'s wololo run (add "all" for agents and tasks too)',
        })
        .catch(() => undefined)

      const cwd = e.cwd || (await $.session.cwd())
      const info = await projectInfo($, cwd)
      config = (await loadConfig($, info?.key ?? '__none__')).config
      await registerRoles($, config.models)
    })
    // After the tools are registered, so the ones a run brings forward are not registered back behind ToolSearch.
    await quietly(async () => {
      if (!paths) return
      const pointer = await readJson<{ run_id?: string }>($, `${paths.sessions}/${sessionId}.json`)
      if (pointer?.run_id) {
        const loaded = await reviveRun($, pointer.run_id)
        if (loaded && !loaded.outcome && loaded.owner.session_id === sessionId) {
          loadGeneration += 1
          run = loaded
          pending = []
          await exposeRunTools($)
          recent = (await readEvents($, runDir(paths, loaded.id))).slice(-RECENT)
          config = await runConfig($, loaded.project.key)
          await settlePermission($, '', 'not_run')
          await inspectWorktree($)
          await refresh($)
          if (config.view.pane === 'auto') void $.ui.open({ id: PANE, title: `wololo · ${loaded.id}` }).catch(() => undefined)
        } else if (loaded?.outcome && loaded.owner.session_id === sessionId && (await read($, viewAtom))) {
          // The card of a run that finished stays up for the session, kept with the state across loads of the mod: drawn again here from
          // the run's events, so a reload shows what this load's code makes of it. The run itself stays closed.
          const dir = runDir(paths, loaded.id)
          const events = await readEvents($, dir)
          const view = buildView(
            loaded,
            loaded.status,
            events.slice(-RECENT),
            await nowSeconds($),
            dir,
            undefined,
            undefined,
            homeDir || undefined,
          )
          await update($, viewAtom, () => view)
        }
      }
    })
    return started
  })

  on('session.end', async ($, e, next) => {
    await quietly(async () => {
      if (EXITS.has(e.reason) && (await isOwner($))) await closeTasks($)
      await flush($)
      if (e.reason === 'clear') await releaseRun($, e.sessionId)
    })
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    if (e.tool.startsWith(TOOL_PREFIX)) return { decision: 'allow' as const, reason: 'wololo: its own run bookkeeping' }
    let ctx = policyContext()
    const input = isObject(e.input) ? e.input : {}
    if (ctx && e.tool === 'Bash' && typeof input.command === 'string') {
      // A push reads the worktree's branch first: a rename made since the last heartbeat is recorded before it is judged.
      const current = hasPush(input.command) ? await syncBranch($).catch(() => null) : null
      ctx = policyContext() ?? ctx
      const denial = pushDenial(input.command, ctx.branch, current)
      if (denial) return { decision: 'deny' as const, reason: denial }
    }
    const githubDenial = ctx ? githubWriteDenial(e.tool, input) : null
    if (githubDenial) return { decision: 'deny' as const, reason: githubDenial }
    const verdict = await next(e)
    if (verdict.decision !== 'ask') return verdict
    const path =
      typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
    const isWrite = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(e.tool)
    if (isWrite && path && paths && isInside(path, paths.root))
      return { decision: 'allow' as const, reason: 'wololo: its own data directory' }
    if (!ctx) return verdict
    if (config.permissions.auto_allow) {
      if (e.tool === 'Bash' && typeof input.command === 'string' && isAllowedBash(input.command, ctx)) {
        return { decision: 'allow' as const, reason: 'wololo: a git/gh step of the active run' }
      }
      if (isWrite && path && isAllowedPath(path, ctx)) return { decision: 'allow' as const, reason: "wololo: inside the run's worktree" }
      if (isReadInside(e.tool, input, ctx)) return { decision: 'allow' as const, reason: "wololo: a read inside the run's worktree" }
      if (e.tool === 'Agent' && isRunAgent(input.subagent_type))
        return { decision: 'allow' as const, reason: "wololo: one of the run's own agents" }
    }
    if (!e.agentId && e.tool_use_id)
      asks.set(e.tool_use_id, { tool: e.tool, what: describeCall(e.tool, input), key: askKey(e.tool, input) })
    return verdict
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    const ctx = policyContext()
    const input = isObject(e.tool_input) ? e.tool_input : {}
    const path = typeof input.file_path === 'string' ? input.file_path : null
    const isPolicyAllowed =
      ctx !== null &&
      config.permissions.auto_allow &&
      ((e.tool_name === 'Bash' && typeof input.command === 'string' && isAllowedBash(input.command, ctx)) ||
        (path !== null && isAllowedPath(path, ctx)) ||
        isReadInside(e.tool_name, input, ctx))
    if (isPolicyAllowed && ctx) {
      return {
        decision: {
          behavior: 'allow' as const,
          updatedPermissions: [
            { type: 'addDirectories' as const, directories: [ctx.workdir, ctx.runDir], destination: 'session' as const },
          ],
        },
      }
    }
    const answered = await next(e)
    if (run && !run.outcome && !e.agent_id && !answered?.decision) await quietly(() => notePermission($, e.tool_name, input))
    return answered
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool.startsWith(TOOL_PREFIX)) {
      if (!STALE_TOOLS.has(tool.slice(TOOL_PREFIX.length)) && !(await isOwner($))) {
        // The load of the mod that owns the session answers if it sits beneath this one; with none there, the call is refused here.
        const inner = await next(e).catch(() => undefined)
        return inner?.result !== undefined && !inner.isError ? inner : { result: notOwner(run?.id) }
      }
      const input = e as unknown as Record<string, unknown>
      const text = await handleOwnTool($, tool.slice(TOOL_PREFIX.length), input).catch(error => fail(String(error)))
      const notice = pauseNotice()
      const notes = [...(reorient && run ? [orientation()] : []), ...(notice ? [notice] : [])]
      if (reorient && run) reorient = false
      return notes.length > 0 ? { result: text, context: notes } : { result: text }
    }
    asks.delete(e.tool_use_id)
    if (!run || run.outcome) return next(e)

    if (!e.agentId && (pendingPermission ? pendingPermission.toolUseId !== e.tool_use_id : run.waiting?.on === 'permission'))
      await quietly(() => settlePermission($, e.tool_use_id, 'not_run'))
    await quietly(() => settlePermission($, e.tool_use_id, 'approved'))

    let ran: Awaited<ReturnType<typeof next>> | undefined
    const handle = async (): Promise<Awaited<ReturnType<typeof next>>> => {
      if (e.tool === 'AskUserQuestion' && !e.agentId) {
        const first = e.questions[0]
        const question = first ? `${first.header}: ${first.question}` : 'question'
        live.question = question
        const asked = e.questions.map(q => ({ header: q.header, question: q.question }))
        await emit($, 'question.asked', { question, count: e.questions.length, questions: asked })
        let ran: Awaited<ReturnType<typeof next>> | undefined
        try {
          ran = await next(e)
          return ran
        } finally {
          live.question = null
          const result =
            ran && ran.deny === undefined
              ? (ran.result as { answers?: Record<string, unknown>; response?: unknown } | undefined)
              : undefined
          const pairs = asked.map(q => ({
            ...q,
            answer: typeof result?.answers?.[q.question] === 'string' ? result.answers[q.question] : '',
          }))
          // Answered only when the dialog returned and the person chose something; a cancelled or denied one is recorded as not answered.
          const answered = result !== undefined && (pairs.some(pair => pair.answer !== '') || typeof result.response === 'string')
          await emit($, 'question.answered', { pairs, response: typeof result?.response === 'string' ? result.response : null, answered })
          if (ran && ran.deny === undefined) await liftBlock($, 'answer')
        }
      }

      if (e.tool === 'Read' && !e.agentId && e.file_path.startsWith(`${root}/stages/`)) {
        const ran = await next(e)
        const hinted = stageForFile(e.file_path.slice(`${root}/stages/`.length))
        const current = run?.stage?.id
        if (!hinted || hinted === current || ran.deny !== undefined) return ran
        const note = `wololo: these are the instructions for ${hinted}, but the run is in ${current ?? 'no stage yet'}. Record stage.entered {stage: "${hinted}"} with ${TOOL_PREFIX}event before working on it.`
        return { ...ran, context: [...(ran.context ?? []), note] }
      }

      if (e.tool === 'Bash' && e.run_in_background) {
        const ran = await next(e)
        const taskId =
          ran.deny === undefined && !ran.isError ? (ran.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId : undefined
        if (taskId)
          await emit($, 'task.started', {
            id: taskId,
            label: e.description ?? e.command.slice(0, 60),
            kind: classifyTask(e.command),
            ...(portOf(e.command) !== null ? { port: portOf(e.command) } : {}),
            ...(e.agentId ? { agent: e.agentId } : {}),
          })
        return ran
      }

      return await next(e)
    }
    try {
      ran = await handle()
      return ran
    } finally {
      const outcome = ran === undefined || ran.deny !== undefined ? 'denied' : 'approved'
      await quietly(() => settlePermission($, e.tool_use_id, outcome))
    }
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await quietly(async () => {
      if (!run || run.outcome || !('agentId' in spawned) || typeof spawned.agentId !== 'string') return
      if (pendingPermission?.tool === 'Agent') await settlePermission($, pendingPermission.toolUseId, 'approved')
      const role = e.subagentType.startsWith('wololo:') ? e.subagentType.slice('wololo:'.length) : e.subagentType
      await emit($, 'agent.started', {
        id: spawned.agentId,
        role,
        description: e.description,
        model: ('model' in spawned && typeof spawned.model === 'string' ? spawned.model : undefined) ?? e.model ?? null,
        background: e.background,
      })
    })
    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await quietly(async () => {
      await followSession($)
      await noteNotifications($, e.text)
      if (e.agentId !== undefined || !run) return
      live.isTurnRunning = true
      await refresh($)
    })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    await quietly(() => noteUsage($, e.agentId, response.usage))
    return response
  })

  on('turn.complete', async ($, e, next) => {
    await quietly(async () => {
      if (!run) return
      await flushMeasures($)
      if (run.outcome) return
      if (e.agentId !== undefined) {
        const agent = run.agents.find(a => a.id === e.agentId && a.finished_at === null)
        if (agent) await emit($, 'agent.finished', { id: agent.id, role: agent.role, status: e.isAborted ? 'killed' : 'completed' })
        return
      }
      live.isTurnRunning = false
      await settlePermission($, '', 'not_run')
      live.permission = null
      asks = new Map()
      lastTurnEndAt = await nowSeconds($)
      await refresh($)
      if (run.pause_requested_at && !run.paused && run.status === 'paused') {
        const es = run.lang === 'es'
        await emit($, 'paused', { note: run.doing?.text ?? (es ? 'pausado al terminar el turno' : 'paused at the end of the turn') })
      }
      if (run.status !== 'stalled' || run.mode !== 'full' || e.isAborted) return
      if (run.counts.nudges < MAX_NUDGES) {
        await emit($, 'stalled', {})
        if (!(await isOwner($))) return
        void $.prompt
          .submit({
            text: `wololo: run ${run.id} is still open and nothing is pending. Continue the current stage (${run.stage?.id ?? 'start'}); if you need the person, ask with AskUserQuestion; if you cannot go on, record blocked or run.finished with ${TOOL_PREFIX}event.`,
          })
          .catch(() => undefined)
      } else {
        await emit($, 'blocked', { reason: 'the run stopped twice with nothing pending' })
      }
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    let input = e
    await quietly(async () => {
      await followSession($)
      if (!run || run.outcome) return
      await noteNotifications($, e.text)
      if (!e.isMeta && e.origin?.kind === 'composer') {
        priorUserAt = run.last_user_at
        run.last_user_at = await nowSeconds($)
        isDirty = true
        await liftBlock($, 'message')
      }
      const notice = pauseNotice()
      const context = [contextLine(), ...(reorient ? [orientation()] : []), ...(notice ? [notice] : [])]
      reorient = false
      input = { ...e, context: [...(e.context ?? []), ...context] }
    })
    return next(input)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    if (!run || run.outcome || e.agentId !== undefined || !paths) return next(e)
    const keep = `Keep in the summary that wololo run ${run.id} is active (stage ${run.stage?.id ?? 'none'}, run files in ${runDir(paths, run.id)}), and that after compaction the next step is to call ${TOOL_PREFIX}get with scope "run".`
    const compacted = await next({ ...e, instructions: [e.instructions, keep].filter(Boolean).join('\n\n') })
    reorient = true
    return compacted
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    const id = e.props.tool_use_id
    if (pendingPermission && pendingPermission.toolUseId === id) void quietly(() => settlePermission($, id, 'approved'))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await read($, viewAtom)
    if (!view || !config.view.band || e.props.hasSurvey) return next(e)
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const band = view.band
    const isExpanded = await read($, expandedAtom)
    const tab = await read($, tabAtom)
    const withDetail = await read($, detailAtom)
    const lang = run?.lang ?? 'es'
    // The tab row, the margins around it and the closing row, plus one row of slack.
    const tabRowsFixed = 5
    const agentRows = (band.agents ?? []).length > 0 ? 1 : 0
    const bandRows = (isRoomy: boolean, detailRows: number) =>
      (isRoomy ? 4 : 2) + 1 + (isRoomy ? 1 : 0) + 1 + detailRows + agentRows + (band.progress ? (isRoomy ? 1 : 0) + 2 : 0)
    const detailWidth = (isRoomy: boolean) => Math.max(20, e.props.bodyColumns - (isRoomy ? 4 : 2) - 2 - 1)
    const roomyDetail = band.detail ? wrapLines(clip(band.detail, 220), detailWidth(true), 3).length : 0
    const roomy = isExpanded
      ? e.props.maxRows - bandRows(true, roomyDetail) - tabRowsFixed >= 13
      : e.props.maxRows >= bandRows(true, roomyDetail)
    const detailRoom = Math.max(1, e.props.maxRows - bandRows(roomy, 0) - (isExpanded ? tabRowsFixed + 1 : 0))
    const detailLines = band.detail ? wrapLines(clip(band.detail, 220), detailWidth(roomy), Math.min(3, detailRoom)) : []
    // Expanded, the card draws its tab whole: taller than the band, the engine scrolls it under the mouse wheel.
    const rows = isExpanded ? tabRows(view, tab, withDetail, lang) : []
    const barWidth = Math.max(24, e.props.bodyColumns - (roomy ? 4 : 2) - 2 - 7)
    const chips = fitChips(band.agents ?? [], detailWidth(roomy))
    const isWaitingTone = band.tone === 'warning' || band.tone === 'error'
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={paint(band.tone)} paddingX={roomy ? 2 : 1} paddingY={roomy ? 1 : 0}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
          <Box flexDirection="row" columnGap={1} flexShrink={1}>
            <Box flexShrink={0}>
              <Text bold color={paint('working')}>
                wololo
              </Text>
            </Box>
            <Text color="inactive">·</Text>
            <Text bold wrap="truncate-end">
              {band.heading ?? band.title.replace(/^wololo · /, '')}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={band.modeLine.color}>{band.modeChip ?? band.mode}</Text>
          </Box>
        </Box>
        <Box flexDirection="column" marginTop={roomy ? 1 : 0}>
          <Box flexDirection="row" columnGap={2}>
            <Box flexShrink={0}>
              <Text inverse bold color={paint(band.tone)}>{` ${band.badge} `}</Text>
            </Box>
            <Text bold wrap="truncate-end">
              {band.stageText ?? band.stage}
              {band.pr && <Text color="inactive">{' · '}</Text>}
              {band.pr && (
                <Link href={band.pr.url}>
                  <Text color="suggestion">{band.pr.label}</Text>
                </Link>
              )}
            </Text>
          </Box>
          {detailLines.length > 0 && (
            <Box flexDirection="column" paddingLeft={1}>
              {detailLines.map(line => (
                <Text color={isWaitingTone ? paint(band.tone) : 'inactive'} wrap="truncate-end">
                  {line}
                </Text>
              ))}
            </Box>
          )}
          {chips.length > 0 && (
            <Box flexDirection="row" paddingLeft={1}>
              {chips.flatMap((chip, index) => [
                ...(index > 0 ? [<Text color="inactive">{' · '}</Text>] : []),
                <Text color={paneColor(chip.color)}>{chip.label}</Text>,
              ])}
            </Box>
          )}
        </Box>
        {band.progress && (
          <Box flexDirection="column" marginTop={roomy ? 1 : 0}>
            <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
              <Box flexDirection="row">
                {thinBar(band.progress.segments, barWidth).map(part => (
                  <Text color={!part.filled ? 'subtle' : part.state === 'done' ? paint('success') : paint(band.tone)}>{part.text}</Text>
                ))}
              </Box>
              <Box flexShrink={0}>
                <Text bold>{`${band.progress.percent}%`}</Text>
              </Box>
            </Box>
            <Box flexDirection="row">
              {barLabels(band.progress.segments, barWidth).map(label => (
                <Text
                  color={label.state === 'current' ? paint(band.tone) : label.state === 'done' ? 'text' : 'inactive'}
                  bold={label.state === 'current'}
                >
                  {label.text}
                </Text>
              ))}
            </Box>
          </Box>
        )}
        {isExpanded && (
          <Box flexDirection="column" marginTop={1}>
            <Box flexDirection="row" justifyContent="space-between" columnGap={3}>
              <Box flexDirection="row" columnGap={3}>
                {TABS.map(item => (
                  <Button
                    key={`tab-${item.id}`}
                    hotkey={item.key}
                    variant={item.id === tab ? 'primary' : undefined}
                    plain={item.id === tab ? undefined : true}
                    dimColor={item.id !== tab}
                    label={tabName(lang, item.id)}
                    onPress={async () => {
                      await update($, tabAtom, () => item.id)
                      void $.ui.focus({ requestId: e.requestId, key: `tab-${item.id}` }).catch(() => undefined)
                      if (item.id === 'items')
                        void $.ui.scroll({ to: { key: 'row-current' }, in: e.requestId, block: 'center' }).catch(() => undefined)
                    }}
                  />
                ))}
                {tab === 'history' && (
                  <Button
                    key="detail"
                    hotkey="c"
                    plain
                    dimColor
                    label={detailLabel(lang, withDetail)}
                    onPress={() => update($, detailAtom, value => !value)}
                  />
                )}
              </Box>
              <Box flexShrink={0}>
                <Button
                  key="toggle"
                  hotkey="m"
                  plain
                  dimColor
                  label={lang === 'es' ? '▴ menos' : '▴ less'}
                  onPress={() => update($, expandedAtom, () => false)}
                />
              </Box>
            </Box>
            <Box flexDirection="column" marginTop={1}>
              {rows.map(row =>
                tab === 'items' && row.text.startsWith('●') ? (
                  <Box key="row-current">
                    <Text color={paneColor(row.tone)} wrap="truncate-end">
                      {row.text}
                    </Text>
                  </Box>
                ) : (
                  <Text color={paneColor(row.tone)} wrap="truncate-end">
                    {row.text || ' '}
                  </Text>
                ),
              )}
            </Box>
            {/* The card scrolls whole, so the way back sits at both ends of it, never over a row. */}
            <Box flexDirection="row" justifyContent="flex-end">
              <Button
                key="toggle-end"
                plain
                dimColor
                label={lang === 'es' ? '▴ menos' : '▴ less'}
                onPress={() => update($, expandedAtom, () => false)}
              />
            </Box>
          </Box>
        )}
        {!isExpanded && (
          <Box position="absolute" bottom={0} right={0}>
            <Button
              key="toggle"
              hotkey="m"
              plain
              dimColor
              label={lang === 'es' ? '▾ más' : '▾ more'}
              onPress={() => update($, expandedAtom, () => true)}
            />
          </Box>
        )}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const drawn = await next(e)
    const view = await read($, viewAtom)
    if (!view || !config.view.band) return drawn
    const { Box, Text } = $.ui.resolve(e)
    const band = view.band
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={paint(band.tone)} paddingX={1}>
          <Text bold>{clip(band.title, 36)}</Text>
          <Box flexDirection="row" columnGap={1}>
            <Text inverse bold color={paint(band.tone)}>{` ${band.badge} `}</Text>
            <Text bold>{band.stage}</Text>
          </Box>
        </Box>
        {drawn}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'wololo-status' }, async ($, e) => statusOutput($, String(e.args ?? '')))

  on('command.run', { command: 'wololo-help' }, async $ => ({ text: await help($) }))

  on('command.run', { command: 'wololo-pause' }, async $ => pauseRun($))

  on('command.run', { command: 'wololo-config' }, async $ => ({ text: configOpened(await openConfig($, 'config')) }))

  on('command.run', { command: 'wololo' }, async ($, e, next) => {
    const args = String(e.args ?? '').trim()
    if (/^help\b/.test(args)) return { text: await help($) }
    if (/^pause\b/.test(args)) return pauseRun($)
    if (/^config\b/.test(args)) return { text: configOpened(await openConfig($, 'config')) }
    const status = /^status\b\s*(.*)$/.exec(args)
    if (status) return statusOutput($, status[1] ?? '')
    await quietly(() => openInitEarly($, args))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const helpLang = helpLangOf(e.props.text)
    if (helpLang) {
      const { Box, Text } = $.ui.resolve(e)
      const sections = helpSections(helpLang, helpConfig)
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
          <Text bold color="subtle">
            {helpLang === 'es' ? 'wololo · ayuda' : 'wololo · help'}
          </Text>
          {sections.map(section => {
            const width = Math.max(...section.lines.map(line => line.key.length)) + 2
            return (
              <Box flexDirection="column" marginTop={1}>
                <Text bold color="claude">
                  {section.title}
                </Text>
                {section.lines.map(line => (
                  <Box flexDirection="row">
                    <Box width={width} flexShrink={0}>
                      <Text color="suggestion">{line.key}</Text>
                    </Box>
                    <Text>
                      {line.text}
                      {line.now ? <Text color="subtle">{` · ${helpNow(helpLang, line.now)}`}</Text> : null}
                    </Text>
                  </Box>
                ))}
              </Box>
            )
          })}
        </Box>
      )
    }
    const stamp = /(?:estado a las|status at) \d{2}:\d{2}:\d{2}\s*$/.exec(e.props.text)?.[0].trim()
    const cards = stamp ? statusRenders.get(stamp) : undefined
    if (!cards) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const es = (run?.lang ?? config.languages.chat) === 'es'
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
          <Text bold color="subtle">
            wololo · runs
          </Text>
          {cards.length === 0 && <Text color="subtle">{es ? 'No hay runs activos.' : 'No active runs.'}</Text>}
          {cards.map((card, index) => (
            <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
              <Text bold>{`${card.project} · ${card.title}`}</Text>
              <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
                <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                  <Text inverse bold color={paint(card.tone)}>{` ${card.badge} `}</Text>
                  <Text bold>{card.stage}</Text>
                </Box>
                <Text color="subtle">{card.ago}</Text>
              </Box>
              {card.current !== '' && <Text>{`  ${card.current}`}</Text>}
              {card.doing !== '' && <Text color={paint(card.tone)}>{`  → ${card.doing}`}</Text>}
              {card.workers.map(line => (
                <Text color={paint(card.tone)}>{`  ${line}`}</Text>
              ))}
              {card.waiting !== '' && <Text color={paint(card.tone)}>{`  ${card.waiting}`}</Text>}
              {card.last !== '' && <Text color="subtle">{`  ${card.last}`}</Text>}
              <Text color="subtle">{`  ${card.id}`}</Text>
            </Box>
          ))}
        </Box>
        <Text color="subtle">
          {es
            ? '  /wololo resume <id> retoma un run cuya sesión se cerró · /wololo-status all incluye los terminados'
            : '  /wololo resume <id> takes over a run whose session closed · /wololo-status all adds finished ones'}
        </Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'wololo-history' }, async ($, e) => {
    if (!run || !paths) return { text: 'wololo: no run in this session. /wololo status lists them.' }
    await flush($)
    const entries = timeline(await readEvents($, runDir(paths, run.id)), run.lang)
    const isAll = /\ball\b/.test(String(e.args ?? ''))
    const shown = isAll ? entries : entries.filter(entry => entry.isMajor)
    const head = `wololo · ${run.title}`
    return { text: [head, '', ...[...shown].reverse().map(formatEntry), '', `${runDir(paths, run.id)}/history.md`].join('\n') }
  })

  on('command.run', { command: 'wololo-more' }, async $ => {
    const isExpanded = await update($, expandedAtom, value => !value)
    return { text: isExpanded ? 'wololo: card expanded.' : 'wololo: card collapsed.' }
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === CONFIG_PANE && e.origin.kind === 'person') {
      await quietly(async () => {
        const dialog = await read($, dialogAtom)
        // Closed while the session still detects: nothing to answer yet, and review_config then asks in the chat.
        if (dialog?.mode === 'review' && dialog.step !== 'detect') await finishReview($, false)
        else await update($, dialogAtom, () => null)
      })
    }
    return closed
  }).catch(($, e, next) => next(e))

  // A focused pane hands its arrows to the scroll, never to its Buttons. While init asks, an arrow moves the focus to the option
  // above or below instead, and the window stays.
  on('ui.scroll', { component: 'Pane', requestId: CONFIG_PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || e.pointer || Math.abs(e.by) !== 1) return next(e)
    const dialog = await read($, dialogAtom)
    const stops = dialog ? arrowStops(dialog) : null
    if (!dialog || !stops) return next(e)
    const to = Math.max(0, Math.min(stops.stops.length - 1, (dialog.hover ?? stops.start) + e.by))
    const stop = stops.stops[to]
    if (!stop) return next(e)
    await update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, hover: to } : d))
    await $.ui.focus({ requestId: CONFIG_PANE, key: stop.key }).catch(() => undefined)
    // Not awaited: this hook sits on the same site's scroll, which the move below raises again. On a section screen the first stop takes
    // it back to its top, so the section's title shows.
    void $.ui.scroll({ to: to === 0 && stops.top ? 'start' : { key: stop.show }, in: CONFIG_PANE }).catch(() => undefined)
    return { deny: 'wololo: the arrows move between the init options' }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: CONFIG_PANE }, async ($, e) => {
    const els = $.ui.resolve(e) as unknown as Els
    const { Box, Button, Text } = els
    const dialog = await read($, dialogAtom)
    const lang: 'es' | 'en' = (run?.lang ?? config.languages.chat) === 'en' ? 'en' : 'es'
    const es = lang === 'es'
    if (!dialog)
      return <Text dimColor>{es ? 'No hay nada abierto. /wololo config lo abre.' : 'Nothing open. /wololo config opens it.'}</Text>
    const effective = effectiveOf(dialog)
    const footer = dialog.message ? (
      <Text color={dialog.message.startsWith(es ? 'Guardado' : 'Saved') ? 'success' : 'error'}>{dialog.message}</Text>
    ) : null
    const repo = dialog.projectKey.replace('__', '/')
    const close = (
      <Box flexShrink={0}>
        <Button
          key="close"
          hotkey="x"
          plain
          label={es ? '× cerrar' : '× close'}
          onPress={async () => {
            if (dialog.mode === 'review') await finishReview($, false)
            else {
              await $.ui.close({ id: CONFIG_PANE }).catch(() => undefined)
              await update($, dialogAtom, () => null)
            }
          }}
        />
      </Box>
    )
    const header = (
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text bold color="claude" wrap="truncate-end">
          {`wololo · ${dialog.mode === 'review' ? 'init' : 'config'} · ${repo}${dialog.dirty ? (es ? ' · sin guardar' : ' · unsaved') : ''}`}
        </Text>
        {close}
      </Box>
    )

    if (dialog.mode === 'review') {
      if (dialog.step === 'ask' || dialog.step === 'detect') {
        const detecting = dialog.step === 'detect'
        const questions = initQuestions(effective, dialog.proposed)
        const at = detecting ? -1 : Math.min(dialog.cursor, questions.length)
        const inherited = merge(DEFAULT_CONFIG, dialog.files.global)
        const pick = async (question: InitQuestion, choice: InitChoice) => {
          const index = questions.indexOf(question)
          await update($, dialogAtom, (d): ConfigDialog | null =>
            d
              ? {
                  ...d,
                  files: { ...d.files, project: applyChoice(d.files.project, inherited, choice.set) },
                  cursor: index + 1,
                  hover: undefined,
                  message: '',
                }
              : d,
          )
          const next = questions[index + 1]
          await revealInit(
            $,
            next
              ? initKey(
                  next,
                  effectiveOf({ ...dialog, files: { ...dialog.files, project: applyChoice(dialog.files.project, inherited, choice.set) } }),
                )
              : 'save-as-is',
          )
        }
        const back = async () => {
          const to = Math.max(0, at - 1)
          await update($, dialogAtom, (d): ConfigDialog | null =>
            d && d.cursor > 0 ? { ...d, cursor: to, hover: undefined, message: '' } : d,
          )
          const question = questions[to]
          if (question) await revealInit($, initKey(question, effective))
        }
        const rows = detecting ? [] : detectedRows(dialog.files.project, repo, String((effective as Config).pr?.base ?? 'main'), lang)
        const width = Math.max(0, ...rows.map(([label]) => label.length))
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
              <Box flexDirection="column">
                <Text bold color="claude">
                  {'█ █ █ █▀█ █   █▀█ █   █▀█'}
                </Text>
                <Box flexDirection="row" columnGap={2}>
                  <Text bold color="claude">
                    {'▀▄▀▄▀ █▄█ █▄▄ █▄█ █▄▄ █▄█'}
                  </Text>
                  <Text color="subtle" wrap="truncate-end">{`init · ${repo}`}</Text>
                </Box>
              </Box>
              {close}
            </Box>
            <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginTop={1}>
              <Text bold color="claude">
                {es ? 'Lo que encontré' : 'What I found'}
              </Text>
              {detecting && (
                <Box flexDirection="row" columnGap={1}>
                  <Text color="warning">∴</Text>
                  <Text wrap="truncate-end">
                    {es
                      ? 'Leyendo el repo: comandos, tests, agentes y rama base…'
                      : 'Reading the repository: commands, tests, agents and base branch…'}
                  </Text>
                </Box>
              )}
              {rows.map(([label, value]) => (
                <Box flexDirection="row" columnGap={2}>
                  <Text color="subtle">{label.padEnd(width)}</Text>
                  <Text wrap="truncate-end">{value}</Text>
                </Box>
              ))}
            </Box>
            <Box flexDirection="column" marginTop={1}>
              <Text color="subtle">┌</Text>
              {questions.map((question, index) => {
                const current = chosenIndex(question, effective)
                if (index < at)
                  return (
                    <Box flexDirection="row" columnGap={2}>
                      <Text color="success">◇</Text>
                      <Text wrap="truncate-end">
                        {question.title[lang]}
                        <Text color="subtle">{` · ${question.choices[current]?.label[lang] ?? ''}`}</Text>
                      </Text>
                    </Box>
                  )
                if (index > at)
                  return (
                    <Box flexDirection="row" columnGap={2}>
                      <Text color="subtle">○</Text>
                      <Text dimColor>{question.title[lang]}</Text>
                    </Box>
                  )
                return (
                  <Box key="init-active" flexDirection="column">
                    <Text color="subtle">│</Text>
                    <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
                      <Box flexDirection="row" columnGap={2}>
                        <Text color="claude">◆</Text>
                        <Text bold>{question.ask[lang]}</Text>
                      </Box>
                      <Text color="subtle">{`${index + 1}/${questions.length}`}</Text>
                    </Box>
                    {question.choices.map((choice, j) => (
                      <Box flexDirection="row" columnGap={2}>
                        <Text color="subtle">│</Text>
                        <Button
                          key={`init-${question.id}-${choice.id}`}
                          hotkey={String(j + 1)}
                          plain
                          dimColor={j !== current}
                          {...(j === current ? { autoFocus: true as const } : {})}
                          label={`${j === current ? '●' : '○'} ${choice.label[lang]}`}
                          onPress={() => pick(question, choice)}
                        />
                        {choice.help && (
                          <Text color="subtle" wrap="truncate-end">
                            {choice.help[lang]}
                          </Text>
                        )}
                      </Box>
                    ))}
                    <Text color="subtle">│</Text>
                  </Box>
                )
              })}
              {at === questions.length && (
                <Box key="init-active" flexDirection="column">
                  <Text color="subtle">│</Text>
                  <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
                    <Box flexDirection="row" columnGap={2}>
                      <Text color="claude">◆</Text>
                      <Text bold>{es ? '¿Guardo la config?' : 'Save the config?'}</Text>
                    </Box>
                    <Text color="subtle">{es ? 'listo' : 'done'}</Text>
                  </Box>
                  {(
                    [
                      {
                        key: 'save-as-is',
                        label: es ? 'Guardar' : 'Save',
                        help: dialog.paths.project.replace(/^\/(Users|home)\/[^/]+/, '~'),
                        onPress: async () => (await saveConfig($, lang)) && finishReview($, true),
                      },
                      {
                        key: 'review',
                        label: es ? 'Ajustar más por sección' : 'Adjust more by section',
                        help: es
                          ? 'debate, tests, git, screenshots, vista, idiomas, presupuestos'
                          : 'debate, tests, git, screenshots, view, languages, budgets',
                        onPress: async () => {
                          await update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, step: 'choose', hover: undefined } : d))
                          await revealInit($, `choose-${SECTIONS[0]?.id ?? ''}`, false)
                        },
                      },
                      {
                        key: 'cancel',
                        label: es ? 'Cancelar' : 'Cancel',
                        help: es ? 'no guarda nada' : 'saves nothing',
                        onPress: () => finishReview($, false),
                      },
                    ] as const
                  ).map((option, j) => (
                    <Box flexDirection="row" columnGap={2}>
                      <Text color="subtle">│</Text>
                      <Button
                        key={option.key}
                        hotkey={String(j + 1)}
                        plain
                        dimColor={j !== 0}
                        {...(j === 0 ? { autoFocus: true as const } : {})}
                        label={`${j === 0 ? '●' : '○'} ${option.label}`}
                        onPress={option.onPress}
                      />
                      <Text color="subtle" wrap="truncate-middle">
                        {option.help}
                      </Text>
                    </Box>
                  ))}
                  <Text color="subtle">│</Text>
                </Box>
              )}
              <Text color="subtle">└</Text>
            </Box>
            <Box flexDirection="row" columnGap={2} marginTop={1}>
              {at > 0 && <Button key="back" hotkey="b" plain dimColor label={es ? 'atrás' : 'back'} onPress={back} />}
              <Text color="subtle">
                {detecting
                  ? es
                    ? 'Las preguntas aparecen cuando termine de leer el repo · Esc cierra'
                    : 'The questions show once the repository is read · Esc closes'
                  : at === questions.length
                    ? es
                      ? '↑↓ o Tab recorre · Enter elige · 1-3 atajo · Esc cancela'
                      : '↑↓ or Tab move · Enter picks · 1-3 shortcut · Esc cancels'
                    : es
                      ? `↑↓ o Tab recorre · Enter elige · 1-${questions[at]?.choices.length ?? 1} atajo · Esc cancela`
                      : `↑↓ or Tab move · Enter picks · 1-${questions[at]?.choices.length ?? 1} shortcut · Esc cancels`}
              </Text>
            </Box>
            {footer}
          </Box>
        )
      }
      if (dialog.step === 'choose') {
        return (
          <Box flexDirection="column">
            {header}
            <Box marginTop={1}>
              <Text bold>{es ? '¿Qué querés revisar?' : 'What do you want to review?'}</Text>
            </Box>
            {SECTIONS.map(section => {
              const isOn = dialog.chosen.includes(section.id)
              return (
                <Box flexDirection="row" columnGap={2}>
                  <Button
                    key={`choose-${section.id}`}
                    plain
                    dimColor={!isOn}
                    label={`${isOn ? '☑' : '☐'} ${section.title[lang]}`}
                    onPress={() =>
                      update($, dialogAtom, (d): ConfigDialog | null =>
                        d ? { ...d, chosen: isOn ? d.chosen.filter(id => id !== section.id) : [...d.chosen, section.id] } : d,
                      )
                    }
                  />
                  <Text color="subtle">{section.help[lang]}</Text>
                </Box>
              )
            })}
            <Box flexDirection="row" columnGap={3} marginTop={1}>
              <Button
                key="continue"
                hotkey="n"
                variant="primary"
                label={dialog.chosen.length > 0 ? (es ? 'Continuar' : 'Continue') : es ? 'Guardar sin revisar' : 'Save without review'}
                onPress={async () => {
                  if (dialog.chosen.length > 0) {
                    await update($, dialogAtom, (d): ConfigDialog | null =>
                      d ? { ...d, step: 'section', cursor: 0, hover: undefined } : d,
                    )
                    await revealField(
                      $,
                      SECTIONS.find(section => dialog.chosen.includes(section.id)),
                    )
                  } else if (await saveConfig($, lang)) await finishReview($, true)
                }}
              />
              <Button
                key="back"
                hotkey="b"
                label={es ? 'Atrás' : 'Back'}
                onPress={async () => {
                  await update($, dialogAtom, (d): ConfigDialog | null =>
                    d ? { ...d, step: 'ask', cursor: initQuestions(effective, d.proposed).length, hover: undefined } : d,
                  )
                  await revealInit($, 'save-as-is')
                }}
              />
            </Box>
            {footer}
          </Box>
        )
      }
      const chosen = SECTIONS.filter(section => dialog.chosen.includes(section.id))
      const section = chosen[dialog.cursor] ?? chosen[0]
      const isLast = dialog.cursor >= chosen.length - 1
      return (
        <Box flexDirection="column">
          {header}
          <Box marginTop={1}>
            <Text bold>{`${section?.title[lang] ?? ''} (${dialog.cursor + 1}/${chosen.length})`}</Text>
          </Box>
          <Text color="subtle">{section?.help[lang] ?? ''}</Text>
          {section ? fieldRows(els, $, section.fields, effective, lang) : null}
          <Box flexDirection="row" columnGap={3} marginTop={1}>
            <Button
              key="next"
              hotkey="n"
              variant="primary"
              label={isLast ? (es ? 'Guardar' : 'Save') : es ? 'Siguiente' : 'Next'}
              onPress={async () => {
                if (!isLast) {
                  await update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, cursor: d.cursor + 1, hover: undefined } : d))
                  await revealField($, chosen[dialog.cursor + 1])
                } else if (await saveConfig($, lang)) await finishReview($, true)
              }}
            />
            <Button
              key="back"
              hotkey="b"
              label={es ? 'Atrás' : 'Back'}
              onPress={async () => {
                await update($, dialogAtom, (d): ConfigDialog | null =>
                  d ? (d.cursor > 0 ? { ...d, cursor: d.cursor - 1, hover: undefined } : { ...d, step: 'choose', hover: undefined }) : d,
                )
                await (dialog.cursor > 0
                  ? revealField($, chosen[dialog.cursor - 1])
                  : revealInit($, `choose-${SECTIONS[0]?.id ?? ''}`, false))
              }}
            />
          </Box>
          {footer}
        </Box>
      )
    }

    const section = SECTIONS[dialog.section] ?? SECTIONS[0]
    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection="row" columnGap={1} marginTop={1}>
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} flexShrink={0}>
            <Text bold color="subtle">
              {es ? 'Secciones' : 'Sections'}
            </Text>
            {SECTIONS.map((item, index) =>
              index === dialog.section ? (
                <Text inverse bold color="suggestion">{` ${item.title[lang]} `}</Text>
              ) : (
                <Button
                  key={`section-${item.id}`}
                  plain
                  dimColor
                  label={item.title[lang]}
                  onPress={() => update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, section: index, hover: undefined } : d))}
                />
              ),
            )}
          </Box>
          <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} flexGrow={1}>
            <Text bold>{section?.title[lang] ?? ''}</Text>
            <Text color="subtle">{section?.help[lang] ?? ''}</Text>
            {section ? fieldRows(els, $, section.fields, effective, lang) : null}
          </Box>
        </Box>
        <Box flexDirection="row" columnGap={2} marginTop={1}>
          <Text bold>{es ? 'Guardar en:' : 'Save to:'}</Text>
          <Button
            key="target-project"
            plain
            dimColor={dialog.target !== 'project'}
            label={`${dialog.target === 'project' ? '●' : '○'} ${es ? 'este proyecto' : 'this project'}`}
            onPress={() => update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, target: 'project' } : d))}
          />
          <Button
            key="target-global"
            plain
            dimColor={dialog.target !== 'global'}
            label={`${dialog.target === 'global' ? '●' : '○'} ${es ? 'todos (global)' : 'everywhere (global)'}`}
            onPress={() => update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, target: 'global' } : d))}
          />
        </Box>
        <Box flexDirection="row" columnGap={3} marginTop={1}>
          <Button key="save" hotkey="s" variant="primary" label={es ? 'Guardar' : 'Save'} onPress={() => saveConfig($, lang)} />
          <Text color="subtle">
            {es ? 'Tab/flechas recorren · Enter elige · Esc cierra' : 'Tab/arrows move · Enter picks · Esc closes'}
          </Text>
        </Box>
        {footer}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await read($, viewAtom)
    const els = $.ui.resolve(e) as unknown as Els
    const { Box, Button, Text } = els
    // A view an earlier load of the mod left has no pane yet; the next refresh draws one.
    if (!view?.pane) return <Text dimColor>No active wololo run in this session.</Text>
    const tab = await read($, tabAtom)
    const withDetail = await read($, detailAtom)
    const lang = run?.lang ?? 'es'
    const es = lang === 'es'
    const band = view.band
    const pane = view.pane
    const columns = Math.max(24, e.props.bodyColumns)
    // Narrow, each label sits above its lines; wide, in a gutter beside them, and the tabs line up with the content.
    const isNarrow = columns < PANE_NARROW
    const indent = isNarrow ? 0 : PANE_GUTTER
    const rule = (from: number) => (
      <Text color="subtle" wrap="truncate-end">
        {'─'.repeat(Math.max(1, columns - from))}
      </Text>
    )
    const progress = band.progress
    const head = `${pane.stage.icon} ${pane.stage.label}`
    const barWidth = Math.max(10, columns - indent - head.length - pane.stage.position.length - 4 - 6)
    const chips = progress.segments.map(segment => ({
      mark: segment.state === 'done' ? '✓' : segment.state === 'current' ? '●' : '○',
      text: segment.short,
      state: segment.state,
    }))
    const tabRowsShown = tab === 'summary' || tab === 'detail' ? null : tabRows(view, tab, withDetail, lang)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
          <Box flexDirection="row" columnGap={2} flexShrink={1}>
            {pane.ref !== '' && (
              <Box flexShrink={0}>
                <Text color="inactive">{pane.ref}</Text>
              </Box>
            )}
            <Text bold wrap="truncate-end">
              {pane.title}
            </Text>
          </Box>
          <Box flexDirection="row" columnGap={3} flexShrink={0}>
            <Text color="inactive">wololo</Text>
            <Button
              key="close"
              hotkey="x"
              plain
              label={es ? 'cerrar' : 'close'}
              onPress={() => void $.ui.close({ id: PANE }).catch(() => undefined)}
            />
          </Box>
        </Box>
        {rule(0)}
        {paneBlock(els, columns, {
          label: es ? 'estado' : 'status',
          lines: [
            [
              { text: ` ${pane.status.badge} `, tone: band.tone, bold: true, inverse: true },
              ...(pane.status.since ? [{ text: `   ${pane.status.since}`, tone: 'subtle' }] : []),
              ...(band.pr
                ? [
                    { text: '   PR ', tone: 'subtle' },
                    { text: band.pr.label, tone: 'suggestion', href: band.pr.url },
                  ]
                : []),
            ],
          ],
          gap: true,
        })}
        <Box flexDirection={isNarrow ? 'column' : 'row'} marginTop={1}>
          <Box width={isNarrow ? undefined : PANE_GUTTER} flexShrink={0}>
            <Text color="inactive">{es ? 'etapa' : 'stage'}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} paddingLeft={isNarrow ? 2 : 0}>
            <Box flexDirection="row" columnGap={2}>
              <Box flexShrink={0}>
                <Text color={paint(band.tone)} bold>
                  {head}
                </Text>
              </Box>
              {pane.stage.position !== '' && (
                <Box flexShrink={0}>
                  <Text>{pane.stage.position}</Text>
                </Box>
              )}
              <Box flexDirection="row" flexShrink={1}>
                {thinBar(progress.segments, barWidth).map(part => (
                  <Text color={!part.filled ? 'subtle' : part.state === 'done' ? 'text' : paint(band.tone)}>{part.text}</Text>
                ))}
              </Box>
              <Box flexShrink={0}>
                <Text bold>{`${progress.percent}%`}</Text>
              </Box>
            </Box>
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {chips.map(chip => (
                <Text>
                  <Text
                    color={chip.state === 'done' ? paint('success') : chip.state === 'current' ? paint(band.tone) : 'inactive'}
                  >{`${chip.mark} `}</Text>
                  <Text
                    color={chip.state === 'current' ? paint(band.tone) : chip.state === 'done' ? 'text' : 'inactive'}
                    bold={chip.state === 'current'}
                  >
                    {chip.text}
                  </Text>
                </Text>
              ))}
            </Box>
          </Box>
        </Box>
        <Box flexDirection="row" columnGap={3} marginTop={1} paddingLeft={indent}>
          {TABS.map(item => (
            <Button
              key={`tab-${item.id}`}
              hotkey={item.key}
              variant={item.id === tab ? 'primary' : undefined}
              plain={item.id === tab ? undefined : true}
              dimColor={item.id !== tab}
              label={tabName(lang, item.id)}
              onPress={async () => {
                await update($, tabAtom, () => item.id)
                void $.ui.focus({ requestId: PANE, key: `tab-${item.id}` }).catch(() => undefined)
              }}
            />
          ))}
          {tab === 'history' && (
            <Button
              key="detail"
              hotkey="c"
              plain
              dimColor
              label={detailLabel(lang, withDetail)}
              onPress={() => update($, detailAtom, value => !value)}
            />
          )}
        </Box>
        <Box paddingLeft={indent}>{rule(indent)}</Box>
        {tabRowsShown === null ? (
          (tab === 'summary' ? pane.summary : pane.detail).map((block, index) =>
            paneBlock(els, columns, index === 0 ? { ...block, gap: false } : block),
          )
        ) : (
          <Box flexDirection="column" paddingLeft={indent}>
            {tabRowsShown.map(row => (
              <Text color={paneColor(row.tone)}>{row.text || ' '}</Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!config.view.header || !e.props.isFirstOfReply) return next(e)
    let line = headers.get(e.requestId)
    if (line === undefined) {
      const view = await read($, viewAtom)
      const ts = await nowSeconds($)
      const isFresh = live.isTurnRunning || ts - lastTurnEndAt < HEADER_WINDOW_SECONDS
      if (!view || !isFresh) return next(e)
      line = view.header
      headers.set(e.requestId, line)
    }
    const drawn = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text color="subtle">{line}</Text>
        {drawn}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}

import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, TurnUsage } from 'claude-code'

import { ADAPTER_POINTS, type AdapterPoint, type Config, DEFAULT_CONFIG, envPrefix, expand, LAUNCH_FLAGS, merge, type Overrides, parseFlags, parseJson, planTouched, ports, projectKey, resolve, riskyFiles, shellQuote, slugify, touchedPattern, validate, withEnv, withOverrides } from './config'
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
import { type PolicyContext, commandRules, githubWriteDenial, isAllowedBash, isAllowedPath, isInside, isReadInside, pushDenial, segments } from './policy'
import { type Field, SECTIONS, fieldValue, parseInput, setAt, summarize } from './configui'
import { helpLangOf, helpNow, helpSections, helpText } from './help'
import { type Entry, formatEntry, historyMarkdown, timeline } from './history'
import { changedSinceApproval, checkEvent, hintFor, stageForFile } from './rules'
import {
  type Paths,
  appendLines,
  git,
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
import type { ConfigDialog, Row, ViewState } from '../types'
import { type MirrorRun, type StatusCard, type WorktreeInfo, barLabels, buildView, fitChips, mirrorCards, pageOf, statusCards, statusTable, thinBar, wrapLines } from './ui'

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
const pageAtom = atom({ plugin: 'wololo', key: 'page' } as const, -1)
const INSTANCE = Math.random().toString(36).slice(2, 10)

let paths: Paths | undefined
let root = ''
let sessionId = ''
let config: Config = DEFAULT_CONFIG
let run: Run | undefined
let recent: RunEvent[] = []
let pending: RunEvent[] = []
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
let pendingUsage = new Map<string, { stage: StageId; role: string; input: number; output: number; cache_read: number; cache_write: number; usd: number }>()
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
  { id: 'items', key: 'i' },
  { id: 'history', key: 'h' },
] as const

function tabName(lang: string, which: 'summary' | 'items' | 'history'): string {
  const names =
    lang === 'es' ? { summary: 'Resumen', items: 'Ítems', history: 'Historial' } : { summary: 'Summary', items: 'Items', history: 'History' }
  return names[which]
}

function detailLabel(lang: string, withDetail: boolean): string {
  if (lang === 'es') return withDetail ? 'sin detalle' : 'con detalle'
  return withDetail ? 'less detail' : 'more detail'
}

function tabRows(view: ViewState, tab: 'summary' | 'items' | 'history', withDetail: boolean, lang: string): Row[] {
  if (tab === 'summary') return view.details ?? []
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
  const view = buildView(run, status, recent, at, paths ? runDir(paths, run.id) : undefined, history, worktreeInfo ?? undefined, homeDir || undefined)
  await update($, viewAtom, () => view)
  $.ui.status(config.view.statusline ? view.statusLine : undefined)
  if (status !== previous && config.view.notify.includes(status)) {
    void $.ui.notify(`${view.header}${run.waiting ? ` ${run.waiting.question}` : ''}`, { title: 'wololo' }).catch(() => undefined)
  }
  isDirty = true
}

async function emit($: Engine, type: EventType, data: Record<string, unknown> = {}) {
  if (!run) return
  const ts = await nowSeconds($)
  const ev: RunEvent = { v: 1, seq: nextSeq(run), ts, run: run.id, type, data }
  run = apply(run, ev)
  pending.push(ev)
  recent = [...recent, ev].slice(-RECENT)
  await refresh($, ts)
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

async function flush($: Engine) {
  if (!run || !paths) return
  const dir = runDir(paths, run.id)
  if (pending.length > 0) {
    const batch = pending
    pending = []
    await rotateIfLarge($, dir)
    const ok = await appendLines(
      $,
      `${dir}/events.jsonl`,
      batch.map(ev => JSON.stringify(ev)),
    )
    if (!ok) pending = [...batch, ...pending]
    else await writeHistory($, dir)
  }
  if (isDirty) {
    isDirty = false
    await writeJson($, `${dir}/run.json`, run)
  }
}

async function writeHistory($: Engine, dir: string) {
  if (!run) return
  const entries = timeline(await readEvents($, dir), run.lang)
  historyCache = entries
  await writeAtomic($, `${dir}/history.md`, historyMarkdown(`wololo · ${run.title}`, entries))
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
    step: 'summary',
    chosen: [],
    cursor: 0,
  }
  await update($, dialogAtom, () => dialog)
  const opened = await $.ui
    .open({ id: CONFIG_PANE, title: mode === 'review' ? 'wololo · init' : 'wololo · config', focus: true, closeOnEscape: true, holdToasts: true, rows: 32 })
    .catch((error: unknown) => ({ isPlaced: false as const, reason: error instanceof Error ? error.message : String(error) }))
  if (!opened.isPlaced) {
    // An undrawn pane would leave the person waiting on a dialog they cannot see.
    await $.ui.close({ id: CONFIG_PANE }).catch(() => undefined)
    await update($, dialogAtom, () => null)
    return fail(`The config pane could not be shown (${opened.reason}). Show the config in the chat instead.`)
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
  await update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, dirty: false, message: lang === 'es' ? `Guardado en ${d.paths[d.target]}` : `Saved to ${d.paths[d.target]}` } : d))
  return true
}

async function finishReview($: Engine, saved: boolean) {
  const dialog = await read($, dialogAtom)
  await $.ui.close({ id: CONFIG_PANE }).catch(() => undefined)
  await update($, dialogAtom, () => null)
  if (run && !run.outcome) {
    live.question = null
    await emit($, 'question.answered', { pairs: [{ header: 'init', question: 'config', answer: saved ? 'saved' : 'cancelled' }], response: null })
  }
  const text = saved
    ? `wololo: the person reviewed and saved the project config at ${dialog?.paths.project ?? 'its path'}. Continue.`
    : 'wololo: the person cancelled the config review; nothing was written. Ask them how to go on.'
  void $.prompt.submit({ text }).catch(() => undefined)
}

type Els = ElementTable<'terminal'>

function fieldRows(els: Els, $: Engine, fields: readonly Field[], effective: unknown, lang: 'es' | 'en') {
  const { Box, Button, Input, Text } = els
  return fields.map(field => {
    const current = fieldValue(field, effective)
    if (field.kind === 'radio') {
      return (
        <Box flexDirection="column" marginTop={1}>
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
        <Box flexDirection="row" columnGap={2} marginTop={1}>
          <Button key={field.path} plain dimColor={!isOn} label={`${isOn ? '☑' : '☐'} ${field.label[lang]}`} onPress={() => setField($, field, !isOn)} />
          {field.help && <Text color="subtle">{field.help[lang]}</Text>}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" marginTop={1}>
        <Input
          key={field.path}
          label={field.label[lang]}
          value={current}
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
  if (run.paused) return { text: es ? 'wololo: el run ya está pausado. /wololo resume lo retoma.' : 'wololo: the run is already paused. /wololo resume picks it up.' }
  if (!run.pause_requested_at) await emit($, 'pause.requested', { by: 'person' })
  if (run.status === 'paused') {
    await emit($, 'paused', { note: es ? 'pausado entre pasos, sin nada corriendo' : 'paused between steps, nothing running' })
    await flush($)
    return { text: es ? 'wololo: run pausado. Podés cerrar la sesión; /wololo resume lo retoma.' : 'wololo: run paused. You can close the session; /wololo resume picks it up.' }
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
  const listed = (await listRuns($, paths)).map(r => ({ run: r, status: effectiveStatus(r, ts) })).filter(x => isAll || !isTerminal(x.status))
  const runs = []
  for (const item of listed) {
    const entries = timeline(await readEvents($, runDir(paths, item.run.id)), item.run.lang).filter(entry => entry.isMajor && entry.icon !== '→')
    runs.push({ ...item, last: entries[entries.length - 1] })
  }
  const lang = run?.lang ?? config.languages.chat
  const stamp = statusStamp(ts, lang)
  const cwd = await $.session.cwd()
  const mirrored = await mirrorRuns($, cwd)
  const project = (await projectInfo($, cwd))?.key.split('__').slice(-1)[0] ?? ''
  statusRenders.set(stamp, [...statusCards(runs, ts), ...mirrorCards(mirrored, project, lang)])
  const lines = mirrored.map(m => `runner ${m.issue ? `#${m.issue}` : m.id} · ${m.state} · ${m.waiting_on}${m.exit === 2 && m.unblock ? ` · ${m.unblock}` : ''}`)
  return { text: [statusTable(runs, ts), ...(lines.length > 0 ? ['', ...lines] : []), '', stamp].join('\n') }
}

async function keepAwake($: Engine) {
  await $.process
    .run(['sh', '-c', `command -v caffeinate >/dev/null && (caffeinate -i -t ${AWAKE_LEASE_SECONDS} >/dev/null 2>&1 &)`], { timeoutMs: 5_000 })
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
  const open = rows.filter(row => !['merged', 'staged', 'already_satisfied', 'cancelled', 'superseded', 'accepted'].includes(String(row.state)))
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

async function inspectWorktree($: Engine) {
  if (!run || run.outcome) {
    worktreeInfo = null
    return
  }
  const dir = run.project.worktree ?? run.project.path
  if (!dir) return
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
  if (run.items.total > 0 && (run.items.list ?? []).length < run.items.total && pending.length === 0) {
    const revived = await reviveRun($, run.id)
    if (revived) run = { ...revived, owner: run.owner, status: run.status, last_user_at: run.last_user_at }
  }
  await reconcileAgents($, ts)
  await flushMeasures($)
  await inspectWorktree($)
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
  run = emptyRun(id, ts)
  historyCache = undefined
  recent = []
  pending = []
  live = { isTurnRunning: true, question: null, permission: null }
  await emit($, 'run.started', {
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
  const late = type === 'stage.entered' && ['evidence', 'gate_b', 'pr'].includes(String(data.stage)) && stageIndex(data.stage as StageId) > (run.stage?.index ?? -1)
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
  const starts = config.commands.start.map(start => start.cmd.split(/\s+/).filter(word => !/^\w+=/.test(word)).slice(0, 2).join(' '))
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
    await writeAtomic($, file, `[wololo kept the last ${LOG_KEEP_BYTES / 1024 / 1024} MB of this log when the run finished]\n${tail.stdout}`)
    trimmed.push(file.slice(dir.length + 1))
  }
  return { stopped, trimmed }
}

// The tree `git add -A && git commit` would make of the work tree now, built in a scratch index so the real one is left alone.
async function worktreeTree($: Engine, worktree: string, dir: string): Promise<string | null> {
  const env = { GIT_INDEX_FILE: `${dir}/verified.index` }
  for (const args of [['read-tree', 'HEAD'], ['add', '-A']]) {
    const ran = await $.process.run(['git', ...args], { cwd: worktree, env, timeoutMs: 30_000 }).catch(() => undefined)
    if (!ran || ran.exitCode !== 0) return null
  }
  const ran = await $.process.run(['git', 'write-tree'], { cwd: worktree, env, timeoutMs: 30_000 }).catch(() => undefined)
  return ran && ran.exitCode === 0 ? ran.stdout.trim() : null
}

// The hashes a gate approves: spec.md and plan.md in the run directory, and the worktree's committed tree.
async function snapshot($: Engine, dir: string, worktree: string | null): Promise<Snapshot> {
  const hash = async (name: string) => ((await readText($, `${dir}/${name}`)) === undefined ? null : await git($, dir, ['hash-object', `${dir}/${name}`]))
  return { spec: await hash('spec.md'), plan: await hash('plan.md'), tree: worktree ? await git($, worktree, ['rev-parse', 'HEAD^{tree}']) : null }
}

async function recordEvent($: Engine, input: Record<string, unknown>): Promise<string> {
  if (!run || !paths) return fail('No active run in this session. Start one with /wololo, or resume one with /wololo resume <run>.')
  const type = String(input.type ?? '')
  const data = isObject(input.data) ? input.data : {}
  const worktree = run.project.worktree
  if (worktree && type === 'item.verified' && data.result !== 'fail') data.worktree_tree = await worktreeTree($, worktree, runDir(paths, run.id))
  if (worktree && type === 'item.committed' && typeof data.sha === 'string') data.commit_tree = await git($, worktree, ['rev-parse', `${data.sha}^{tree}`])
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
  await emit($, type as EventType, data)
  let cleanup: { stopped: string[]; trimmed: string[] } | null = null
  if (type === 'run.finished') {
    await flush($)
    cleanup = await cleanUp($, runDir(paths, run.id))
  }
  const ts = await nowSeconds($)
  return ok({ ok: true, header: header(run, run.status, ts), status: run.status, hint: hintFor(type, data, root), ...(cleanup ? { cleanup } : {}) })
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
  const id = String(input.run_id ?? run?.id ?? '')
  if (run && !run.outcome && run.id !== id)
    return fail(`Run ${run.id} is active in this session; finish or cancel it before resuming another.`)
  const target = await reviveRun($, id)
  if (!target) return fail(`No run ${id} in ${paths.runs}.`)
  const ts = await nowSeconds($)
  const status = effectiveStatus(target, ts)
  if (isTerminal(status)) return fail(`Run ${id} already finished (${status}).`)
  const isStale = ts - target.owner.heartbeat_at > ORPHAN_AFTER_SECONDS
  if (target.owner.session_id !== sessionId && !isStale) {
    return fail(`Run ${id} is owned by a live session (heartbeat ${Math.round(ts - target.owner.heartbeat_at)}s ago). Resume it there.`)
  }
  const dir = runDir(paths, id)
  const events = await readEvents($, dir)
  await costDelta($)
  run = target
  historyCache = undefined
  recent = events.slice(-RECENT)
  pending = []
  config = await runConfig($, target.project.key)
  live = { isTurnRunning: true, question: null, permission: null }
  await emit($, 'owner.changed', { session_id: sessionId, cwd: await $.session.cwd() })
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
async function startJob($: Engine, point: string, step: number, cmd: string, known: Record<string, string>): Promise<{ wait: string } | string> {
  if (!run || !paths) return 'No active run.'
  const job = `${runDir(paths, run.id)}/adapters/${point}-${step}-${hex(6)}`
  const q = (suffix: string) => shellQuote(`${job}${suffix}`)
  await $.fs.write(`${job}.sh`, [`cd ${shellQuote(workdir())} || exit 1`, `${cmd} > ${q('.out')} 2> ${q('.err')}`, `echo $? > ${q('.code.tmp')}`, `mv ${q('.code.tmp')} ${q('.code')}`, ''].join('\n'))
  const started = await $.process
    .run(['sh', '-c', `nohup sh ${q('.sh')} </dev/null >/dev/null 2>&1 & echo $!`], { cwd: workdir(), timeoutMs: 10_000 })
    .catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  const pid = Number(started.stdout.trim())
  if (started.exitCode !== 0 || !Number.isInteger(pid) || pid <= 0) return `\`${cmd}\` could not start in the background: ${started.stderr.trim() || 'no pid'}`
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
    const alive = await $.process.run(['kill', '-0', String(job.pid)], { timeoutMs: 5_000 }).then(r => r.exitCode === 0, () => false)
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
  const ran = await $.process.run(['sh', '-c', withEnv(expand(status, vars), envPrefix(config.env))], { cwd: workdir(), timeoutMs: 60_000 }).catch(() => null)
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
    return fail(`The ${job.point} adapter still runs \`${job.cmd}\` in the background. Wait for it with \`${job.wait}\` (run_in_background), then call run_adapter for ${job.point} again.`)
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
    await emit($, 'adapter.ran', { point, cmd, ok: !refused, exit: ran.exitCode, code, state, message: refused ? message : null, captured: got })
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
        review: { type: 'string', enum: ['local', 'pr'], description: 'Overrides config.review.approval: approve the change at Aprobar PR (local) or on the PR once CI is green (pr).' },
        flags: { type: 'array', items: { type: 'string' }, description: 'The --flags the person launched the run with, as typed (--base=<branch> with its value). Unknown flags are refused.' },
        risk: { type: 'string', enum: ['low', 'high', 'unknown'] },
      },
      required: ['source', 'title'],
    },
  },
  {
    name: 'event',
    description:
      "Records a transition or a fact of the active run so the person can see it (band, pane, status line, dashboards). The run refuses transitions out of order: a skipped stage, a gate resolved without the person's answer. Types: stage.entered {stage, reason?}, stage.completed {stage, note?}, gate.requested {gate}, gate.resolved {gate, outcome: approved|changes|rejected, by: user|auto}, risk.set {risk, reason}, plan.ready {items:[titles]}, item.started {n, title, reversal?}, item.verified {n, result: pass|fail, tree}, item.reviewed {n, findings, verdict}, item.committed {n, sha, title}, debate.turn {stage, role, round, model, verdict, file}, doing {text} (one plain sentence on what is being done and why, whenever something long starts), assumption {text, stage}, decision {text, by}, corrected {text}, blocked {reason}, unblocked {}, ci.updated {state: pending|passing|failing}, pr.opened {url, number, draft}, pr.ready {}, screenshot.saved {file, caption}, run.finished {outcome: done|failed|cancelled, summary}.",
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
      'Opens the config review for the person, as /wololo init asks: what was detected, which sections to review, one screen per section, then save. Pass the proposed project config (only the keys that differ from the defaults). It returns at once; end your turn: the person\'s save or cancel arrives as a message.',
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
        await emit($, 'question.asked', { question: 'init: revisar la config del proyecto', count: 1, questions: [{ header: 'init', question: 'config' }] })
      }
      return opened.startsWith('ERROR') ? opened : ok({ opened: true, next: 'End your turn. The person reviews the config in the pane; their save or cancel arrives as a message.' })
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

async function reconcileTasks($: Engine, alive: ReadonlyArray<{ id: string }> | undefined) {
  if (!run || run.outcome || !alive) return
  const ids = new Set(alive.map(task => task.id))
  for (const task of run.tasks.filter(t => t.finished_at === null && t.kind !== 'external' && !ids.has(t.id))) {
    await emit($, 'task.finished', { id: task.id, label: task.label, status: 'gone' })
  }
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

function dataRoot(options: Readonly<Record<string, unknown>>, home: string): string {
  const configured = typeof options.data_dir === 'string' ? options.data_dir.trim() : ''
  if (!configured) return `${home}/.claude/wololo`
  return configured.replace(/^~(?=\/|$)/, home)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
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
      await $.command
        .register({ name: 'wololo-help', description: 'What every wololo command and key does' })
        .catch(() => undefined)
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

      const pointer = await readJson<{ run_id?: string }>($, `${paths.sessions}/${sessionId}.json`)
      if (pointer?.run_id) {
        const loaded = await reviveRun($, pointer.run_id)
        if (loaded && !loaded.outcome && loaded.owner.session_id === sessionId) {
          run = loaded
          await exposeRunTools($)
          recent = (await readEvents($, runDir(paths, loaded.id))).slice(-RECENT)
          config = await runConfig($, loaded.project.key)
          await settlePermission($, '', 'not_run')
          await inspectWorktree($)
          await refresh($)
          if (config.view.pane === 'auto') void $.ui.open({ id: PANE, title: `wololo · ${loaded.id}` }).catch(() => undefined)
        }
      }

      await update($, ownerAtom, () => INSTANCE)
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
    })
    return started
  })

  on('session.end', async ($, e, next) => {
    await quietly(() => flush($))
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    if (e.tool.startsWith(TOOL_PREFIX)) return { decision: 'allow' as const, reason: 'wololo: its own run bookkeeping' }
    const ctx = policyContext()
    const input = isObject(e.input) ? e.input : {}
    if (ctx && e.tool === 'Bash' && typeof input.command === 'string') {
      const denial = pushDenial(input.command, ctx.branch)
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
    if (!e.agentId && e.tool_use_id) asks.set(e.tool_use_id, { tool: e.tool, what: describeCall(e.tool, input), key: askKey(e.tool, input) })
    return verdict
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    await quietly(() => reconcileTasks($, e.background_tasks))
    return next(e)
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
          updatedPermissions: [{ type: 'addDirectories' as const, directories: [ctx.workdir, ctx.runDir], destination: 'session' as const }],
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
          await emit($, 'task.started', { id: taskId, label: e.description ?? e.command.slice(0, 60), kind: classifyTask(e.command) })
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

  on('prompt.attachment', async ($, e, next) => {
    await quietly(() => noteNotifications($, e.text))
    return next(e)
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
    const { Box, Button, Text } = $.ui.resolve(e)
    const band = view.band
    const isExpanded = await read($, expandedAtom)
    const tab = await read($, tabAtom)
    const withDetail = await read($, detailAtom)
    const lang = run?.lang ?? 'es'
    const tabRowsFixed = 6
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
    const fixedRows = bandRows(roomy, detailLines.length) + tabRowsFixed
    const page = isExpanded
      ? pageOf(tabRows(view, tab, withDetail, lang), Math.max(1, e.props.maxRows - fixedRows), await read($, pageAtom), tab === 'items' ? (view.items ?? []).findIndex(row => row.text.startsWith('▶')) : -1)
      : { rows: [], start: 0, size: 0, total: 0 }
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
            <Text color="subtle">·</Text>
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
            </Text>
          </Box>
          {detailLines.length > 0 && (
            <Box flexDirection="column" paddingLeft={1}>
              {detailLines.map(line => (
                <Text color={isWaitingTone ? paint(band.tone) : 'subtle'} wrap="truncate-end">
                  {line}
                </Text>
              ))}
            </Box>
          )}
          {chips.length > 0 && (
            <Box flexDirection="row" paddingLeft={1}>
              {chips.flatMap((chip, index) => [
                ...(index > 0 ? [<Text color="subtle">{' · '}</Text>] : []),
                <Text color={paint(chip.color)}>{chip.label}</Text>,
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
                <Text color={label.state === 'current' ? paint(band.tone) : label.state === 'done' ? 'text' : 'subtle'} bold={label.state === 'current'}>
                  {label.text}
                </Text>
              ))}
            </Box>
          </Box>
        )}
        {isExpanded && (
          <Box flexDirection="column" marginTop={1}>
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
                    await update($, pageAtom, () => -1)
                    void $.ui.focus({ requestId: e.requestId, key: `tab-${item.id}` }).catch(() => undefined)
                  }}
                />
              ))}
              {tab === 'history' && (
                <Button
                  key="detail"
                  hotkey="d"
                  plain
                  dimColor
                  label={detailLabel(lang, withDetail)}
                  onPress={() => update($, detailAtom, value => !value)}
                />
              )}
              <Button
                key="pane"
                hotkey="p"
                plain
                dimColor
                label={lang === 'es' ? 'abrir panel' : 'open pane'}
                onPress={() => void $.ui.open({ id: PANE, title: view.title }).catch(() => undefined)}
              />
            </Box>
            <Box flexDirection="column" marginTop={1}>
              {page.rows.map(row => (
                <Text color={paint(row.tone)} wrap="truncate-end">
                  {row.text || ' '}
                </Text>
              ))}
              {page.total > page.size && (
                <Box flexDirection="row" columnGap={3} marginTop={1}>
                  <Text color="subtle">{`${page.start + 1}–${page.start + page.rows.length} ${lang === 'es' ? 'de' : 'of'} ${page.total}`}</Text>
                  <Button
                    key="page-down"
                    hotkey="j"
                    plain
                    dimColor
                    label={lang === 'es' ? '↓ siguientes' : '↓ next'}
                    onPress={() => update($, pageAtom, () => Math.min(page.start + page.size, Math.max(0, page.total - page.size)))}
                  />
                  <Button
                    key="page-up"
                    hotkey="k"
                    plain
                    dimColor
                    label={lang === 'es' ? '↑ anteriores' : '↑ previous'}
                    onPress={() => update($, pageAtom, () => Math.max(0, page.start - page.size))}
                  />
                </Box>
              )}
            </Box>
          </Box>
        )}
        <Box position="absolute" bottom={0} right={0}>
          <Button
            key="toggle"
            hotkey="m"
            plain
            dimColor
            label={isExpanded ? (lang === 'es' ? '▴ menos' : '▴ less') : lang === 'es' ? '▾ más' : '▾ more'}
            onPress={() => update($, expandedAtom, value => !value)}
          />
        </Box>
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
    return status ? statusOutput($, status[1] ?? '') : next(e)
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
          <Text bold color="subtle">wololo · runs</Text>
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
        if (dialog?.mode === 'review') await finishReview($, false)
        else await update($, dialogAtom, () => null)
      })
    }
    return closed
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: CONFIG_PANE }, async ($, e) => {
    const els = $.ui.resolve(e) as unknown as Els
    const { Box, Button, Text } = els
    const dialog = await read($, dialogAtom)
    const lang: 'es' | 'en' = (run?.lang ?? config.languages.chat) === 'en' ? 'en' : 'es'
    const es = lang === 'es'
    if (!dialog) return <Text dimColor>{es ? 'No hay nada abierto. /wololo config lo abre.' : 'Nothing open. /wololo config opens it.'}</Text>
    const effective = effectiveOf(dialog)
    const footer = dialog.message ? <Text color={dialog.message.startsWith(es ? 'Guardado' : 'Saved') ? 'success' : 'error'}>{dialog.message}</Text> : null
    const header = (
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text bold color="claude" wrap="truncate-end">
          {`wololo · ${dialog.mode === 'review' ? 'init' : 'config'} · ${dialog.projectKey.replace('__', '/')}${dialog.dirty ? (es ? ' · sin guardar' : ' · unsaved') : ''}`}
        </Text>
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
      </Box>
    )

    if (dialog.mode === 'review') {
      if (dialog.step === 'summary') {
        const lines = summarize(dialog.files.project)
        return (
          <Box flexDirection="column">
            {header}
            <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginTop={1}>
              <Text bold>{es ? 'Config detectada' : 'Detected config'}</Text>
              {lines.length === 0 && <Text color="subtle">{es ? 'Nada distinto de los defaults.' : 'Nothing differs from the defaults.'}</Text>}
              {lines.map(line => (
                <Text color="subtle">{line}</Text>
              ))}
            </Box>
            <Box flexDirection="row" columnGap={3} marginTop={1}>
              <Button key="save-as-is" hotkey="g" variant="primary" label={es ? 'Guardar así' : 'Save as is'} onPress={async () => (await saveConfig($, lang)) && finishReview($, true)} />
              <Button key="review" hotkey="r" label={es ? 'Revisar por secciones' : 'Review by section'} onPress={() => update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, step: 'choose' } : d))} />
              <Button key="cancel" hotkey="c" label={es ? 'Cancelar' : 'Cancel'} onPress={() => finishReview($, false)} />
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
                  if (dialog.chosen.length > 0) await update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, step: 'section', cursor: 0 } : d))
                  else if (await saveConfig($, lang)) await finishReview($, true)
                }}
              />
              <Button key="back" hotkey="b" label={es ? 'Atrás' : 'Back'} onPress={() => update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, step: 'summary' } : d))} />
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
                if (!isLast) await update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, cursor: d.cursor + 1 } : d))
                else if (await saveConfig($, lang)) await finishReview($, true)
              }}
            />
            <Button
              key="back"
              hotkey="b"
              label={es ? 'Atrás' : 'Back'}
              onPress={() => update($, dialogAtom, (d): ConfigDialog | null => (d ? (d.cursor > 0 ? { ...d, cursor: d.cursor - 1 } : { ...d, step: 'choose' }) : d))}
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
            <Text bold color="subtle">{es ? 'Secciones' : 'Sections'}</Text>
            {SECTIONS.map((item, index) =>
              index === dialog.section ? (
                <Text inverse bold color="suggestion">{` ${item.title[lang]} `}</Text>
              ) : (
                <Button key={`section-${item.id}`} plain dimColor label={item.title[lang]} onPress={() => update($, dialogAtom, (d): ConfigDialog | null => (d ? { ...d, section: index } : d))} />
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
          <Text color="subtle">{es ? 'Tab/flechas recorren · Enter elige · Esc cierra' : 'Tab/arrows move · Enter picks · Esc closes'}</Text>
        </Box>
        {footer}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await read($, viewAtom)
    const { Box, Button, Text } = $.ui.resolve(e)
    if (!view) return <Text dimColor>No active wololo run in this session.</Text>
    const tab = await read($, tabAtom)
    const withDetail = await read($, detailAtom)
    const lang = run?.lang ?? 'es'
    const band = view.band
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
          <Text bold wrap="truncate-end">
            {band.title}
          </Text>
          <Box flexShrink={0}>
            <Button key="close" hotkey="x" plain label={lang === 'es' ? '× cerrar' : '× close'} onPress={() => void $.ui.close({ id: PANE }).catch(() => undefined)} />
          </Box>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text inverse bold color={paint(band.tone)}>{` ${band.badge} `}</Text>
          <Text bold>{band.stage}</Text>
          {band.detail !== '' && <Text color={paint(band.tone)}>{`· ${band.detail}`}</Text>}
        </Box>
        {(band.agents ?? []).length > 0 && (
          <Box flexDirection="row">
            {fitChips(band.agents ?? [], Math.max(20, e.props.bodyColumns)).flatMap((chip, index) => [
              ...(index > 0 ? [<Text color="subtle">{' · '}</Text>] : []),
              <Text color={paint(chip.color)}>{chip.label}</Text>,
            ])}
          </Box>
        )}
        {band.progress && (
          <Box flexDirection="column" marginTop={1}>
            <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
              <Box flexDirection="row">
                {thinBar(band.progress.segments, Math.max(24, e.props.bodyColumns - 7)).map(part => (
                  <Text color={!part.filled ? 'subtle' : part.state === 'done' ? paint('success') : paint(band.tone)}>{part.text}</Text>
                ))}
              </Box>
              <Box flexShrink={0}>
                <Text bold>{`${band.progress.percent}%`}</Text>
              </Box>
            </Box>
            <Box flexDirection="row">
              {barLabels(band.progress.segments, Math.max(24, e.props.bodyColumns - 7)).map(label => (
                <Text color={label.state === 'current' ? paint(band.tone) : label.state === 'done' ? 'text' : 'subtle'} bold={label.state === 'current'}>
                  {label.text}
                </Text>
              ))}
            </Box>
          </Box>
        )}
        <Box flexDirection="row" columnGap={3} marginTop={1}>
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
                    await update($, pageAtom, () => -1)
                    void $.ui.focus({ requestId: PANE, key: `tab-${item.id}` }).catch(() => undefined)
                  }}
                />
              ))}
          {tab === 'history' && (
            <Button
              key="detail"
              hotkey="d"
              plain
              dimColor
              label={detailLabel(lang, withDetail)}
              onPress={() => update($, detailAtom, value => !value)}
            />
          )}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {tabRows(view, tab, withDetail, lang).map(row => (
            <Text color={paint(row.tone)}>{row.text || ' '}</Text>
          ))}
        </Box>
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

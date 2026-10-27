import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register } from 'claude-code'

import { type Config, DEFAULT_CONFIG, expand, merge, parseJson, planTouched, ports, projectKey, resolve, slugify, touchedPattern, validate } from './config'
import {
  type EventType,
  type Live,
  type Run,
  type RunEvent,
  type Source,
  STAGES,
  apply,
  clip,
  rebuild,
  deriveStatus,
  effectiveStatus,
  emptyRun,
  header,
  isTerminal,
  nextSeq,
  sinceLastSeen,
} from './model'
import { GITHUB_BODY_LIMIT, type PublishKind, decide, ghArgs, urlIn } from './github'
import { type PolicyContext, commandRules, isAllowedBash, isAllowedPath, isInside, isReadInside, pushDenial, segments } from './policy'
import { type Field, SECTIONS, fieldValue, parseInput, setAt, summarize } from './configui'
import { helpLangOf, helpSections, helpText } from './help'
import { type Entry, formatEntry, historyMarkdown, timeline } from './history'
import { checkEvent, hintFor, stageForFile } from './rules'
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
import { type StatusCard, buildView, statusCards, statusTable } from './ui'

type Engine = EngineInterface

const TOOL_PREFIX = 'mcp__wololo__'
const PANE = 'wololo'
const TICK_MS = 1_000
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

async function settlePermission($: Engine, toolUseId: string, outcome: 'approved' | 'denied' | 'not_run') {
  const asked = pendingPermission
  if (!asked) return
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
  if (tab === 'summary') return view.details
  if (tab === 'items') {
    return view.items.length > 0
      ? view.items
      : [{ text: lang === 'es' ? 'El plan todavía no tiene ítems.' : 'The plan has no items yet.', tone: 'subtle' }]
  }
  const rows = withDetail ? view.historyAll : view.history
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

function policyContext(): PolicyContext | null {
  if (!run || run.outcome || !paths) return null
  const rules = commandRules(
    [
      ...config.tests.suite,
      ...config.tests.e2e,
      ...config.tests.touched.map(entry => entry.cmd),
      ...config.commands.start.map(start => start.cmd),
    ],
    touchedPattern,
  )
  return { branch: run.project.branch, workdir: workdir(), runDir: runDir(paths, run.id), ...rules }
}

function workdir(): string {
  return run ? (run.project.worktree ?? run.project.path) : ''
}

function contextLine(): string {
  if (!run || !paths) return ''
  return `wololo: run ${run.id} is active in this session (stage ${run.stage?.id ?? 'none'}, status ${run.status}, mode ${run.mode}). Run files: ${runDir(paths, run.id)}. Skill files: ${root}. Record every transition with ${TOOL_PREFIX}event.`
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

async function refresh($: Engine, ts?: number) {
  if (!run) {
    await update($, viewAtom, () => null)
    return
  }
  const at = ts ?? (await nowSeconds($))
  const status = deriveStatus(run, live)
  const previous = run.status
  run.status = status
  const history = historyCache && pending.length === 0 ? historyCache : undefined
  const view = buildView(run, status, recent, at, paths ? runDir(paths, run.id) : undefined, history)
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
    .catch(() => undefined)
  return ok({ opened: true, placed: opened, project_key: info.key, project_path: projectPath })
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
  if (run) config = (await loadConfig($, run.project.key)).config
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
  const stamp = statusStamp(ts, run?.lang ?? config.languages.chat)
  statusRenders.set(stamp, statusCards(runs, ts))
  return { text: [statusTable(runs, ts), '', stamp].join('\n') }
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

async function heartbeat($: Engine) {
  if (!run || !paths || run.outcome) return
  const ts = await nowSeconds($)
  run.owner.heartbeat_at = ts
  config = (await loadConfig($, run.project.key)).config
  if (run.items.total > 0 && (run.items.list ?? []).length < run.items.total && pending.length === 0) {
    const revived = await reviveRun($, run.id)
    if (revived) run = { ...revived, owner: run.owner, status: run.status, last_user_at: run.last_user_at }
  }
  await reconcileAgents($, ts)
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
  const loaded = await loadConfig($, info.key)
  config = loaded.config
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
  const mode = ['full', 'checkpoints', 'guided'].includes(String(input.mode)) ? String(input.mode) : config.autonomy
  const risk = ['low', 'high', 'unknown'].includes(String(input.risk)) ? String(input.risk) : 'unknown'

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

  return ok({
    run_id: id,
    run_dir: runDir(paths, id),
    header: header(run, run.status, ts),
    mode,
    risk,
    slot,
    ports: ports(config, slot),
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

async function recordEvent($: Engine, input: Record<string, unknown>): Promise<string> {
  if (!run || !paths) return fail('No active run in this session. Start one with /wololo, or resume one with /wololo resume <run>.')
  const type = String(input.type ?? '')
  const data = isObject(input.data) ? input.data : {}
  const problem = checkEvent(run, type, data)
  if (problem) return fail(problem)
  await emit($, type as EventType, data)
  if (type === 'run.finished') await flush($)
  const ts = await nowSeconds($)
  return ok({ ok: true, header: header(run, run.status, ts), status: run.status, hint: hintFor(type, data, root) })
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
    return ok({
      project_key: info.key,
      project_path: info.mainPath,
      global_config_path: paths.globalConfig,
      project_config_path: projectConfigPath(paths, info.key),
      project_config_exists: loaded.projectExists,
      errors: loaded.errors,
      effective: loaded.config,
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
  const id = String(input.run_id ?? '')
  if (run && !run.outcome && run.id !== id)
    return fail(`Run ${run.id} is active in this session; finish or cancel it before resuming another.`)
  const target = await reviveRun($, id)
  if (!target) return fail(`No run ${id} in ${paths.runs}.`)
  const ts = await nowSeconds($)
  const status = effectiveStatus(target, ts)
  if (isTerminal(status)) return fail(`Run ${id} already finished (${status}).`)
  if (target.owner.session_id !== sessionId && status !== 'orphaned') {
    return fail(`Run ${id} is owned by a live session (heartbeat ${Math.round(ts - target.owner.heartbeat_at)}s ago). Resume it there.`)
  }
  const dir = runDir(paths, id)
  const events = await readEvents($, dir)
  run = target
  historyCache = undefined
  recent = events.slice(-RECENT)
  pending = []
  config = (await loadConfig($, target.project.key)).config
  live = { isTurnRunning: true, question: null, permission: null }
  await emit($, 'owner.changed', { session_id: sessionId, cwd: await $.session.cwd() })
  await flush($)
  await writePointer($)
  return ok({
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
    inputSchema: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'] },
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
      suite: tests.suite,
      suite_runs: tests.suite_runs,
      e2e: tests.e2e,
      e2e_runs: tests.e2e_runs,
      e2e_needs_servers: tests.e2e.length > 0 && config.commands.start.length > 0,
    })
  }
  const changed = await changedFiles($, workdir(), run.project.base ?? config.pr.base)
  const plan = planTouched(changed, tests)
  return ok({
    ...common,
    ...plan,
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
      paths = pathsFor(dataRoot(options, home))
      sessionId = await $.session.id()

      for (const tool of TOOLS) await $.tool.register({ ...tool, isDeferred: false })
      await $.command
        .register({ name: 'wololo-more', description: 'Expands or collapses the wololo card above the prompt' })
        .catch(() => undefined)
      await $.command
        .register({ name: 'wololo-config', description: "Opens wololo's config: this project's and yours" })
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
          recent = (await readEvents($, runDir(paths, loaded.id))).slice(-RECENT)
          config = (await loadConfig($, loaded.project.key)).config
          await refresh($)
          if (config.view.pane === 'auto') void $.ui.open({ id: PANE, title: `wololo · ${loaded.id}` }).catch(() => undefined)
        }
      }

      timer?.cancel()
      timer = $.clock.every(TICK_MS, () => {
        if (isWriting) return
        isWriting = true
        void quietly(async () => {
          ticks += 1
          if (ticks % HEARTBEAT_TICKS === 0) await heartbeat($)
          if (ticks % REDRAW_TICKS === 0 && run && !run.outcome) await refresh($)
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
    if (!e.agentId && e.approver === 'person' && e.tool_use_id) {
      const what = describeCall(e.tool, input)
      live.permission = what ? `${e.tool} · ${what}` : e.tool
      pendingPermission = { toolUseId: e.tool_use_id, tool: e.tool, what }
      await quietly(() => emit($, 'permission.asked', { tool: e.tool, what }))
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    const ctx = policyContext()
    const input = isObject(e.tool_input) ? e.tool_input : {}
    if (!ctx || !config.permissions.auto_allow) return next(e)
    const path = typeof input.file_path === 'string' ? input.file_path : null
    const isPolicyAllowed =
      (e.tool_name === 'Bash' && typeof input.command === 'string' && isAllowedBash(input.command, ctx)) ||
      (path !== null && isAllowedPath(path, ctx)) ||
      isReadInside(e.tool_name, input, ctx)
    if (!isPolicyAllowed) return next(e)
    return {
      decision: {
        behavior: 'allow' as const,
        updatedPermissions: [{ type: 'addDirectories' as const, directories: [ctx.workdir, ctx.runDir], destination: 'session' as const }],
      },
    }
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool.startsWith(TOOL_PREFIX)) {
      const input = e as unknown as Record<string, unknown>
      const text = await handleOwnTool($, tool.slice(TOOL_PREFIX.length), input).catch(error => fail(String(error)))
      const context = reorient && run ? [orientation()] : undefined
      if (context) reorient = false
      return context ? { result: text, context } : { result: text }
    }
    if (!run || run.outcome) return next(e)

    if (pendingPermission && pendingPermission.toolUseId !== e.tool_use_id)
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
          await emit($, 'question.answered', { pairs, response: typeof result?.response === 'string' ? result.response : null })
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
      const role = e.subagentType.startsWith('wololo:') ? e.subagentType.slice('wololo:'.length) : e.subagentType
      await emit($, 'agent.started', {
        id: spawned.agentId,
        role,
        description: e.description,
        model: e.model ?? null,
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

  on('turn.complete', async ($, e, next) => {
    await quietly(async () => {
      if (!run || run.outcome) return
      if (e.agentId !== undefined) {
        const agent = run.agents.find(a => a.id === e.agentId && a.finished_at === null)
        if (agent) await emit($, 'agent.finished', { id: agent.id, role: agent.role, status: e.isAborted ? 'killed' : 'completed' })
        return
      }
      live.isTurnRunning = false
      await settlePermission($, '', 'not_run')
      live.permission = null
      lastTurnEndAt = await nowSeconds($)
      await refresh($)
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
      const context = [contextLine(), ...(reorient ? [orientation()] : [])]
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await read($, viewAtom)
    if (!view || !config.view.band || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const band = view.band
    const isExpanded = await read($, expandedAtom)
    const tab = await read($, tabAtom)
    const withDetail = await read($, detailAtom)
    const lang = run?.lang ?? 'es'
    const mark = { done: '✓', current: '▶', pending: '·' } as const
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={paint(band.tone)} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
          <Text bold>{band.title}</Text>
          <Box flexDirection="row" columnGap={2}>
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
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text inverse bold color={paint(band.tone)}>{` ${band.badge} `}</Text>
          <Text bold>{band.stage}</Text>
          {band.detail !== '' && <Text color={paint(band.tone)}>{`· ${band.detail}`}</Text>}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {band.pills.map(pill => (
            <Text
              color={pill.state === 'current' ? paint(band.tone) : pill.state === 'done' ? paint('success') : 'subtle'}
              bold={pill.state === 'current'}
            >
              {`${mark[pill.state]} ${pill.label}`}
            </Text>
          ))}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text bold color={band.modeLine.color}>{`${band.modeLine.icon} ${band.modeLine.name}`}</Text>
          <Text color="subtle">{`· ${band.modeLine.hint}`}</Text>
        </Box>
        {isExpanded && (
          <Box flexDirection="column" marginTop={1}>
            <Box flexDirection="row" columnGap={3}>
              {TABS.map(item =>
                item.id === tab ? (
                  <Text inverse bold color="suggestion">{` ${item.key}: ${tabName(lang, item.id)} `}</Text>
                ) : (
                  <Button
                    key={`tab-${item.id}`}
                    hotkey={item.key}
                    plain
                    dimColor
                    label={tabName(lang, item.id)}
                    onPress={() => update($, tabAtom, () => item.id)}
                  />
                ),
              )}
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
              {tabRows(view, tab, withDetail, lang).map(row => (
                <Text color={paint(row.tone)}>{row.text || ' '}</Text>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    )
  })

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

  on('command.run', { command: 'wololo-help' }, async () => ({ text: helpText(run?.lang ?? config.languages.chat) }))

  on('command.run', { command: 'wololo-config' }, async $ => ({ text: configOpened(await openConfig($, 'config')) }))

  on('command.run', { command: 'wololo' }, async ($, e, next) => {
    const args = String(e.args ?? '').trim()
    if (/^help\b/.test(args)) return { text: helpText(run?.lang ?? config.languages.chat) }
    if (/^config\b/.test(args)) return { text: configOpened(await openConfig($, 'config')) }
    const status = /^status\b\s*(.*)$/.exec(args)
    return status ? statusOutput($, status[1] ?? '') : next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const helpLang = helpLangOf(e.props.text)
    if (helpLang) {
      const { Box, Text } = $.ui.resolve(e)
      const sections = helpSections(helpLang)
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
                    <Text>{line.text}</Text>
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
      <Text bold color="claude">
        {`wololo · ${dialog.mode === 'review' ? 'init' : 'config'} · ${dialog.projectKey.replace('__', '/')}${dialog.dirty ? (es ? ' · sin guardar' : ' · unsaved') : ''}`}
      </Text>
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
        <Text bold>{band.title}</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text inverse bold color={paint(band.tone)}>{` ${band.badge} `}</Text>
          <Text bold>{band.stage}</Text>
          {band.detail !== '' && <Text color={paint(band.tone)}>{`· ${band.detail}`}</Text>}
        </Box>
        <Box flexDirection="row" columnGap={3} marginTop={1}>
          {TABS.map(item =>
                item.id === tab ? (
                  <Text inverse bold color="suggestion">{` ${item.key}: ${tabName(lang, item.id)} `}</Text>
                ) : (
                  <Button
                    key={`tab-${item.id}`}
                    hotkey={item.key}
                    plain
                    dimColor
                    label={tabName(lang, item.id)}
                    onPress={() => update($, tabAtom, () => item.id)}
                  />
                ),
              )}
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

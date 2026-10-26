import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { type Config, DEFAULT_CONFIG, expand, parseJson, planTouched, ports, projectKey, resolve, slugify, touchedPattern } from './config'
import {
  type EventType,
  type Live,
  type Run,
  type RunEvent,
  type Source,
  STAGES,
  apply,
  deriveStatus,
  effectiveStatus,
  emptyRun,
  header,
  isTerminal,
  nextSeq,
  sinceLastSeen,
} from './model'
import { type PolicyContext, commandRules, isAllowedBash, isAllowedPath, isInside, isReadInside, pushDenial, segments } from './policy'
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
  writeJson,
} from './store'
import { buildView, statusTable } from './ui'

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
const headers = new Map<string, string>()

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
  const view = buildView(run, status, recent, at)
  await update($, viewAtom, () => view)
  if (config.view.statusline) $.ui.status(view.statusLine)
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
  }
  if (isDirty) {
    isDirty = false
    await writeJson($, `${dir}/run.json`, run)
  }
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
  const target = await loadRun($, paths, id)
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
      "Records a transition or a fact of the active run so the person can see it (band, pane, status line, dashboards). The run refuses transitions out of order: a skipped stage, a gate resolved without the person's answer. Types: stage.entered {stage, reason?}, stage.completed {stage, note?}, gate.requested {gate}, gate.resolved {gate, outcome: approved|changes|rejected, by: user|auto}, risk.set {risk, reason}, plan.ready {items:[titles]}, item.started {n, title, reversal?}, item.verified {n, result: pass|fail, tree}, item.reviewed {n, findings, verdict}, item.committed {n, sha, title}, debate.turn {stage, role, round, model, verdict, file}, assumption {text, stage}, decision {text, by}, corrected {text}, blocked {reason}, unblocked {}, ci.updated {state: pending|passing|failing}, pr.opened {url, number, draft}, pr.ready {}, screenshot.saved {file, caption}, run.finished {outcome: done|failed|cancelled, summary}.",
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
        scope: { type: 'string', enum: ['run', 'since_last_seen', 'all', 'config'] },
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
    name: 'tests',
    description:
      'Says which tests to run now, from the config\'s tests block. scope "touched": the test files this run created or changed (committed or not) against its base, grouped into ready-to-run commands, plus the ones no configured command matches. scope "suite": the full-suite and e2e commands, and whether they run locally or are left to CI. Run every command it returns exactly as written, from the work tree.',
    inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['touched', 'suite'] } }, required: ['scope'] },
  },
]

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

      const cwd = e.cwd || (await $.session.cwd())
      const info = await projectInfo($, cwd)
      config = (await loadConfig($, info?.key ?? '__none__')).config
      await registerRoles($, config.models)

      const pointer = await readJson<{ run_id?: string }>($, `${paths.sessions}/${sessionId}.json`)
      if (pointer?.run_id) {
        const loaded = await loadRun($, paths, pointer.run_id)
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
    }
    if (!e.agentId && e.approver === 'person' && e.tool_use_id) {
      live.permission = e.tool
      await quietly(() => emit($, 'permission.asked', { tool: e.tool }))
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

    const clearPermission = async () => {
      if (live.permission === null) return
      live.permission = null
      await emit($, 'permission.resolved', {})
    }

    try {
      if (e.tool === 'AskUserQuestion' && !e.agentId) {
        await clearPermission()
        const first = e.questions[0]
        const question = first ? `${first.header}: ${first.question}` : 'question'
        live.question = question
        await emit($, 'question.asked', { question, count: e.questions.length })
        try {
          return await next(e)
        } finally {
          live.question = null
          await emit($, 'question.answered', {})
        }
      }

      if (e.tool === 'Read' && !e.agentId && e.file_path.startsWith(`${root}/stages/`)) {
        const ran = await next(e)
        const hinted = stageForFile(e.file_path.slice(`${root}/stages/`.length))
        if (!hinted || hinted === run.stage?.id || ran.deny !== undefined) return ran
        const note = `wololo: these are the instructions for ${hinted}, but the run is in ${run.stage?.id ?? 'no stage yet'}. Record stage.entered {stage: "${hinted}"} with ${TOOL_PREFIX}event before working on it.`
        return { ...ran, context: [...(ran.context ?? []), note] }
      }

      if (e.tool === 'Bash' && e.run_in_background) {
        const ran = await next(e)
        await clearPermission()
        const taskId =
          ran.deny === undefined && !ran.isError ? (ran.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId : undefined
        if (taskId)
          await emit($, 'task.started', { id: taskId, label: e.description ?? e.command.slice(0, 60), kind: classifyTask(e.command) })
        return ran
      }

      return await next(e)
    } finally {
      await quietly(clearPermission)
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
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {view.band.map(row => (
          <Text color={row.tone}>{row.text}</Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await read($, viewAtom)
    const { Box, Text } = $.ui.resolve(e)
    if (!view) return <Text dimColor>No active wololo run in this session.</Text>
    const room = Math.max(1, (e.viewport?.rows ?? 40) - 2)
    return (
      <Box flexDirection="column">
        {view.pane.slice(0, room).map(row => (
          <Text color={row.tone}>{row.text || ' '}</Text>
        ))}
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

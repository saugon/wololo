import { type TestBody, expect, mock, test } from 'claude-code/testing'

import type { Run } from '../hooks/model'

const HOME = '/home/t'
const REPO = '/repo'
const DATA = `${HOME}/.claude/wololo`

// before runs ahead of a git command (its arguments), a clock read, or a file read, existence check, listing, write, stat or append (its
// path), to act in the middle of a call. A reason it returns refuses the call (a hook that throws is skipped, so a refusal is the way to fail
// one); an exit code ends a git command or an append with it, nothing written.
type BeforeKind = 'git' | 'clock.now' | 'fs.read' | 'fs.exists' | 'fs.list' | 'fs.write' | 'fs.stat' | 'append'
type Before = (kind: BeforeKind, what: string) => string | number | undefined | Promise<string | number | undefined>
// commands holds every process the plugin ran, its argv joined.
type Host = { opens: Array<{ id: string; focus?: boolean }>; files: Map<string, string>; gh: string[]; tools: Map<string, boolean>; ps: Map<string, string>; dead: Set<string>; stubborn: Set<string>; killed: string[]; shells: string[]; answers: Array<{ match: RegExp; stdout: string; exit: number }>; git: Map<string, string>; commands: string[]; before: Before }

function fakeHost(on: Parameters<TestBody>[1], options: { clock?: boolean; unplaced?: string; session?: () => string } = {}): Host {
  const opens: Array<{ id: string; focus?: boolean }> = []
  const files = new Map<string, string>()
  const gh: string[] = []
  const tools = new Map<string, boolean>()
  const ps = new Map<string, string>()
  const killed: string[] = []
  const dead = new Set<string>()
  const shells: string[] = []
  const answers: Array<{ match: RegExp; stdout: string; exit: number }> = []
  // What a git command answers, by its arguments, beside the ones every test gets.
  const git = new Map<string, string>()
  const host: Host = { opens, files, gh, tools, ps, dead, stubborn: new Set<string>(), killed, shells, answers, git, commands: [], before: () => undefined }

  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.id', () => ({ value: options.session?.() ?? 's1' }))
  on('session.cwd', () => ({ value: REPO }))
  on('tool.register', (_, e) => {
    tools.set(e.name, e.isDeferred === true)
    return { value: { tool: `mcp__wololo__${e.name}` } }
  })
  on('agent.register', (_, e) => ({ value: { agent: `wololo:${e.name}` } }))
  on('agent.list', () => ({ value: [] }))
  on('ui.open', (_, e) => {
    opens.push({ id: e.id, ...(e.focus ? { focus: true } : {}) })
    return { value: options.unplaced ? { isPlaced: false, reason: options.unplaced } : { isPlaced: true } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
  on('fs.read', async (_, e) => {
    const refused = await host.before('fs.read', e.path)
    if (typeof refused === 'string') return { deny: refused }
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', async (_, e) => {
    const refused = await host.before('fs.write', e.path)
    if (typeof refused === 'string') return { deny: refused }
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', async (_, e) => {
    const refused = await host.before('fs.exists', e.path)
    if (typeof refused === 'string') return { deny: refused }
    return { value: files.has(e.path) || [...files.keys()].some(k => k.startsWith(`${e.path}/`)) }
  })
  on('fs.stat', async (_, e) => {
    const refused = await host.before('fs.stat', e.path)
    if (typeof refused === 'string') return { deny: refused }
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.list', async (_, e) => {
    const refused = await host.before('fs.list', e.path)
    if (typeof refused === 'string') return { deny: refused }
    const names = new Map<string, 'file' | 'dir'>()
    for (const key of files.keys()) {
      if (!key.startsWith(`${e.path}/`)) continue
      const rest = key.slice(e.path.length + 1)
      const [name, ...more] = rest.split('/')
      if (name) names.set(name, more.length > 0 ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', async (_, e) => {
    host.commands.push(e.argv.join(' '))
    const [cmd, ...args] = e.argv
    const done = (stdout = '', exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (cmd === '/bin/mv') {
      const [, from, to] = args
      if (from && to && files.has(from)) {
        files.set(to, files.get(from) ?? '')
        files.delete(from)
      }
      return done()
    }
    if (cmd === '/bin/sh') {
      const path = args[3] ?? ''
      const refused = await host.before('append', path)
      if (typeof refused === 'string') return { deny: refused }
      if (typeof refused === 'number') return done('', refused)
      files.set(path, (files.get(path) ?? '') + (e.init?.stdin ?? ''))
      return done()
    }
    if (cmd === 'ps') {
      const shown = ps.get(args[args.length - 1] ?? '')
      return shown === undefined ? done('', 1) : done(shown)
    }
    if (cmd === 'sh' && args[0] === '-c') {
      const line = args[1] ?? ''
      shells.push(line)
      const found = answers.find(answer => answer.match.test(line))
      return found ? done(found.stdout, found.exit) : done('', 127)
    }
    if (cmd === 'kill') {
      if (args[0] === '-0') return done('', dead.has(args[1] ?? '') ? 1 : 0)
      killed.push(args.join(' '))
      // A group sent TERM or KILL is gone, unless it ignores the TERM: the cleanup's kill -0 then finds nothing.
      if (args[1] && !(args[0] === '-TERM' && host.stubborn.has(args[1]))) dead.add(args[1])
      return done()
    }
    if (cmd === 'lsof') {
      const found = answers.find(answer => answer.match.test(`lsof ${args.join(' ')}`))
      return found ? done(found.stdout, found.exit) : done('', 1)
    }
    if (cmd === 'gh') {
      gh.push(args.join(' '))
      const found = answers.find(answer => answer.match.test(`gh ${args.join(' ')}`))
      if (found) return done(found.stdout, found.exit)
      return done('https://github.com/acme/shop/issues/12\n')
    }
    if (cmd === 'git') {
      const line = args.join(' ')
      const refused = await host.before('git', line)
      if (typeof refused === 'string') return { deny: refused }
      if (typeof refused === 'number') return done('', refused)
      const known = git.get(line)
      if (known !== undefined) return done(known)
      if (line === 'rev-parse --show-toplevel') return done(REPO)
      if (line.startsWith('rev-parse --path-format=absolute --git-common-dir')) return done(`${REPO}/.git`)
      if (line === 'remote get-url origin') return done('git@github.com:acme/shop.git')
      if (line === 'rev-parse HEAD') return done('5ha1')
    }
    return done('', 1)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  if (options.clock !== false) {
    on('clock.every', () => ({ value: undefined }))
    let now = 1_800_000_000_000
    on('clock.now', async () => {
      const refused = await host.before('clock.now', '')
      return typeof refused === 'string' ? { deny: refused } : { value: (now += 1_000) }
    })
  }
  on('tool.check', (_, e) => ({ decision: e.tool === 'AskUserQuestion' ? ('allow' as const) : ('ask' as const) }))
  return host
}

// Holds a call where a before hook awaits hold: reached settles once it got there, and open lets it go on.
function gate(): { hold: () => Promise<void>; reached: Promise<void>; open: () => void } {
  let open = () => undefined as void
  let arrive = () => undefined as void
  const opened = new Promise<void>(resolve => {
    open = resolve
  })
  const reached = new Promise<void>(resolve => {
    arrive = resolve
  })
  return {
    hold: async () => {
      arrive()
      await opened
    },
    reached,
    open: () => open(),
  }
}

// Real time passing, for work in flight to move on; the tests' types leave the runtime's timers out.
function pause(ms: number): Promise<void> {
  const timers = globalThis as unknown as { setTimeout: (done: () => void, ms: number) => unknown }
  return new Promise(resolve => {
    timers.setTimeout(resolve, ms)
  })
}

function parse(result: unknown): Record<string, unknown> {
  const text = typeof result === 'string' ? result : JSON.stringify(result)
  if (text.startsWith('ERROR')) throw new Error(text)
  return JSON.parse(text) as Record<string, unknown>
}

test('start writes the run, the band shows it, questions are recorded, a push to main is refused', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', (_, e) =>
    e.tool === 'AskUserQuestion'
      ? { result: { questions: [], answers: { 'Approve the spec?': 'Aprobar' } } }
      : { result: {} },
  )

  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })

  const started = await $.tool.call({
    tool: 'mcp__wololo__start',
    source: { kind: 'github_issue', ref: '12' },
    title: 'Partial payments',
  } as never)
  const answer = parse(started.result)
  expect(answer.branch).toBe('feat/12-partial-payments')
  const runId = String(answer.run_id)
  expect(answer.worktree).toBe(`/repo/.claude/worktrees/wololo-${runId}`)
  expect(host.files.get('/repo/.git/info/exclude')).toBe('/.claude/worktrees/\n')
  expect(answer.project_key).toBe('acme__shop')
  expect(host.files.has(`${DATA}/runs/${runId}/run.json`)).toBe(true)
  expect(host.files.get(`${DATA}/runs/${runId}/events.jsonl`)).toContain('"run.started"')
  expect(host.files.has(`${DATA}/sessions/s1.json`)).toBe(true)

  const entered = parse(
    (await $.tool.call({ tool: 'mcp__wololo__event', type: 'stage.entered', data: { stage: 'context' } } as never)).result,
  )
  expect(entered).toEqual({ ok: true, status: 'running', hint: expect.stringMatching(/^Read .*\/stages\/01-context\.md before working on this stage\.$/) })
  const got = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)
  expect(got.header).toBe('[wololo #12 · 1/8 Contexto · ⟳ trabajando]')
  const short = await $.ui.mount({
    plugin: 'wololo',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 140, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  })
  expect((await short.find({ type: 'Text', text: /%$/ }))?.text).toBe('6%')
  expect((await short.find({ type: 'Text', text: /checkpoints$/ }))?.text).toBe('⏸ checkpoints')
  await short.unmount()
  const probe = await $.ui.mount({
    plugin: 'wololo',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 40, bodyColumns: 140, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect((await probe.find({ type: 'Text', text: /Partial payments$/ }))?.text).toBe('#12 Partial payments')
  expect((await probe.find({ type: 'Text', text: /TRABAJANDO/ }))?.text).toBe(' ⟳ TRABAJANDO ')
  expect((await probe.find({ type: 'Text', text: /^Contexto$/ }))?.text).toBe('Contexto')
  expect((await probe.find({ type: 'Text', text: /^Rev\s+$/ }))?.text?.trim()).toBe('Rev')
  expect((await probe.find({ type: 'Text', text: /%$/ }))?.text).toBe('6%')
  expect((await probe.find({ type: 'Text', text: /checkpoints$/ }))?.text).toBe('⏸ checkpoints')
  expect((await probe.find({ type: 'Text', text: /^━+$/ }))?.text.length).toBeGreaterThan(0)
  const runFiles = { type: 'Text', text: new RegExp(`^ +${DATA}/runs/`) } as const
  expect(await probe.find(runFiles)).toBeUndefined()
  await probe.press({ key: 'toggle' })
  expect((await probe.find({ type: 'Text', text: /^etapas$/ }))?.text).toBe('etapas')
  expect(await probe.find(runFiles)).toBeUndefined()
  await probe.press({ key: 'tab-detail' })
  expect((await probe.find({ type: 'Text', text: /^archivos$/ }))?.text).toBe('archivos')
  expect((await probe.find(runFiles))?.text).toContain(`${DATA}/runs/`)
  await probe.press({ key: 'tab-items' })
  expect((await probe.find({ type: 'Text', text: /todavía no tiene ítems/ }))?.text).toBe('El plan todavía no tiene ítems.')
  await probe.press({ key: 'tab-history' })
  expect((await probe.find({ type: 'Text', text: /Run iniciado/ }))?.text).toContain('▶ Run iniciado: Partial payments')
  expect(await probe.find(runFiles)).toBeUndefined()
  await probe.press({ key: 'detail' })
  expect((await probe.find({ type: 'Text', text: /Etapa 1\/8 Contexto/ }))?.text).toContain('→ Etapa 1/8 Contexto')
  await probe.press({ key: 'tab-detail' })
  expect((await probe.find(runFiles))?.text).toContain(`${DATA}/runs/`)
  await probe.press({ key: 'toggle' })
  expect(await probe.find(runFiles)).toBeUndefined()
  expect((await probe.find({ type: 'Text', text: /TRABAJANDO/ }))?.text).toBe(' ⟳ TRABAJANDO ')
  await probe.unmount()

  await $.tool.call({ tool: 'mcp__wololo__event', type: 'blocked', data: { reason: 'needs a signature' } } as never)
  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'Approve the spec?', header: 'Gate A', options: [], multiSelect: false }],
  } as never)
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  const log = host.files.get(`${DATA}/runs/${runId}/events.jsonl`) ?? ''
  const types = log
    .trim()
    .split('\n')
    .map(line => (JSON.parse(line) as { type: string }).type)
  expect(types.slice(-4)).toEqual(['blocked', 'question.asked', 'question.answered', 'unblocked'])
  const state = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)
  expect((state.run as { blocked: unknown }).blocked).toBe(null)
  const history = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'history' } as never)).result)
  expect((history.lines as string[]).some(line => line.endsWith('? Gate A: Approve the spec? → Aprobar'))).toBe(true)
  expect(host.files.get(`${DATA}/runs/${runId}/history.md`)).toContain('Gate A: Approve the spec? → Aprobar')

  const refused = await $.tool.check({ tool: 'Bash', input: { command: 'git push origin main' } } as never)
  expect(refused.decision).toBe('deny')
  const allowed = await $.tool.check({ tool: 'Bash', input: { command: 'git push -u origin feat/12-partial-payments' } } as never)
  expect(allowed.decision).toBe('allow')
  const agent = await $.tool.check({ tool: 'Agent', input: { subagent_type: 'wololo:implementer', description: 'item 1', prompt: 'x' } } as never)
  expect(agent.decision).toBe('allow')
  const other = await $.tool.check({ tool: 'Agent', input: { subagent_type: 'general-purpose', description: 'x', prompt: 'x' } } as never)
  expect(other.decision).toBe('ask')
})

test('publish sends a summary when the text does not fit, and nothing to GitHub when to_github is off', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Big spec' } as never)).result)
  host.files.set('/tmp/body.md', 'x'.repeat(70_000))
  host.files.set('/tmp/summary.md', 'short version')

  const refused = parse((await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'issue_body', number: 12, body_file: '/tmp/body.md' } as never)).result)
  expect(refused.published).toBe(false)
  expect(host.gh).toEqual([])

  const sent = parse(
    (await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'issue_body', number: 12, body_file: '/tmp/body.md', summary_file: '/tmp/summary.md' } as never)).result,
  )
  expect(sent).toEqual({ published: true, mode: 'summary', url: 'https://github.com/acme/shop/issues/12', full_text: '/tmp/body.md', length: 70_000 })
  expect(host.gh).toEqual(['issue edit 12 --body-file /tmp/summary.md'])
})

test('the run follows its base when the branch moves onto another one, by hand or by opening the PR against it', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Stacked', flags: ['--base=feat/11-envios'] } as never)).result)
  const base = async () => ((parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as Run).project.base)
  expect(await base()).toBe('feat/11-envios')

  parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'base.changed', data: { to: 'origin/release/2.4', reason: 'feat/11-envios merged' } } as never)).result)
  expect(await base()).toBe('release/2.4')

  host.files.set('/tmp/pr-body.md', 'body')
  const sent = parse(
    (await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'pr_create', title: 'feat: x', base: 'main', head: 'feat/12-stacked', body_file: '/tmp/pr-body.md' } as never)).result,
  )
  expect(sent.published).toBe(true)
  expect(await base()).toBe('main')
  const history = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'history' } as never)).result)
  expect((history.lines as string[]).filter(line => line.includes('Base'))).toHaveLength(2)
})

test('publish pr_ready marks the run\'s draft PR ready through the mod and records pr.ready', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Ready' } as never)).result)
  parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'pr.opened', data: { url: 'https://github.com/acme/shop/pull/40', number: 40, draft: true } } as never)).result)
  const sent = parse((await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'pr_ready' } as never)).result)
  expect(sent.published).toBe(true)
  expect(host.gh).toContain('pr ready 40')
  const state = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)
  expect((state.run as Run).pr?.state).toBe('ready')
})

test('with spec.to_github off, issue writes stay in files unless the person asked for one', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ spec: { to_github: false } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Local only' } as never)).result)
  host.files.set('/tmp/body.md', 'spec')
  const answer = parse((await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'issue_body', number: 12, body_file: '/tmp/body.md' } as never)).result)
  expect(answer.published).toBe(false)
  expect(host.gh).toEqual([])
  const asked = parse(
    (await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'issue_body', number: 12, body_file: '/tmp/body.md', person_asked: true } as never)).result,
  )
  expect(asked.published).toBe(true)
  expect(host.gh).toEqual(['issue edit 12 --body-file /tmp/body.md'])
  // The PR is not the issue: its body is updated whatever spec.to_github says.
  host.files.set('/tmp/pr-body.md', 'pr')
  const pr = parse((await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'pr_body', number: 40, body_file: '/tmp/pr-body.md' } as never)).result)
  expect(pr.published).toBe(true)
  expect(host.gh).toEqual(['issue edit 12 --body-file /tmp/body.md', 'pr edit 40 --body-file /tmp/pr-body.md'])
})

test('outside its own repository, nothing the run leaves on GitHub names wololo', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ branch: 'wololo/{ref}-{slug}' }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Pagos' } as never)).result)
  expect(started.branch).toBe('wololo/12-pagos')

  host.files.set('/tmp/body.md', 'Pagos parciales.')
  host.files.set('/tmp/pr-body.md', 'Done.\n\nThe full spec is kept in wololo run shop-12-abc.')
  const refused = parse((await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'pr_body', number: 40, body_file: '/tmp/pr-body.md' } as never)).result)
  expect(refused.published).toBe(false)
  expect(String(refused.reason)).toContain('wololo run shop-12-abc')
  const titled = parse(
    (await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'issue_create', title: 'wololo: pagos', body_file: '/tmp/body.md' } as never)).result,
  )
  expect(titled.published).toBe(false)
  expect(host.gh).toEqual([])
  const asked = parse(
    (await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'pr_body', number: 40, body_file: '/tmp/pr-body.md', person_asked: true } as never)).result,
  )
  expect(asked.published).toBe(true)

  const named = String((await $.tool.call({ tool: 'mcp__wololo__event', type: 'branch.named', data: { slug: 'split payments' } } as never)).result)
  expect(named).toContain('names wololo')
  const push = await $.tool.check({ tool: 'Bash', input: { command: 'git push -u origin wololo/12-pagos' } } as never)
  expect(push.decision).toBe('deny')
  expect(push.reason).toContain('git branch -m wololo/12-pagos')
})

test("the run's slot follows the instance the project gave its work tree, and the summary shows that instance's databases", async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('tool.call', () => ({ result: {} }))
  host.files.set(
    `${DATA}/projects/acme__shop/config.json`,
    JSON.stringify({
      commands: { start: [{ name: 'backend', cmd: 'make backend.run', port: '4000+10*{slot}' }] },
      instance: { read: 'cat .vertex-inst', databases: ['shop_dev_{slot}', 'shop_test_{slot}'] },
    }),
  )
  host.answers.push({ match: /cat \.vertex-inst/, stdout: '3\n', exit: 0 })
  host.ps.set(
    'command=',
    [
      '/nix/store/x-postgresql-18.1/bin/postgres -D /home/t/pg -k /home/t/pg',
      'postgres: checkpointer ',
      'postgres: postgres shop_test_3 127.0.0.1(53111) idle',
      'postgres: postgres shop_test_3 127.0.0.1(53112) idle',
      'postgres: postgres shop_dev_5 [local] idle',
    ].join('\n'),
  )
  host.files.set('/home/t/pg/postgresql.conf', 'max_connections = 100\nmax_connections = 300\n')
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result)
  expect(started.slot).toBe(1)
  await clock.advance(15_000)
  const state = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)
  expect((state.run as Run).slot).toBe(3)
  expect((state.ports as Array<{ name: string; port: number }>).map(p => [p.name, p.port])).toEqual([['backend', 4030]])
  const history = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'history', include_minor: true } as never)).result)
  expect((history.lines as string[]).some(line => line.includes('Instancia del proyecto: 3 (slot 1)'))).toBe(true)
  expect(host.commands).toContain('ps -A -o command=')
})

test('an instance the person asked for holds over the work tree\'s until it is cleared', async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('tool.call', () => ({ result: {} }))
  host.files.set(
    `${DATA}/projects/acme__shop/config.json`,
    JSON.stringify({
      commands: { start: [{ name: 'backend', cmd: 'make backend.run', port: '4000+10*{slot}' }] },
      instance: { read: 'cat .vertex-inst', databases: ['shop_dev_{slot}'] },
    }),
  )
  host.answers.push({ match: /cat \.vertex-inst/, stdout: '9\n', exit: 0 })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)
  await clock.advance(15_000)
  expect(String((await $.tool.call({ tool: 'mcp__wololo__event', type: 'instance.used', data: { slot: 6 } } as never)).result)).toContain('data.reason')
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'instance.used', data: { slot: 6, reason: 'the person tests on 6' } } as never)
  await clock.advance(15_000)
  const held = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)
  expect((held.run as Run).slot).toBe(6)
  expect((held.ports as Array<{ name: string; port: number }>).map(p => [p.name, p.port])).toEqual([['backend', 4060]])
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'instance.used', data: { slot: null } } as never)
  await clock.advance(15_000)
  const back = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)
  expect((back.run as Run).slot).toBe(9)
})

test('the branch gets its name from the spec, by the config template, until it is on origin', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Pagos parciales' } as never)).result)
  expect(started.branch).toBe('feat/12-pagos-parciales')
  host.git.set('branch -m feat/12-pagos-parciales feat/12-split-payments', '')
  const named = parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'branch.named', data: { slug: 'Split payments' } } as never)).result)
  expect(named.branch).toBe('feat/12-split-payments')
  const run = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as Run
  expect(run.project.branch).toBe('feat/12-split-payments')
  expect(host.commands).toContain('git branch -m feat/12-pagos-parciales feat/12-split-payments')

  host.git.set('ls-remote --exit-code --heads origin feat/12-split-payments', 'abc\trefs/heads/feat/12-split-payments')
  const refused = String((await $.tool.call({ tool: 'mcp__wololo__event', type: 'branch.named', data: { slug: 'partial payments' } } as never)).result)
  expect(refused).toContain('already on origin')
})

test('launch flags change the config for that run only, and an unknown one is refused', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ spec: { to_github: false } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const refused = (await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Flags', flags: ['--github-spec', '--yolo'] } as never)).result
  expect(String(refused)).toContain('unknown flag --yolo')
  const started = parse(
    (await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Flags', flags: ['--full', '--review-pr', '--github-spec', '--base=release/2.4'] } as never)).result,
  )
  const config = started.config as { spec: { to_github: boolean }; review: { approval: string } }
  expect([started.mode, started.base, config.spec.to_github, config.review.approval]).toEqual(['full', 'release/2.4', true, 'local'])
  const shown = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'config' } as never)).result)
  expect(shown.run_flags).toEqual({ 'spec.to_github': true, 'pr.base': 'release/2.4' })
  expect((shown.effective as { spec: { to_github: boolean } }).spec.to_github).toBe(true)
  host.files.set('/tmp/body.md', 'spec')
  const sent = parse((await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'issue_body', number: 12, body_file: '/tmp/body.md' } as never)).result)
  expect(sent.published).toBe(true)
})


test('a run whose snapshot predates the items list is rebuilt from its events on load', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const dir = `${DATA}/runs/repo-txt-abc123`
  const ev = (seq: number, type: string, data: Record<string, unknown>) => JSON.stringify({ v: 1, seq, ts: 1_800_000_000 + seq, run: 'repo-txt-abc123', type, data })
  host.files.set(
    `${dir}/events.jsonl`,
    [
      ev(1, 'run.started', { title: 'Salones', source: { kind: 'text', ref: 'x', url: null }, mode: 'checkpoints', session_id: 's1', cwd: REPO }),
      ev(2, 'stage.entered', { stage: 'context' }),
      ev(3, 'plan.ready', { items: ['Back: migración', 'Back: API', 'Front: tipos'] }),
      ev(4, 'item.started', { n: 1, title: 'Back: migración' }),
      ev(5, 'item.committed', { n: 1, sha: '084cc5051abc', title: 'Back: migración' }),
      ev(6, 'item.started', { n: 2, title: 'Back: API' }),
    ].join('\n') + '\n',
  )
  host.files.set(
    `${dir}/run.json`,
    JSON.stringify({
      id: 'repo-txt-abc123',
      status: 'running',
      last_user_at: null,
      outcome: null,
      items: { done: 1, total: 3, current: { n: 2, title: 'Back: API' } },
      owner: { session_id: 's1', cwd: REPO, heartbeat_at: 1_800_000_100 },
    }),
  )
  host.files.set(`${DATA}/sessions/s1.json`, JSON.stringify({ session_id: 's1', run_id: 'repo-txt-abc123', heartbeat_at: 1_800_000_100 }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'wololo',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 40, bodyColumns: 140, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'tab-items' })
  expect((await ui.find({ type: 'Text', text: /^✓ 1\./ }))?.text).toBe('✓ 1. Back: migración  084cc5051')
  expect((await ui.find({ type: 'Text', text: /^● 2\./ }))?.text).toBe('● 2. Back: API')
  expect((await ui.find({ type: 'Text', text: /^○ 3\./ }))?.text).toBe('○ 3. Front: tipos')
  await ui.unmount()

  // The pane: each label in a gutter beside its lines when wide, above them when narrow, and the Detail tab with the run files.
  for (const bodyColumns of [120, 60]) {
    const pane = await $.ui.mount({
      plugin: 'wololo',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'wololo',
      props: { title: 'wololo', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    })
    await pane.press({ key: 'tab-summary' })
    for (const label of ['estado', 'etapa', 'etapas'])
      expect((await pane.find({ type: 'Text', text: new RegExp(`^${label}$`) }))?.text).toBe(label)
    expect((await pane.find({ type: 'Text', text: /^Salones$/ }))?.text).toBe('Salones')
    expect(await pane.find({ type: 'Text', text: /^ahora$/ })).toBeUndefined()
    expect((await pane.find({ type: 'Text', text: /^\S+ Contexto$/ }))?.text).toBe('‖ Contexto')
    await pane.press({ key: 'tab-detail' })
    expect((await pane.find({ type: 'Text', text: /^archivos$/ }))?.text).toBe('archivos')
    expect((await pane.find({ type: 'Text', text: new RegExp(`^${DATA}/runs/repo-txt-abc123`) }))?.text).toContain(`${DATA}/runs/`)
    await pane.unmount()
  }
})

test('while the pane is drawn, the card above the prompt steps aside', async ($, on) => {
  fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  let paneShown = true
  on('ui.panes', () => ({ value: paneShown ? [{ id: 'wololo', title: 'wololo', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Salones' } as never)
  const card = () =>
    $.ui.mount({
      plugin: 'wololo',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true, maxRows: 40, bodyColumns: 140, scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
  const hidden = await card()
  expect(await hidden.find({ type: 'Text', text: /Salones/ })).toBeUndefined()
  await hidden.unmount()
  paneShown = false
  const shown = await card()
  expect((await shown.find({ type: 'Text', text: /Salones/ }))?.text).toContain('Salones')
  await shown.unmount()
})

test('/wololo-status draws every active run as a card', async ($, on) => {
  fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result)
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'stage.entered', data: { stage: 'context' } } as never)
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'assumption', data: { text: 'solo mesas', stage: 'context' } } as never)
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'doing', data: { text: 'Leyendo cómo se cobra una mesa hoy' } } as never)
  const ran = await $.command.run({ command: 'wololo-status', args: '' } as never)
  expect(ran.text).toContain('#12')
  const ui = await $.ui.mount({
    plugin: 'wololo',
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'wololo-status', args: '', text: ran.text ?? '', isErrored: false },
  })
  expect((await ui.find({ type: 'Text', text: /^shop · / }))?.text).toBe('shop · #12 Partial payments')
  expect((await ui.find({ type: 'Text', text: /TRABAJANDO/ }))?.text).toBe(' ⟳ TRABAJANDO ')
  expect((await ui.find({ type: 'Text', text: /^1\/8/ }))?.text).toBe('1/8 Contexto')
  expect((await ui.find({ type: 'Text', text: /Leyendo/ }))?.text).toBe('  → Leyendo cómo se cobra una mesa hoy')
  expect((await ui.find({ type: 'Text', text: /Último/ }))?.text).toMatch(/^  Último: · Supuesto: solo mesas · hace /)
  expect((await ui.find({ type: 'Text', text: new RegExp(String(started.run_id)) }))?.text).toBe(`  ${String(started.run_id)}`)
  await ui.unmount()
  const viaSkill = await $.command.run({ command: 'wololo', args: 'status' } as never)
  expect(viaSkill.text).toContain('#12')
  const again = await $.ui.mount({
    plugin: 'wololo',
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'wololo', args: 'status', text: `wololo: ${viaSkill.text ?? ''}`, isErrored: false },
  })
  expect((await again.find({ type: 'Text', text: /TRABAJANDO/ }))?.text).toBe(' ⟳ TRABAJANDO ')
  await again.unmount()
})

test('/wololo help lists every command and key as a card', async ($, on) => {
  fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const help = await $.command.run({ command: 'wololo', args: 'help' } as never)
  expect(help.text).toContain('/wololo pause: termina el paso en curso y se pausa, para poder cerrar la sesión')
  expect(help.text).not.toContain('—')
  const ui = await $.ui.mount({
    plugin: 'wololo',
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'wololo', args: 'help', text: `wololo: ${help.text ?? ''}`, isErrored: false },
  })
  expect((await ui.find({ type: 'Text', text: /^Seguir un run$/ }))?.text).toBe('Seguir un run')
  expect((await ui.find({ type: 'Text', text: /^r · d · i · h$/ }))?.text).toBe('r · d · i · h')
  expect((await ui.find({ type: 'Text', text: /^pestañas/ }))?.text).toBe('pestañas: Resumen, Detalle, Ítems, Historial')
  await ui.unmount()
  const direct = await $.command.run({ command: 'wololo-help', args: '' } as never)
  expect(direct.text).toBe(help.text)
})

const CONFIG_PANE = {
  plugin: 'wololo',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'wololo-config',
  props: { title: 'wololo · config', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

test('/wololo config edits a radio and a checkbox and saves the project file', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  on('ui.close', () => ({ value: undefined }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ tests: { suite: ['make test'] } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const opened = await $.command.run({ command: 'wololo', args: 'config' } as never)
  expect(opened.text).toContain('config está abierta')
  const ui = await $.ui.mount(CONFIG_PANE)
  expect((await ui.find({ type: 'Text', text: / Autonomía / }))?.text).toBe(' Autonomía ')
  await ui.press({ key: 'autonomy=full' })
  await ui.press({ key: 'permissions.auto_allow' })
  expect((await ui.find({ type: 'Text', text: /sin guardar/ }))?.text).toContain('acme/shop · sin guardar')
  await ui.press({ key: 'save' })
  expect(JSON.parse(host.files.get(`${DATA}/projects/acme__shop/config.json`) ?? '{}')).toEqual({
    tests: { suite: ['make test'] },
    autonomy: 'full',
    permissions: { auto_allow: false },
  })
  await ui.press({ key: 'section-tests' })
  expect((await ui.find({ type: 'Text', text: /^Qué tests corre/ }))?.text).toBe('Qué tests corre y cuándo')
  await ui.unmount()
})

test('init shows what it found, asks the first-time questions and saves only what differs from the defaults', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  on('ui.close', () => ({ value: undefined }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const answer = parse((await $.tool.call({ tool: 'mcp__wololo__review_config', proposal: { tests: { suite: ['make test'], suite_runs: 'ci' } } } as never)).result)
  expect(answer.opened).toBe(true)
  const ui = await $.ui.mount(CONFIG_PANE)
  expect((await ui.find({ type: 'Text', text: 'make test' }))?.text).toBe('make test')
  expect((await ui.find({ type: 'Text', text: '¿Cuánto te pregunta el run?' }))).toBeDefined()
  await ui.press({ key: 'init-autonomy-full' })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'init-autonomy-guided' })
  await ui.press({ key: 'init-isolation-worktree' })
  await ui.press({ key: 'init-approval-pr' })
  await ui.press({ key: 'init-pr-draft' })
  // The proposal said CI, so CI is what is drawn as picked.
  expect((await ui.find({ key: 'init-suite-ci' }))?.text).toMatch(/● en CI/)
  await ui.press({ key: 'init-suite-ci' })
  await ui.press({ key: 'init-spec-yes' })
  await ui.press({ key: 'save-as-is' })
  expect(JSON.parse(host.files.get(`${DATA}/projects/acme__shop/config.json`) ?? '{}')).toEqual({
    tests: { suite: ['make test'], suite_runs: 'ci' },
    autonomy: 'guided',
    review: { approval: 'pr' },
  })
  await ui.unmount()
})

test('init skips the suite question when the project has no suite, and adjusts more by section', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  on('ui.close', () => ({ value: undefined }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__wololo__review_config', proposal: { pr: { base: 'develop' } } } as never)
  const ui = await $.ui.mount(CONFIG_PANE)
  for (const key of ['init-autonomy-checkpoints', 'init-isolation-branch', 'init-approval-local', 'init-pr-none']) await ui.press({ key })
  expect(await ui.find({ key: 'init-suite-local' })).toBeUndefined()
  await ui.press({ key: 'init-spec-no' })
  await ui.press({ key: 'review' })
  await ui.press({ key: 'choose-autonomy' })
  await ui.press({ key: 'continue' })
  await ui.press({ key: 'autonomy=full' })
  await ui.press({ key: 'next' })
  expect(JSON.parse(host.files.get(`${DATA}/projects/acme__shop/config.json`) ?? '{}')).toEqual({
    pr: { base: 'develop', enabled: false },
    isolation: 'branch',
    spec: { to_github: false },
    autonomy: 'full',
  })
  await ui.unmount()
})

test('a /wololo run in a project without its config opens the init pane at once, and review_config fills it', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  on('ui.close', () => ({ value: undefined }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'wololo', args: 'status' } as never)
  expect(host.opens.filter(open => open.id === 'wololo-config')).toEqual([])
  await $.command.run({ command: 'wololo', args: 'una app para ver los runs' } as never).catch(() => undefined)
  expect(host.opens.filter(open => open.id === 'wololo-config')).toEqual([{ id: 'wololo-config' }])
  const ui = await $.ui.mount(CONFIG_PANE)
  expect(await ui.find({ type: 'Text', text: /^Leyendo el repo/ })).toBeDefined()
  expect(await ui.find({ key: 'init-autonomy-checkpoints' })).toBeUndefined()
  const answer = parse((await $.tool.call({ tool: 'mcp__wololo__review_config', proposal: { tests: { suite: ['make test'] } } } as never)).result)
  expect(answer.opened).toBe(true)
  expect(host.opens.at(-1)).toEqual({ id: 'wololo-config', focus: true })
  expect(await ui.find({ key: 'init-autonomy-checkpoints' })).toBeDefined()
  await ui.unmount()
})

test('a /wololo run opens no init pane when the project has its config, or when it runs in full', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'wololo', args: '#12 --full' } as never).catch(() => undefined)
  host.files.set(`${DATA}/projects/acme__shop/config.json`, '{}')
  await $.command.run({ command: 'wololo', args: '#12' } as never).catch(() => undefined)
  expect(host.opens.filter(open => open.id === 'wololo-config')).toEqual([])
})

test('the init review says so when its pane cannot be shown, instead of claiming it opened', async ($, on) => {
  const host = fakeHost(on, { unplaced: 'unasked pane below 144 columns (now 120)' })
  const closed: string[] = []
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const answer = String((await $.tool.call({ tool: 'mcp__wololo__review_config', proposal: { tests: { suite: ['make test'] } } } as never)).result)
  expect(answer).toMatch(/^ERROR: The config pane could not be shown \(unasked pane below 144 columns/)
  expect(closed).toEqual(['wololo-config'])
  expect(host.files.has(`${DATA}/projects/acme__shop/config.json`)).toBe(false)
})

test('the expanded card draws its whole tab for the engine to scroll, with a way back at both ends', async ($, on) => {
  fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result)
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'stage.entered', data: { stage: 'context' } } as never)
  for (const stage of ['definition', 'gate_a']) await $.tool.call({ tool: 'mcp__wololo__event', type: 'stage.entered', data: { stage } } as never)
  const ui = await $.ui.mount({
    plugin: 'wololo',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 22, bodyColumns: 140, scroll: { offset: 0, bodyRows: 22 }, view: {} },
  })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Button', key: 'page-down' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'pane' })).toBeUndefined()
  await ui.redraw({ hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 140, scroll: { offset: 0, bodyRows: 8 }, view: {} })
  expect((await ui.findAll({ type: 'Text' })).length).toBeGreaterThan(8)
  expect(await ui.find({ type: 'Button', key: 'toggle-end' })).toBeDefined()
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toContain('más')
  expect(await ui.find({ type: 'Button', key: 'toggle-end' })).toBeUndefined()
  await ui.unmount()
})

test('/wololo pause asks the run to pause, and resume clears it', async ($, on) => {
  fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result)
  const asked = await $.command.run({ command: 'wololo', args: 'pause' } as never)
  expect(asked.text).toContain('pausa pedida')
  const pausing = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)
  expect((pausing.run as { status: string }).status).toBe('pausing')
  expect(pausing.header).toContain('⏸ pausando')
  const paused = parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'paused', data: { note: 'ítem 3 commiteado; sigue el 4' } } as never)).result)
  expect(paused.status).toBe('paused')
  const resumed = parse((await $.tool.call({ tool: 'mcp__wololo__resume' } as never)).result)
  expect(resumed.stage).toBe(null)
  const after = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)
  expect((after.run as { paused: unknown; pause_requested_at: unknown }).paused).toBe(null)
  expect((after.run as { pause_requested_at: unknown }).pause_requested_at).toBe(null)
})

// The tool's input arrives frozen, so these tests freeze the data the way the engine hands it over.
const eventLines = (host: Host, runId: string) =>
  (host.files.get(`${DATA}/runs/${runId}/events.jsonl`) ?? '')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { seq: number; type: string; data: Record<string, unknown> })

test('an approved gate is recorded with its snapshot when its data arrives frozen', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', (_, e) => (e.tool === 'AskUserQuestion' ? { result: { questions: [], answers: { '¿Aprobás la spec?': 'Aprobar' } } } : { result: {} }))
  host.git.set('rev-parse HEAD^{tree}', '7ree')
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const runId = String(parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result).run_id)
  for (const stage of ['context', 'definition', 'gate_a']) parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'stage.entered', data: { stage } } as never)).result)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: '¿Aprobás la spec?', header: 'Aprobar spec', options: [], multiSelect: false }] } as never)
  const data = Object.freeze({ gate: 'gate_a', outcome: 'approved', by: 'user' })
  parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'gate.resolved', data } as never)).result)
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  const resolved = eventLines(host, runId).find(line => line.type === 'gate.resolved')
  expect(resolved?.data.snapshot).toEqual({ spec: null, plan: null, tree: '7ree' })
})

test('a verified and a committed item keep their trees when their data arrives frozen', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  for (const line of ['read-tree HEAD', 'add -A']) host.git.set(line, '')
  host.git.set('write-tree', '7ree')
  host.git.set('rev-parse c0mm1t^{tree}', '7ree')
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result)
  const runId = String(started.run_id)
  expect(started.worktree).toBe(`/repo/.claude/worktrees/wololo-${runId}`)
  const event = async (type: string, data: Record<string, unknown>) => parse((await $.tool.call({ tool: 'mcp__wololo__event', type, data } as never)).result)
  await event('plan.ready', { items: ['Back: API'] })
  await event('item.started', { n: 1, title: 'Back: API' })
  await event('item.verified', Object.freeze({ n: 1, result: 'pass' }))
  await event('item.reviewed', { n: 1, findings: 0, verdict: 'ok' })
  await event('item.committed', Object.freeze({ n: 1, sha: 'c0mm1t', title: 'Back: API' }))
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  const logged = eventLines(host, runId)
  expect(logged.find(line => line.type === 'item.verified')?.data.worktree_tree).toBe('7ree')
  expect(logged.find(line => line.type === 'item.committed')?.data.commit_tree).toBe('7ree')
})

test('every model request and every second are counted in the stage they ran in', async ($, on) => {
  fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  let usd = 1
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd } } }))
  const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 10, model: 'claude-opus-5-5' }
  on('turn.step', async function* (_, e) {
    usd += e.agentId ? 0.25 : 0.5
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result)
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'stage.entered', data: { stage: 'context' } } as never)
  const step = async (agentId?: string) => {
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) } as never)
    for await (const _ of stream) void _
    await stream.result
  }
  await step()
  await step()
  await step('agent-unknown')
  await $.turn.complete({ turnId: 't1', reason: 'end_turn', text: '', answer: '', isAborted: false } as never)
  const got = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)
  const context = (got.run as { usage: Record<string, { usd: number; output: number; cache_read: number; roles: Record<string, { usd: number; tokens: number }> }> }).usage.context
  expect(context?.output).toBe(150)
  expect(context?.cache_read).toBe(3_000)
  expect(Math.round((context?.usd ?? 0) * 100)).toBe(125)
  expect(context?.roles.main).toEqual({ usd: 1, tokens: 2_320 })
  expect(Math.round((context?.roles.other?.usd ?? 0) * 100)).toBe(25)
  const timeOf = (value: Record<string, unknown>) => (value.run as { time: Record<string, Record<string, number>> }).time.context
  expect(timeOf(got)?.work).toBeGreaterThan(0)
  expect(timeOf(got)?.you).toBe(undefined)
  await $.turn.complete({ turnId: 't2', reason: 'end_turn', text: '', answer: '', isAborted: false } as never)
  const later = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)
  expect(timeOf(later)?.you).toBeGreaterThan(0)
})

test('a permission counts as waiting only when its dialog opens, and an ask a hook answers is never one', async ($, on) => {
  fakeHost(on)
  let answer: 'allow' | 'none' = 'allow'
  const seen: string[] = []
  const run = async () => parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as { status: string; waiting: unknown }
  on('classic.PermissionRequest', () => (answer === 'allow' ? { decision: { behavior: 'allow' as const } } : {}))
  on('tool.call', async () => {
    seen.push(`running:${(await run()).status}`)
    return { result: {} }
  })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result)
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'stage.entered', data: { stage: 'context' } } as never)
  await $.tool.call({ tool: 'Bash', command: 'make slow' } as never)
  expect(seen).toHaveLength(1)
  expect(seen[0]).not.toBe('running:waiting_permission')
  answer = 'none'
  await $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/x' } as never)
  const lines = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'history', include_minor: true } as never)).result).lines as string[]
  expect(lines.filter(line => /permiso|permission/i.test(line)).length).toBeGreaterThan(0)
  expect(lines.some(line => line.includes('make slow'))).toBe(false)
  expect((await run()).waiting).toBe(null)
})

test('the background tasks of a session are closed as gone when its process exits', async ($, on) => {
  fakeHost(on)
  let next = 0
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { result: { backgroundTaskId: `t${++next}` } } : { result: {} }))
  on('session.end', (_, e) => e)
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' as const } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result)
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'stage.entered', data: { stage: 'context' } } as never)
  await $.tool.call({ tool: 'Bash', command: 'make backend.run', run_in_background: true, description: 'Backend' } as never)
  await $.tool.call({ tool: 'Bash', command: 'make frontend.run', run_in_background: true, description: 'Frontend' } as never)
  const open = async () =>
    ((parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as { tasks: Array<{ id: string; finished_at: number | null }> }).tasks)
      .filter(task => task.finished_at === null)
      .map(task => task.id)
  expect(await open()).toEqual(['t1', 't2'])
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1' } as never)
  expect(await open()).toEqual([])
})

test('a background task stopped with TaskStop is closed, so the run stops waiting on it', async ($, on) => {
  fakeHost(on)
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { result: { backgroundTaskId: 't1' } } : { result: {} }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' as const } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'stage.entered', data: { stage: 'context' } } as never)
  await $.tool.call({ tool: 'Bash', command: 'gh pr checks 7 --watch', run_in_background: true, description: 'Watch CI' } as never)
  const state = async () => parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as Run
  expect((await state()).tasks.find(task => task.id === 't1')?.finished_at).toBe(null)
  await $.tool.call({ tool: 'TaskStop', task_id: 't1' } as never)
  expect((await state()).tasks.find(task => task.id === 't1')).toMatchObject({ status: 'killed' })
})

test('/clear lets go of the run: it is paused with no card, and /wololo resume takes it back right away', async ($, on) => {
  let session = 's1'
  const host = fakeHost(on, { session: () => session })
  on('tool.call', () => ({ result: {} }))
  on('session.end', (_, e) => e)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result)
  const id = started.run_id as string
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'stage.entered', data: { stage: 'context' } } as never)

  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  session = 's2'
  expect(String((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)).toContain('No active run')
  const saved = JSON.parse(host.files.get(`${DATA}/runs/${id}/run.json`) ?? '{}') as { paused: { note: string } | null; owner: { session_id: string } }
  expect(saved.paused?.note).toContain('/clear')
  expect(saved.owner.session_id).toBe('s1')

  const resumed = parse((await $.tool.call({ tool: 'mcp__wololo__resume', run_id: id } as never)).result)
  expect(resumed.stage).toBe('context')
  const back = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as Run
  expect([back.owner.session_id, back.paused]).toEqual(['s2', null])
})

test('/clear takes down the card of a run that already finished', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  on('session.end', (_, e) => e)
  const id = 'repo-txt-done01'
  const dir = `${DATA}/runs/${id}`
  const ev = (seq: number, type: string, data: Record<string, unknown>) => JSON.stringify({ v: 1, seq, ts: 1_800_000_000 + seq, run: id, type, data })
  host.files.set(
    `${dir}/events.jsonl`,
    [
      ev(1, 'run.started', { title: 'Salones', source: { kind: 'text', ref: 'x', url: null }, mode: 'checkpoints', session_id: 's1', cwd: REPO }),
      ev(2, 'stage.entered', { stage: 'definition' }),
      ev(3, 'run.finished', { outcome: 'done', summary: 's' }),
    ].join('\n') + '\n',
  )
  host.files.set(`${dir}/run.json`, JSON.stringify({ id, status: 'done', outcome: 'done', owner: { session_id: 's1', cwd: REPO, heartbeat_at: 1_800_000_300 } }))
  host.files.set(`${DATA}/sessions/s1.json`, JSON.stringify({ session_id: 's1', run_id: id, heartbeat_at: 1_800_000_300 }))
  let view: unknown = { band: { title: 'old' } }
  on('state.get', (_, e, next) => (e.key === 'view' ? { value: { value: view, version: 1 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.key === 'view') view = (e as unknown as { value: unknown }).value
    return next(e)
  })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  expect(view).not.toBe(null)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  expect(view).toBe(null)
  expect(eventLines(host, id).map(line => line.type)).toEqual(['run.started', 'stage.entered', 'run.finished'])
})

test('a permission wait left by an earlier load of the mod is cleared when the session takes the run back', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const dir = `${DATA}/runs/repo-txt-perm01`
  const ev = (seq: number, type: string, data: Record<string, unknown>) => JSON.stringify({ v: 1, seq, ts: 1_800_000_000 + seq, run: 'repo-txt-perm01', type, data })
  host.files.set(
    `${dir}/events.jsonl`,
    [
      ev(1, 'run.started', { title: 'Salones', source: { kind: 'text', ref: 'x', url: null }, mode: 'checkpoints', session_id: 's1', cwd: REPO }),
      ev(2, 'stage.entered', { stage: 'evidence' }),
      ev(3, 'permission.asked', { tool: 'Bash', what: 'for i in $(seq 240)' }),
    ].join('\n') + '\n',
  )
  host.files.set(`${dir}/run.json`, JSON.stringify({ id: 'repo-txt-perm01', status: 'waiting_permission', outcome: null, owner: { session_id: 's1', cwd: REPO, heartbeat_at: 1_800_000_100 } }))
  host.files.set(`${DATA}/sessions/s1.json`, JSON.stringify({ session_id: 's1', run_id: 'repo-txt-perm01', heartbeat_at: 1_800_000_100 }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const got = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as { status: string; waiting: unknown }
  expect(got.waiting).toBe(null)
  expect(got.status).not.toBe('waiting_permission')
})

// Another instance of the mod owns the session until this one claims the atom. The test's $ has no state noun, so its hooks answer for it;
// set hands the atom to another instance again, release gives it back to this one, holder says which other instance holds it, null while
// this one does, and onClaim runs each time this one claims it.
type Owner = { set: (id: string) => void; release: () => void; holder: () => string | null; onClaim: () => void }
function otherOwner(on: Parameters<TestBody>[1], id = 'other'): Owner {
  let other: string | null = id
  const owner: Owner = {
    set: next => {
      other = next
    },
    release: () => {
      other = null
    },
    holder: () => other,
    onClaim: () => undefined,
  }
  on('state.get', (_, e, next) => (e.key === 'owner' && other !== null ? { value: { value: other, version: 1_000 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.key === 'owner') {
      other = null
      owner.onClaim()
    }
    return next(e)
  })
  return owner
}

// The session's other tools answer; wololo's own reach no other load of the mod beneath this one, so a call it passes on fails.
function answerOtherTools(on: Parameters<TestBody>[1]) {
  on('tool.call', (_, e, next) => (String(e.tool).startsWith('mcp__wololo__') ? next(e) : { result: {} }))
}

// A run of this session left on disk by an earlier load of the mod, its events up to seq 3.
function seedRun(host: Host, id: string, options: { waiting: boolean }) {
  const dir = `${DATA}/runs/${id}`
  const ev = (seq: number, type: string, data: Record<string, unknown>) => JSON.stringify({ v: 1, seq, ts: 1_800_000_000 + seq, run: id, type, data })
  host.files.set(
    `${dir}/events.jsonl`,
    [
      ev(1, 'run.started', { title: 'Salones', source: { kind: 'text', ref: 'x', url: null }, mode: 'checkpoints', session_id: 's1', cwd: REPO }),
      ev(2, 'stage.entered', { stage: 'evidence' }),
      options.waiting ? ev(3, 'permission.asked', { tool: 'Bash', what: 'for i in $(seq 240)' }) : ev(3, 'doing', { text: 'the evidence' }),
    ].join('\n') + '\n',
  )
  const owner = { session_id: 's1', cwd: REPO, heartbeat_at: 1_799_999_000 }
  host.files.set(`${dir}/run.json`, JSON.stringify({ id, status: options.waiting ? 'waiting_permission' : 'running', outcome: null, owner }))
  host.files.set(`${DATA}/sessions/s1.json`, JSON.stringify({ session_id: 's1', run_id: id, heartbeat_at: owner.heartbeat_at }))
}

// A run whose PR is open and in review, as a session left it.
function seedReview(host: Host, id: string) {
  const dir = `${DATA}/runs/${id}`
  const ev = (seq: number, type: string, data: Record<string, unknown>) => JSON.stringify({ v: 1, seq, ts: 1_800_000_000 + seq, run: id, type, data })
  host.files.set(
    `${dir}/events.jsonl`,
    [
      ev(1, 'run.started', {
        title: 'Catálogo',
        source: { kind: 'github_issue', ref: '4796', url: null },
        mode: 'checkpoints',
        session_id: 's1',
        cwd: REPO,
        project: { key: 'acme__shop', path: REPO, worktree: null, branch: 'feat/4796-catalogo', base: 'main' },
      }),
      ev(2, 'stage.entered', { stage: 'pr' }),
      ev(3, 'pr.opened', { url: 'https://github.com/acme/shop/pull/4813', number: 4813, draft: false }),
      ev(4, 'review.waiting', {}),
    ].join('\n') + '\n',
  )
  const owner = { session_id: 's1', cwd: REPO, heartbeat_at: 1_799_999_000 }
  host.files.set(`${dir}/run.json`, JSON.stringify({ id, status: 'in_review', outcome: null, owner }))
  host.files.set(`${DATA}/sessions/s1.json`, JSON.stringify({ session_id: 's1', run_id: id, heartbeat_at: owner.heartbeat_at }))
}

test('a run in review ends as done when its PR merges', async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('tool.call', () => ({ result: {} }))
  const id = 'repo-4796-rev001'
  seedReview(host, id)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  host.answers.push({ match: /^gh pr view 4813 --json state$/, stdout: '{"state":"OPEN"}', exit: 0 })
  await clock.advance(330_000)
  expect(eventLines(host, id).map(line => line.type)).not.toContain('pr.merged')
  host.answers.unshift({ match: /^gh pr view 4813 --json state$/, stdout: '{"state":"MERGED"}', exit: 0 })
  await clock.advance(330_000)
  const lines = eventLines(host, id)
  expect(lines.map(line => line.type).slice(-2)).toEqual(['pr.merged', 'run.finished'])
  expect(lines.at(-1)?.data).toEqual({ outcome: 'done', summary: 'PR #4813 mergeado.' })
})

test('a run finished by its PR merging stops its servers too', async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('tool.call', () => ({ result: {} }))
  const id = 'repo-4796-rev003'
  seedReview(host, id)
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ commands: { start: [{ name: 'backend', cmd: 'make backend.run', port: '4000' }] } }))
  host.files.set(`${DATA}/runs/${id}/servers.json`, JSON.stringify([{ name: 'backend', pid: 4242, port: 4000 }]))
  host.ps.set('4242', '4240 make backend.run')
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  host.answers.push({ match: /^gh pr view 4813 --json state$/, stdout: '{"state":"MERGED"}', exit: 0 })
  await clock.advance(330_000)
  expect(eventLines(host, id).map(line => line.type)).toContain('run.finished')
  expect(host.killed).toEqual(['-TERM -4240'])
})

test('a run in review whose PR is closed without merging asks the person', async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const submitted: string[] = []
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  const id = 'repo-4796-rev002'
  seedReview(host, id)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  host.answers.push({ match: /^gh pr view 4813 --json state$/, stdout: '{"state":"CLOSED"}', exit: 0 })
  await clock.advance(330_000)
  expect(eventLines(host, id).map(line => line.type)).toContain('pr.closed')
  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toContain('closed without merging')
  const run = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as Run
  expect(run.status).toBe('waiting_user')
  // Asked once: the next check sees it closed already.
  await clock.advance(330_000)
  expect(submitted).toHaveLength(1)
})

test('a session takes the run from the instance that owned it, and the permission it left waiting goes after the last seq on disk', async ($, on) => {
  const host = fakeHost(on)
  otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  seedRun(host, 'repo-txt-perm02', { waiting: true })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  expect(eventLines(host, 'repo-txt-perm02').filter(line => line.type === 'permission.resolved').map(line => line.seq)).toEqual([4])
})

test('the card of a run that finished is drawn again when the mod loads, not kept as an earlier load drew it', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const id = 'repo-txt-done02'
  const dir = `${DATA}/runs/${id}`
  const ev = (seq: number, type: string, data: Record<string, unknown>) => JSON.stringify({ v: 1, seq, ts: 1_800_000_000 + seq * 60, run: id, type, data })
  host.files.set(
    `${dir}/events.jsonl`,
    [
      ev(1, 'run.started', { title: 'Salones', source: { kind: 'text', ref: 'x', url: null }, mode: 'checkpoints', session_id: 's1', cwd: REPO }),
      ev(2, 'stage.entered', { stage: 'definition' }),
      ev(3, 'time', { stage: 'definition', kind: 'you', seconds: 120 }),
      ev(5, 'run.finished', { outcome: 'cancelled', summary: 's' }),
    ].join('\n') + '\n',
  )
  host.files.set(`${dir}/run.json`, JSON.stringify({ id, status: 'cancelled', outcome: 'cancelled', owner: { session_id: 's1', cwd: REPO, heartbeat_at: 1_800_000_300 } }))
  host.files.set(`${DATA}/sessions/s1.json`, JSON.stringify({ session_id: 's1', run_id: id, heartbeat_at: 1_800_000_300 }))
  // What an earlier load of the mod left on the card.
  const stale = { band: { title: 'old' }, details: [{ text: 'old table', tone: 'text' }] }
  let view: unknown = stale
  on('state.get', (_, e, next) => (e.key === 'view' ? { value: { value: view, version: 1 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.key === 'view') view = (e as unknown as { value: unknown }).value
    return next(e)
  })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const texts = ((view as { details?: Array<{ text: string }> } | null)?.details ?? []).map(row => row.text)
  expect(texts).not.toContain('old table')
  expect(texts.some(text => /^ +activo +esperando +total +costo$/.test(text))).toBe(true)
  // The run stays closed: nothing is written to it.
  expect(eventLines(host, id).map(line => line.type)).toEqual(['run.started', 'stage.entered', 'time', 'run.finished'])
})

test('a run whose load fails after this session took it still beats and is written by the tick', async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('tool.call', () => ({ result: {} }))
  // A hook that throws is skipped, so the card's first write is refused instead: the plugin's set rejects, once.
  let isRefused = false
  on('state.set', (_, e, next) => {
    if (e.key !== 'view' || isRefused) return next(e)
    isRefused = true
    return { deny: 'the card could not be drawn' }
  })
  const dir = `${DATA}/runs/repo-txt-load01`
  seedRun(host, 'repo-txt-load01', { waiting: false })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  expect(isRefused).toBe(true)
  expect(host.opens).toEqual([])
  expect(host.files.has(`${dir}/owner.json`)).toBe(false)
  await clock.advance(15_000)
  expect((JSON.parse(host.files.get(`${dir}/owner.json`) ?? '{}') as { heartbeat_at?: number }).heartbeat_at).toBe(1_800_000_015)
  expect((JSON.parse(host.files.get(`${dir}/run.json`) ?? '{}') as { owner?: { heartbeat_at: number } }).owner?.heartbeat_at).toBe(1_800_000_015)
})

test('an instance that lost the session drops what it had not written yet', async ($, on) => {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  seedRun(host, 'repo-txt-perm03', { waiting: true })
  const seeded = host.files.get(`${DATA}/runs/repo-txt-perm03/events.jsonl`)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  owner.set('newer')
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  expect(host.files.get(`${DATA}/runs/repo-txt-perm03/events.jsonl`)).toBe(seeded)
})

test("an instance that lost the session writes nothing from an agent's turn or the tick", async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  const dir = `${DATA}/runs/repo-txt-agent1`
  seedRun(host, 'repo-txt-agent1', { waiting: false })
  const agent = { id: 'a1', role: 'critic', description: 'critic', model: null, background: true }
  host.files.set(`${dir}/events.jsonl`, `${host.files.get(`${dir}/events.jsonl`)}${JSON.stringify({ v: 1, seq: 4, ts: 1_800_000_004, run: 'repo-txt-agent1', type: 'agent.started', data: agent })}\n`)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await clock.advance(15_000)
  const files = () => [`${dir}/events.jsonl`, `${dir}/run.json`, `${dir}/owner.json`, `${DATA}/sessions/s1.json`].map(path => host.files.get(path))
  const before = files()
  expect(before.every(text => text !== undefined)).toBe(true)
  owner.set('newer')
  await $.turn.complete({ turnId: 't1', agentId: 'a1', reason: 'end_turn', text: '', answer: '', isAborted: false } as never)
  await clock.advance(15_000)
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  expect(files()).toEqual(before)
})

test('an agent the session resumes after it finished is live again until its new turn ends', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const id = 'repo-txt-agent2'
  const dir = `${DATA}/runs/${id}`
  seedRun(host, id, { waiting: false })
  const agent = { id: 'a1', role: 'implementer', description: 'Item 11', model: 'claude-opus-5-5', background: true }
  host.files.set(`${dir}/events.jsonl`, `${host.files.get(`${dir}/events.jsonl`)}${JSON.stringify({ v: 1, seq: 4, ts: 1_800_000_004, run: id, type: 'agent.started', data: agent })}\n`)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const live = async () => ((parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as Run).agents.filter(a => a.finished_at === null).map(a => a.id))
  const complete = () => $.turn.complete({ turnId: 't1', agentId: 'a1', reason: 'end_turn', text: '', answer: '', isAborted: false } as never)
  await complete()
  expect(await live()).toEqual([])
  await $.turn.start({ turnId: 't2', agentId: 'a1', text: 'apply the review' } as never)
  expect(await live()).toEqual(['a1'])
  const resumed = eventLines(host, id).filter(line => line.type === 'agent.started').at(-1)
  expect(resumed?.data).toMatchObject({ id: 'a1', role: 'implementer', resumed: true })
  await complete()
  expect(await live()).toEqual([])
  // A turn of an agent that is still live opens nothing new.
  expect(eventLines(host, id).filter(line => line.type === 'agent.started')).toHaveLength(2)
})

test('events recorded at once get seqs that never repeat and only go up', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const runId = String(parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result).run_id)
  const steps = [1, 2, 3, 4, 5].map(n => $.tool.call({ tool: 'mcp__wololo__event', type: 'doing', data: { text: `step ${n}` } } as never))
  for (const done of await Promise.all(steps)) parse(done.result)
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  const lines = eventLines(host, runId)
  expect(lines.filter(line => line.type === 'doing')).toHaveLength(5)
  expect(lines.map(line => line.seq)).toEqual(lines.map((_, i) => i + 1))
})

test('a stalled run is not nudged by an instance that lost the session', async ($, on) => {
  fakeHost(on)
  const owner = otherOwner(on)
  const submitted: string[] = []
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X', mode: 'full' } as never)).result)
  const end = (turnId: string) => $.turn.complete({ turnId, reason: 'end_turn', text: '', answer: '', isAborted: false } as never)
  await end('t1')
  expect(submitted).toHaveLength(1)
  owner.set('newer')
  await end('t2')
  expect(submitted).toHaveLength(1)
})

test('an event whose instance loses the session while it is checked is refused, and a finished run stops nothing', async ($, on) => {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ commands: { start: [{ name: 'backend', cmd: 'INST={slot} make backend.run', port: '4000' }] } }))
  for (const line of ['read-tree HEAD', 'add -A']) host.git.set(line, '')
  host.git.set('write-tree', '7ree')
  host.git.set('rev-parse c0mm1t^{tree}', '7ree')
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result)
  const runId = String(started.run_id)
  host.files.set(`${String(started.run_dir)}/servers.json`, JSON.stringify([{ name: 'backend', pid: 4242, port: 4000 }]))
  host.ps.set('4242', '4240 make backend.run')
  const event = async (type: string, data: Record<string, unknown>) => String((await $.tool.call({ tool: 'mcp__wololo__event', type, data } as never)).result)
  await event('plan.ready', { items: ['Back: API'] })
  await event('item.started', { n: 1, title: 'Back: API' })
  await event('item.verified', { n: 1, result: 'pass' })
  await event('item.reviewed', { n: 1, findings: 0, verdict: 'ok' })
  host.before = (kind, what) => {
    if (kind === 'git' && what === 'rev-parse c0mm1t^{tree}') owner.set('newer')
    return undefined
  }
  expect(await event('item.committed', { n: 1, sha: 'c0mm1t', title: 'Back: API' })).toContain('Another wololo instance owns this run in this session')
  owner.release()
  let isArmed = true
  host.before = kind => {
    if (kind === 'clock.now' && isArmed) {
      isArmed = false
      owner.set('newer')
    }
    return undefined
  }
  expect(await event('run.finished', { outcome: 'cancelled', summary: 's' })).toContain('Another wololo instance owns this run in this session')
  expect(host.killed).toEqual([])
  owner.release()
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  expect(eventLines(host, runId).map(line => line.type)).not.toContain('item.committed')
  expect(eventLines(host, runId).map(line => line.type)).not.toContain('run.finished')
})

test('a start dropped because the instance lost the session leaves no run behind, so a resume goes on', async ($, on) => {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  seedRun(host, 'repo-txt-back01', { waiting: false })
  host.files.delete(`${DATA}/sessions/s1.json`)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  host.before = (kind, what) => {
    if (kind === 'git' && what === 'remote get-url origin') owner.set('newer')
    return undefined
  }
  const refused = String((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  expect(refused).toContain('Another wololo instance owns this run in this session')
  host.before = () => undefined
  owner.release()
  parse((await $.tool.call({ tool: 'mcp__wololo__resume', run_id: 'repo-txt-back01' } as never)).result)
  const got = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as { id: string }
  expect(got.id).toBe('repo-txt-back01')
})

const NOT_OWNER = 'Another wololo instance owns this run in this session'

test('an instance that lost the session refuses every tool that changes something, and still answers get', async ($, on) => {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  answerOtherTools(on)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const runId = String(parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result).run_id)
  owner.set('newer')
  const files = [...host.files]
  const ran = [...host.commands]
  const sent = [...host.gh]
  const calls: Array<[string, Record<string, unknown>]> = [
    ['event', { type: 'doing', data: { text: 'more' } }],
    ['start', { source: { kind: 'text', ref: 'y' }, title: 'Y' }],
    ['run_adapter', { point: 'pr' }],
    ['publish', { kind: 'issue_comment', body: 'hello' }],
    ['external_turn', { prompt: 'review this' }],
    ['review_config', { proposal: {} }],
    ['tests', { files: ['src/a.test.ts'] }],
  ]
  for (const [tool, input] of calls) {
    const answer = String((await $.tool.call({ tool: `mcp__wololo__${tool}`, ...input } as never)).result)
    expect(answer).toContain(NOT_OWNER)
    expect(answer).toContain(`/wololo resume ${runId}`)
  }
  const got = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as { id: string }
  expect(got.id).toBe(runId)
  expect([...host.files]).toEqual(files)
  expect(host.commands).toEqual(ran)
  expect(host.gh).toEqual(sent)
})

test('/wololo-pause in an instance that lost the session says so and writes nothing', async ($, on) => {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result)
  owner.set('newer')
  const files = [...host.files]
  const asked = await $.command.run({ command: 'wololo-pause' } as never)
  expect(asked.text).toContain('otra instancia de wololo es la dueña de este run')
  expect([...host.files]).toEqual(files)
})

test('a resume that cannot take the run leaves the session to the instance that owns it', async ($, on) => {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  const dir = `${DATA}/runs/repo-txt-done01`
  seedRun(host, 'repo-txt-done01', { waiting: false })
  host.files.set(`${dir}/events.jsonl`, `${host.files.get(`${dir}/events.jsonl`)}${JSON.stringify({ v: 1, seq: 4, ts: 1_800_000_004, run: 'repo-txt-done01', type: 'run.finished', data: { outcome: 'cancelled', summary: 's' } })}\n`)
  host.files.delete(`${DATA}/sessions/s1.json`)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  owner.set('newer')
  const resume = async (id: string) => String((await $.tool.call({ tool: 'mcp__wololo__resume', run_id: id } as never)).result)
  expect(await resume('repo-txt-nope00')).toContain('No run repo-txt-nope00')
  expect(owner.holder()).toBe('newer')
  expect(await resume('repo-txt-done01')).toContain('already finished')
  expect(owner.holder()).toBe('newer')
})

test('resume takes the run back from the instance that owned it, and its events are recorded again', async ($, on) => {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  answerOtherTools(on)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const runId = String(parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Partial payments' } as never)).result).run_id)
  owner.set('newer')
  const event = async () => String((await $.tool.call({ tool: 'mcp__wololo__event', type: 'doing', data: { text: 'back here' } } as never)).result)
  expect(await event()).toContain(NOT_OWNER)
  parse((await $.tool.call({ tool: 'mcp__wololo__resume', run_id: runId } as never)).result)
  expect(owner.holder()).toBe(null)
  parse(await event())
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  expect(eventLines(host, runId).filter(line => line.type === 'doing').map(line => line.data.text)).toEqual(['back here'])
})

test('a run the other instance finishes while it is resumed is not taken up, and stays finished', async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const owner = otherOwner(on)
  const submitted: string[] = []
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X', mode: 'full' } as never)).result)
  const runId = String(started.run_id)
  const dir = String(started.run_dir)
  owner.set('newer')
  // The other instance records run.finished after the resume has checked the run, just as this one takes the session.
  owner.onClaim = () => {
    owner.onClaim = () => undefined
    const finished = { v: 1, seq: 99, ts: 1_800_000_099, run: runId, type: 'run.finished', data: { outcome: 'cancelled', summary: 's' } }
    host.files.set(`${dir}/events.jsonl`, `${host.files.get(`${dir}/events.jsonl`) ?? ''}${JSON.stringify(finished)}\n`)
  }
  expect(String((await $.tool.call({ tool: 'mcp__wololo__resume', run_id: runId } as never)).result)).toContain('already finished')
  await $.turn.complete({ turnId: 't1', reason: 'end_turn', text: '', answer: '', isAborted: false } as never)
  await clock.advance(15_000)
  expect((JSON.parse(host.files.get(`${dir}/run.json`) ?? '{}') as { outcome?: unknown }).outcome).toBe('cancelled')
  expect(submitted).toEqual([])
})

test('an instance whose run another one took can resume a different run in its place', async ($, on) => {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  owner.set('newer')
  seedRun(host, 'repo-txt-other1', { waiting: false })
  parse((await $.tool.call({ tool: 'mcp__wololo__resume', run_id: 'repo-txt-other1' } as never)).result)
  const got = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as { id: string }
  expect(got.id).toBe('repo-txt-other1')
})

test('a tool an instance that lost the session refuses goes to the load of the mod beneath it', async ($, on) => {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  on('tool.call', (_, e) => ({ result: String(e.tool).startsWith('mcp__wololo__') ? 'answered by the owner' : {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  owner.set('newer')
  const files = [...host.files]
  expect((await $.tool.call({ tool: 'mcp__wololo__event', type: 'doing', data: { text: 'more' } } as never)).result).toBe('answered by the owner')
  expect([...host.files]).toEqual(files)
})

test('a resume dropped because the instance lost the session again leaves no run behind', async ($, on) => {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  seedRun(host, 'repo-txt-back02', { waiting: false })
  host.files.delete(`${DATA}/sessions/s1.json`)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  // The resume reads the clock once to check the run, and owner.changed reads it again once the resume took the session.
  let reads = 0
  host.before = kind => {
    if (kind === 'clock.now' && ++reads === 2) owner.set('newer')
    return undefined
  }
  expect(String((await $.tool.call({ tool: 'mcp__wololo__resume', run_id: 'repo-txt-back02' } as never)).result)).toContain(NOT_OWNER)
  host.before = () => undefined
  expect(String((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)).toContain('No active run in this session')
})

test('a heartbeat that loses the session halfway writes neither owner.json nor the pointer', async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const dir = String(parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result).run_dir)
  const pointer = host.files.get(`${DATA}/sessions/s1.json`)
  expect(pointer).toBeDefined()
  host.before = (kind, what) => {
    if (kind === 'git' && what.startsWith('log -1')) owner.set('newer')
    return undefined
  }
  await clock.advance(15_000)
  expect(host.files.has(`${dir}/owner.json`)).toBe(false)
  expect(host.files.get(`${DATA}/sessions/s1.json`)).toBe(pointer)
})

test('a heartbeat that loses the session after writing owner.json leaves the pointer alone', async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const dir = String(parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result).run_dir)
  const pointer = host.files.get(`${DATA}/sessions/s1.json`)
  host.before = (kind, what) => {
    if (kind === 'fs.write' && what.startsWith(`${dir}/owner.json.`)) owner.set('newer')
    return undefined
  }
  await clock.advance(15_000)
  expect(host.files.has(`${dir}/owner.json`)).toBe(true)
  expect(host.files.get(`${DATA}/sessions/s1.json`)).toBe(pointer)
})

// A run with a server up, about to be finished; at says where its instance loses the session while run.finished is written.
async function finishLosing($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], at: 'fs.stat' | 'append') {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ commands: { start: [{ name: 'backend', cmd: 'INST={slot} make backend.run', port: '4000' }] } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  const dir = String(started.run_dir)
  host.files.set(`${dir}/servers.json`, JSON.stringify([{ name: 'backend', pid: 4242, port: 4000 }]))
  host.ps.set('4242', '4240 make backend.run')
  host.before = (kind, what) => {
    if (kind === at && what === `${dir}/events.jsonl`) owner.set('newer')
    return undefined
  }
  const finished = String((await $.tool.call({ tool: 'mcp__wololo__event', type: 'run.finished', data: { outcome: 'cancelled', summary: 's' } } as never)).result)
  return { host, finished, types: eventLines(host, String(started.run_id)).map(line => line.type) }
}

test('a finished run whose line is dropped because its instance lost the session is refused, and stops nothing', async ($, on) => {
  const { host, finished, types } = await finishLosing($, on, 'fs.stat')
  expect(finished).toContain(NOT_OWNER)
  expect(host.killed).toEqual([])
  expect(types).not.toContain('run.finished')
})

test('a finished run whose line was written before its instance lost the session stops its servers', async ($, on) => {
  const { host, finished, types } = await finishLosing($, on, 'append')
  expect((parse(finished).cleanup as { stopped: string[] }).stopped).toEqual(['4242 (make backend.run)'])
  expect(host.killed).toEqual(['-TERM -4240'])
  expect(types).toContain('run.finished')
})

// A run whose start is on disk and one doing event, "mine", pending: no tool writes it until the next flush.
async function withPending($: Parameters<TestBody>[0], host: Host) {
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  const runId = String(started.run_id)
  const dir = String(started.run_dir)
  const last = Math.max(...eventLines(host, runId).map(line => line.seq))
  parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'doing', data: { text: 'mine' } } as never)).result)
  const flush = async () => parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result)
  const mine = () => eventLines(host, runId).filter(line => line.data.text === 'mine')
  return { runId, dir, log: `${dir}/events.jsonl`, last, flush, mine }
}

// Lines another load of the mod appended to the run's events, with the seqs after `from`.
function theirs(runId: string, from: number, count: number): string {
  return Array.from({ length: count }, (_, i) => JSON.stringify({ v: 1, seq: from + i + 1, ts: 1_800_000_500 + i, run: runId, type: 'doing', data: { text: `theirs ${i + 1}` } })).join('\n') + '\n'
}

const isRising = (seqs: readonly number[]) => seqs.every((seq, i) => i === 0 || seq > (seqs[i - 1] ?? 0))

test('a batch goes after the seqs another load of the mod appended meanwhile, and no seq repeats', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const { runId, log, last, flush, mine } = await withPending($, host)
  host.files.set(log, `${host.files.get(log)}${theirs(runId, last, 2)}`)
  const got = (await flush()).run as { last_seq: number }
  expect(mine().map(line => line.seq)).toEqual([last + 3])
  expect(got.last_seq).toBe(last + 3)
  expect(isRising(eventLines(host, runId).map(line => line.seq))).toBe(true)
})

test('a batch whose file an append could not open is written by the next flush, once', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const { log, flush, mine } = await withPending($, host)
  let fails = 1
  host.before = (kind, what) => (kind === 'append' && what === log && fails-- > 0 ? 3 : undefined)
  await flush()
  expect(mine()).toHaveLength(0)
  await flush()
  expect(mine()).toHaveLength(1)
})

// A flush whose kind call on the run's events fails once, the nth time, before the append is launched: nothing written, then written once.
async function failingBefore($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], kind: 'fs.exists' | 'fs.read', nth: number) {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const { log, flush, mine } = await withPending($, host)
  let calls = 0
  host.before = (at, what) => (at === kind && what === log && ++calls === nth ? 'the disk is gone' : undefined)
  await flush()
  expect(mine()).toHaveLength(0)
  await flush()
  expect(mine()).toHaveLength(1)
}

test("a batch is written by the next flush, once, when the append's own check fails", async ($, on) => {
  // The flush checks events.jsonl first to read the last seq on disk; the append's check is the second.
  await failingBefore($, on, 'fs.exists', 2)
})

test('a batch is written by the next flush, once, when the last seq on disk cannot be read', async ($, on) => {
  await failingBefore($, on, 'fs.read', 1)
})

// A flush whose append to the run's events fails once it was launched, as failure answers: never tried again.
async function launchedFailing($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], failure: number) {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const { runId, log, flush, mine } = await withPending($, host)
  let fails = 1
  host.before = (kind, what) => (kind === 'append' && what === log && fails-- > 0 ? failure : undefined)
  await flush()
  expect(fails).toBe(0)
  expect(mine()).toHaveLength(0)
  expect(host.files.get(`${DATA}/runs/${runId}/write-error.log`)).toMatch(/Z .*exit 1/)
  await flush()
  expect(mine()).toHaveLength(1)
}

test('an append the session refuses (auto mode may deny it as a Bash call) is written through the file API, once', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const { log, flush, mine } = await withPending($, host)
  let fails = 1
  host.before = (kind, what) => (kind === 'append' && what === log && fails-- > 0 ? 'this repeats a Bash call that is not allowed' : undefined)
  await flush()
  expect(fails).toBe(0)
  expect(mine()).toHaveLength(1)
  await flush()
  expect(mine()).toHaveLength(1)
})

test('a batch whose append failed after it opened the file, with nothing written, is tried again and written once', async ($, on) => {
  await launchedFailing($, on, 1)
})

test('two flushes at once write each event once, in seq order', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const { runId, log, flush, mine } = await withPending($, host)
  const held = gate()
  let isArmed = true
  host.before = async (kind, what) => {
    if (kind === 'append' && what === log && isArmed) {
      isArmed = false
      await held.hold()
    }
    return undefined
  }
  const first = flush()
  await held.reached
  parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'doing', data: { text: 'second' } } as never)).result)
  const second = flush()
  // Time for the second flush to get as far as it can while the first is held: nothing in the kit says when a call is waiting.
  await pause(50)
  held.open()
  await Promise.all([first, second])
  const lines = eventLines(host, runId)
  expect(mine()).toHaveLength(1)
  expect(lines.filter(line => line.data.text === 'second')).toHaveLength(1)
  expect(isRising(lines.map(line => line.seq))).toBe(true)
})

test("an agent's turn that ends while a flush renumbers its batch gets a seq of its own", async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  const dir = `${DATA}/runs/repo-txt-agent2`
  const log = `${dir}/events.jsonl`
  seedRun(host, 'repo-txt-agent2', { waiting: false })
  const agent = { id: 'a1', role: 'critic', description: 'critic', model: null, background: true }
  host.files.set(log, `${host.files.get(log)}${JSON.stringify({ v: 1, seq: 4, ts: 1_800_000_004, run: 'repo-txt-agent2', type: 'agent.started', data: agent })}\n`)
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'doing', data: { text: 'mine' } } as never)).result)
  host.files.set(log, `${host.files.get(log)}${theirs('repo-txt-agent2', 4, 2)}`)
  // Held where the flush reads the last seq on disk, after it took the batch.
  const held = gate()
  let isArmed = true
  host.before = async (kind, what) => {
    if (kind === 'fs.read' && what === log && isArmed) {
      isArmed = false
      await held.hold()
    }
    return undefined
  }
  const flushing = $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  await held.reached
  await $.turn.complete({ turnId: 't1', agentId: 'a1', reason: 'end_turn', text: '', answer: '', isAborted: false } as never)
  held.open()
  await flushing
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  const lines = eventLines(host, 'repo-txt-agent2')
  expect(lines.filter(line => line.type === 'agent.finished')).toHaveLength(1)
  expect(lines.find(line => line.data.text === 'mine')?.seq).toBe(7)
  expect(isRising(lines.map(line => line.seq))).toBe(true)
})

test('a batch tried again after the events were rotated away never repeats a seq of the rotated file', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const { runId, dir, log, last, flush, mine } = await withPending($, host)
  // Another load of the mod appended two events and the file reached the size it is rotated at.
  host.files.set(log, `${host.files.get(log)}${theirs(runId, last, 2)}${'x'.repeat(2 * 1024 * 1024)}\n`)
  // The flush checks events.jsonl first to read the last seq on disk; the append's own check, after the rotation, is the second.
  let checks = 0
  host.before = (kind, what) => (kind === 'fs.exists' && what === log && ++checks === 2 ? 'the disk is gone' : undefined)
  await flush()
  expect(checks).toBe(2)
  expect(host.files.has(`${dir}/events.1.jsonl`)).toBe(true)
  expect(mine()).toHaveLength(0)
  await flush()
  const rotated = (host.files.get(`${dir}/events.1.jsonl`) ?? '').split('\n').filter(line => line.startsWith('{')).map(line => (JSON.parse(line) as { seq: number }).seq)
  const seqs = [...rotated, ...eventLines(host, runId).map(line => line.seq)]
  expect(mine().map(line => line.seq)).toEqual([last + 3])
  expect(new Set(seqs).size).toBe(seqs.length)
})

// The last run is finished and, while its flush is held (at its append, or where it reads the last seq on disk), another run starts; the
// held call then answers answer, and with theirs another load of the mod has just appended two events to the finished run's file.
async function startingWhileFinishing(
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  { at, answer, theirs: isTheirs }: { at: 'append' | 'fs.read'; answer?: number; theirs?: boolean },
) {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const held = gate()
  let isStarting = false
  // The next run is under way once its start draws the card.
  on('state.set', (_, e, next) => {
    if (e.key === 'view' && isStarting) held.open()
    return next(e)
  })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const first = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  const firstLog = `${String(first.run_dir)}/events.jsonl`
  let isArmed = true
  host.before = async (kind, what) => {
    if (kind !== at || what !== firstLog || !isArmed) return undefined
    isArmed = false
    await held.hold()
    if (isTheirs) host.files.set(firstLog, `${host.files.get(firstLog)}${theirs(String(first.run_id), Math.max(...eventLines(host, String(first.run_id)).map(line => line.seq)), 2)}`)
    return answer
  }
  const finishing = $.tool.call({ tool: 'mcp__wololo__event', type: 'run.finished', data: { outcome: 'cancelled', summary: 's' } } as never)
  await held.reached
  isStarting = true
  const second = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'y' }, title: 'Y' } as never)).result)
  await finishing
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  const runs = (id: unknown) => [...new Set(eventLines(host, String(id)).map(line => (line as unknown as { run: string }).run))]
  expect(runs(first.run_id)).toEqual([String(first.run_id)])
  expect(runs(second.run_id)).toEqual([String(second.run_id)])
  const seqs = eventLines(host, String(first.run_id)).map(line => line.seq)
  const snapshot = JSON.parse(host.files.get(`${String(first.run_dir)}/run.json`) ?? '{}') as { outcome?: unknown; last_seq?: number }
  expect(eventLines(host, String(first.run_id)).at(-1)?.type).toBe('run.finished')
  expect(new Set(seqs).size).toBe(seqs.length)
  expect(snapshot.outcome).toBe('cancelled')
  expect(snapshot.last_seq).toBe(Math.max(...seqs))
}

test("starting another run while the last one's flush is under way keeps each run's events and run.json in its own files", async ($, on) => {
  await startingWhileFinishing($, on, { at: 'append' })
})

test("the last run's events its flush could not write when another run started are written to its files later", async ($, on) => {
  await startingWhileFinishing($, on, { at: 'append', answer: 3, theirs: true })
})

test("the last run's events are numbered after another load's, and its run.json follows them, once another run started", async ($, on) => {
  await startingWhileFinishing($, on, { at: 'fs.read', theirs: true })
})

// Runs that finish while their flush is held at the append, the next one started meanwhile: the held append finds the file not writable,
// and so does any append to a file in blocked.
async function finishingRuns($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  let opening: (() => void) | undefined
  // The next run is under way once its start draws the card.
  on('state.set', (_, e, next) => {
    if (e.key === 'view' && opening) {
      opening()
      opening = undefined
    }
    return next(e)
  })
  const blocked = new Set<string>()
  const holds = new Map<string, ReturnType<typeof gate>>()
  host.before = async (kind, what) => {
    if (kind !== 'append') return undefined
    const held = holds.get(what)
    if (held) {
      holds.delete(what)
      await held.hold()
      return 3
    }
    return blocked.has(what) ? 3 : undefined
  }
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const start = async (ref: string) => {
    const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref }, title: ref } as never)).result)
    return { id: String(started.run_id), log: `${String(started.run_dir)}/events.jsonl` }
  }
  const finish = () => $.tool.call({ tool: 'mcp__wololo__event', type: 'run.finished', data: { outcome: 'cancelled', summary: 's' } } as never)
  const finishThenStart = async (log: string, ref: string) => {
    const held = gate()
    holds.set(log, held)
    const finishing = finish()
    await held.reached
    opening = held.open
    const next = await start(ref)
    await finishing
    return next
  }
  const types = (id: string) => eventLines(host, id).map(line => line.type)
  return { host, blocked, start, finish, finishThenStart, types }
}

test("a kept batch of one finished run that cannot be written holds back no other run's", async ($, on) => {
  const { blocked, start, finishThenStart, types } = await finishingRuns($, on)
  const x = await start('x')
  blocked.add(x.log)
  const y = await finishThenStart(x.log, 'y')
  await finishThenStart(y.log, 'z')
  expect(types(y.id).at(-1)).toBe('run.finished')
  expect(types(x.id)).not.toContain('run.finished')
})

test('a resume writes what was kept of the run before rebuilding it, so a finish kept there is read', async ($, on) => {
  const { blocked, start, finish, finishThenStart } = await finishingRuns($, on)
  const x = await start('x')
  blocked.add(x.log)
  await finishThenStart(x.log, 'y')
  parse((await finish()).result)
  blocked.delete(x.log)
  expect(String((await $.tool.call({ tool: 'mcp__wololo__resume', run_id: x.id } as never)).result)).toContain('already finished')
  const got = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as { id: string; outcome: unknown }
  expect([got.id, got.outcome]).toEqual([x.id, 'cancelled'])
})

test('the heartbeat keeps the run in memory when it is ahead of what the disk holds', async ($, on) => {
  const { host, clock, log, doing } = await withRunToRevive($, on)
  parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'doing', data: { text: 'mine' } } as never)).result)
  // The append is launched and fails, so "mine" stays in memory and never reaches the disk.
  let fails = 1
  host.before = (kind, what) => (kind === 'append' && what === log && fails-- > 0 ? 'the disk is full' : undefined)
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  expect(fails).toBe(0)
  await clock.advance(1_000)
  expect(await doing()).toBe('mine')
})


// A resume of the active run, held where it rebuilds the run from disk (after it took the session and wrote what was pending). Meanwhile
// an event, "mine", is recorded and a flush takes it, held at its append until the rebuilt run draws the card; the appends to the run's
// events answer answers, in turn, then write.
async function resumeWithFlushInFlight($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], answers: ReadonlyArray<number | undefined>) {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const rebuilding = gate()
  const appending = gate()
  let isClaimed = false
  let isResuming = false
  let isRebuilt = false
  on('state.set', (_, e, next) => {
    if (e.key === 'owner' && isResuming) isClaimed = true
    if (e.key === 'view' && isRebuilt) appending.open()
    return next(e)
  })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  const runId = String(started.run_id)
  const dir = String(started.run_dir)
  const log = `${dir}/events.jsonl`
  let isRebuildArmed = true
  let appends = 0
  host.before = async (kind, what) => {
    if (kind === 'fs.read' && what === `${dir}/run.json` && isClaimed && isRebuildArmed) {
      isRebuildArmed = false
      await rebuilding.hold()
    }
    if (kind !== 'append' || what !== log) return undefined
    appends += 1
    if (appends === 1) await appending.hold()
    return answers[appends - 1]
  }
  isResuming = true
  const resuming = $.tool.call({ tool: 'mcp__wololo__resume', run_id: runId } as never)
  await rebuilding.reached
  parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'doing', data: { text: 'mine' } } as never)).result)
  const flushing = $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  await appending.reached
  isRebuilt = true
  rebuilding.open()
  parse((await resuming).result)
  await flushing
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  const lines = eventLines(host, runId)
  return { appends, lines, types: lines.map(line => (line.data.text === 'mine' ? 'mine' : line.type)) }
}

test('a batch whose load a resume replaced while it was being written is written once, with seqs of its own', async ($, on) => {
  const { lines, types } = await resumeWithFlushInFlight($, on, [3])
  const seqs = lines.map(line => line.seq)
  expect(types.filter(type => type === 'mine')).toHaveLength(1)
  expect(types.filter(type => type === 'owner.changed')).toHaveLength(1)
  expect(new Set(seqs).size).toBe(seqs.length)
})

test('newer events of a run wait while older ones of an earlier load of it cannot be written', async ($, on) => {
  const { appends, lines, types } = await resumeWithFlushInFlight($, on, [3, 3])
  expect(appends).toBeGreaterThanOrEqual(3)
  expect(types.indexOf('mine')).toBeGreaterThan(-1)
  expect(types.indexOf('mine')).toBeLessThan(types.indexOf('owner.changed'))
  expect(isRising(lines.map(line => line.seq))).toBe(true)
})

// A run an earlier version of the mod left with a plan that says how many items it has but not which, so the heartbeat reads it again from
// disk; the session takes it back, and the clock stands one tick before that heartbeat.
async function withRunToRevive($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('tool.call', () => ({ result: {} }))
  const runId = 'repo-txt-revive'
  const dir = `${DATA}/runs/${runId}`
  const project = { key: 'acme__shop', path: REPO, worktree: `${REPO}/.claude/worktrees/wololo-${runId}`, branch: 'wololo/txt-x', base: 'main' }
  const ev = (seq: number, type: string, data: Record<string, unknown>) => JSON.stringify({ v: 1, seq, ts: 1_800_000_000 + seq, run: runId, type, data })
  host.files.set(`${dir}/events.jsonl`, [ev(1, 'run.started', { title: 'X', source: { kind: 'text', ref: 'x', url: null }, project, mode: 'checkpoints', session_id: 's1', cwd: REPO }), ev(2, 'plan.ready', { total: 3 })].join('\n') + '\n')
  const owner = { session_id: 's1', cwd: REPO, heartbeat_at: 1_800_000_000 }
  host.files.set(`${dir}/run.json`, JSON.stringify({ id: runId, status: 'running', outcome: null, owner }))
  host.files.set(`${DATA}/sessions/s1.json`, JSON.stringify({ session_id: 's1', run_id: runId, heartbeat_at: owner.heartbeat_at }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await clock.advance(14_000)
  const doing = async () => (parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result).run as { doing: { text: string } | null }).doing?.text
  return { host, clock, runId, dir, log: `${dir}/events.jsonl`, doing }
}

test('an event recorded while the heartbeat reads the run again from disk is kept', async ($, on) => {
  const { host, clock, runId, dir, doing } = await withRunToRevive($, on)
  const held = gate()
  let isArmed = true
  host.before = async (kind, what) => {
    if (kind === 'fs.read' && what === `${dir}/run.json` && isArmed) {
      isArmed = false
      await held.hold()
    }
    return undefined
  }
  const beating = clock.advance(1_000)
  await held.reached
  parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'doing', data: { text: 'during' } } as never)).result)
  held.open()
  await beating
  expect(await doing()).toBe('during')
  const seqs = eventLines(host, runId).map(line => line.seq)
  expect(new Set(seqs).size).toBe(seqs.length)
})

test('the heartbeat does not read the run again from disk while a batch of it is being written', async ($, on) => {
  const { host, clock, runId, log, doing } = await withRunToRevive($, on)
  const last = Math.max(...eventLines(host, runId).map(line => line.seq))
  parse((await $.tool.call({ tool: 'mcp__wololo__event', type: 'doing', data: { text: 'mine' } } as never)).result)
  host.files.set(log, `${host.files.get(log)}${theirs(runId, last, 2)}`)
  // The flush is held where it reads the last seq on disk, its batch taken; the heartbeat lets it go once it is past its revive.
  const held = gate()
  let isArmed = true
  host.before = async (kind, what) => {
    if (kind === 'git' && what.startsWith('log -1')) held.open()
    if (kind === 'fs.read' && what === log && isArmed) {
      isArmed = false
      await held.hold()
    }
    return undefined
  }
  const flushing = $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  await held.reached
  await clock.advance(1_000)
  await flushing
  expect(await doing()).toBe('mine')
})


test('a batch is written by the next flush, once, when the rotated files cannot be listed', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const { runId, dir, log, last, flush, mine } = await withPending($, host)
  host.files.set(log, `${host.files.get(log)}${theirs(runId, last, 2)}${'x'.repeat(2 * 1024 * 1024)}\n`)
  // Once events.jsonl is rotated away, the last seq is in the rotated files, and listing them fails once.
  let fails = 1
  host.before = (kind, what) => (kind === 'fs.list' && what === dir && !host.files.has(log) && fails-- > 0 ? 'the disk is gone' : undefined)
  await flush()
  expect(fails).toBe(0)
  expect(mine()).toHaveLength(0)
  await flush()
  expect(mine().map(line => line.seq)).toEqual([last + 3])
})

test('an instance that loses the session during the append writes neither the history nor run.json after it', async ($, on) => {
  const host = fakeHost(on)
  const owner = otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  const { dir, log, flush, mine } = await withPending($, host)
  const history = host.files.get(`${dir}/history.md`)
  const snapshot = host.files.get(`${dir}/run.json`)
  expect([history, snapshot].every(text => text !== undefined)).toBe(true)
  host.before = (kind, what) => {
    if (kind === 'append' && what === log) owner.set('newer')
    return undefined
  }
  await flush()
  expect(mine()).toHaveLength(1)
  expect(host.files.get(`${dir}/history.md`)).toBe(history)
  expect(host.files.get(`${dir}/run.json`)).toBe(snapshot)
})

test("the run's tools wait behind ToolSearch until a run is active", async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  expect([host.tools.get('event'), host.tools.get('publish'), host.tools.get('start'), host.tools.get('get')]).toEqual([true, true, false, false])
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  expect(String(started.tools)).toContain('select:mcp__wololo__event')
  expect([host.tools.get('event'), host.tools.get('tests'), host.tools.get('publish'), host.tools.get('external_turn')]).toEqual([false, false, false, false])
})

test('a finished run stops the servers it started, and only those', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ commands: { start: [{ name: 'backend', cmd: 'INST={slot} make backend.run', port: '4000' }] } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  const dir = String(started.run_dir)
  host.files.set(`${dir}/servers.json`, JSON.stringify([{ name: 'backend', pid: 4242, port: 4000 }, { name: 'other', pid: 5151, port: 4001 }]))
  host.ps.set('4242', '4240 make backend.run')
  host.ps.set('5151', '5150 vim notes.md')
  const finished = parse(
    (await $.tool.call({ tool: 'mcp__wololo__event', type: 'run.finished', data: { outcome: 'cancelled', summary: 's' } } as never)).result,
  )
  expect(host.killed).toEqual(['-TERM -4240'])
  expect((finished.cleanup as { stopped: string[] }).stopped).toEqual(['4242 (make backend.run)'])
})

test('a finished run also stops whatever serves a port from inside its worktree, but never the session\'s own group', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  const worktree = String(started.worktree)
  host.answers.push(
    { match: /^lsof -nP -iTCP -sTCP:LISTEN -Fpcn$/, stdout: ['p7001', 'cpython3', 'n127.0.0.1:8671', 'p7002', 'cnode', 'n[::1]:3064', 'p7003', 'cpostgres', 'n[::1]:5432', 'p7004', 'cnode', 'n127.0.0.1:9229'].join('\n'), exit: 0 },
    { match: /^lsof -a -p 7001,7002,7003,7004 -d cwd -Fpn$/, stdout: ['p7001', `n${worktree}`, 'p7002', `n${worktree}/frontend`, 'p7003', 'n/Users/me/.local/share/pg', 'p7004', `n${worktree}`].join('\n'), exit: 0 },
    { match: /^ps -o pgid= -p \$PPID$/, stdout: '9000\n', exit: 0 },
  )
  host.ps.set('7001', '7000 python3 tools/mock/server.py')
  host.ps.set('7002', '6990 node vite.js')
  host.ps.set('7004', '9000 node --inspect')
  const finished = parse(
    (await $.tool.call({ tool: 'mcp__wololo__event', type: 'run.finished', data: { outcome: 'done', summary: 's' } } as never)).result,
  )
  expect(host.killed).toEqual(['-TERM -7000', '-TERM -6990'])
  expect((finished.cleanup as { stopped: string[] }).stopped).toEqual(['7001 (python3 tools/mock/server.py, :8671)', '7002 (node vite.js, :3064)'])
})

test('a finished run gives its instance back once its servers are down', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ instance: { release: 'make inst.release' } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  host.answers.push({ match: /make inst\.release$/, stdout: 'Released instance 3.', exit: 0 })
  const finished = parse(
    (await $.tool.call({ tool: 'mcp__wololo__event', type: 'run.finished', data: { outcome: 'done', summary: 's' } } as never)).result,
  )
  expect(host.shells.filter(line => line.endsWith('make inst.release'))).toHaveLength(1)
  expect((finished.cleanup as { released: string }).released).toBe('ok')
})

test('a group that ignores the TERM gets a KILL before the run says it finished', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const started = parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)).result)
  host.answers.push(
    { match: /^lsof -nP -iTCP -sTCP:LISTEN -Fpcn$/, stdout: 'p7001\ncmix\nn127.0.0.1:4070', exit: 0 },
    { match: /^lsof -a -p 7001 -d cwd -Fpn$/, stdout: `p7001\nn${String(started.worktree)}/backend`, exit: 0 },
  )
  host.ps.set('7001', '7000 mix phx.server')
  // The TERM is ignored: the group stays alive until the KILL.
  host.stubborn.add('-7000')
  await $.tool.call({ tool: 'mcp__wololo__event', type: 'run.finished', data: { outcome: 'done', summary: 's' } } as never)
  expect(host.killed).toEqual(['-TERM -7000', '-KILL -7000'])
})

const RUNNER = {
  item: {
    steps: [
      { cmd: 'make agent.adopt ISSUE={issue} CONFIRM={confirm} JSON=1', if_missing: 'runner_run', capture: { runner_run: 'run', publish_hash: '/CONFIRM=(\\w+)/' }, accept_states: ['verified'] },
      { cmd: 'make agent.verify RUN={runner_run} SHA={sha} JSON=1', if_present: 'runner_run', capture: { publish_hash: '/CONFIRM=(\\w+)/' }, accept_states: ['verified'] },
    ],
  },
  plan: { steps: [{ cmd: 'make agent.plan ISSUE={issue} JSON=1', capture: { confirm: 'data.confirm' } }] },
}

async function adapterRun($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ adapters: RUNNER, env: { set: {}, unset: ['INST'] } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'X' } as never)).result)
  return host
}

const adapter = async ($: Parameters<TestBody>[0], point: string) => parse((await $.tool.call({ tool: 'mcp__wololo__run_adapter', point } as never)).result)

test("an adapter hands a point of the run to the project's tool, and carries what it answers to the next steps", async ($, on) => {
  const host = await adapterRun($, on)
  host.answers.push({ match: /agent\.plan/, stdout: JSON.stringify({ ok: true, command: 'plan', data: { confirm: 'c0ffee' } }), exit: 0 })
  host.answers.push({ match: /agent\.adopt/, stdout: JSON.stringify({ ok: true, run: 'r42', state: 'verified', unblock: 'make agent.publish RUN=r42 CONFIRM=h1' }), exit: 2 })
  host.answers.push({ match: /agent\.verify/, stdout: JSON.stringify({ ok: true, run: 'r42', state: 'verified', unblock: 'make agent.publish RUN=r42 CONFIRM=h2' }), exit: 2 })
  expect((await adapter($, 'plan')).blocked).toBe(false)
  expect((await adapter($, 'item')).blocked).toBe(false)
  expect((await adapter($, 'item')).blocked).toBe(false)
  // The first item hands the branch over; the next ones are verified inside the run it captured.
  expect(host.shells).toEqual([
    'env -u INST make agent.plan ISSUE=12 JSON=1',
    'env -u INST make agent.adopt ISSUE=12 CONFIRM=c0ffee JSON=1',
    'env -u INST make agent.verify RUN=r42 SHA=5ha1 JSON=1',
  ])
  const status = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result) as { run: { adapter_vars: Record<string, string>; blocked: unknown } }
  expect(status.run.adapter_vars).toEqual({ confirm: 'c0ffee', runner_run: 'r42', publish_hash: 'h2' })
  expect(status.run.blocked ?? null).toBe(null)
  expect(String((await adapter($, 'poll')).reason)).toContain('nothing for poll')
})

test('a background step outlives the ten minutes a command is given: the point goes on from it once it ends', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  const item = {
    steps: [
      { cmd: 'make inst.claim', if_missing: 'runner_run' },
      { ...RUNNER.item.steps[0], background: true, status: 'make agent.status ISSUE={issue} JSON=1' },
      RUNNER.item.steps[1],
      { cmd: 'echo after' },
    ],
  }
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ adapters: { ...RUNNER, item } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'X' } as never)).result)
  host.answers.push({ match: /agent\.plan/, stdout: JSON.stringify({ ok: true, data: { confirm: 'c0ffee' } }), exit: 0 })
  host.answers.push({ match: /^nohup sh /, stdout: '4242\n', exit: 0 })
  host.answers.push({ match: /inst\.claim|echo after/, stdout: '', exit: 0 })
  await adapter($, 'plan')

  const started = await adapter($, 'item')
  expect([started.running, started.blocked]).toEqual([true, undefined])
  const job = (parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result) as { run: { adapter_job: { job: string; pid: number; cmd: string } } }).run.adapter_job
  expect([job.pid, job.cmd]).toEqual([4242, 'make agent.adopt ISSUE=12 CONFIRM=c0ffee JSON=1'])
  expect(host.files.get(`${job.job}.sh`)).toContain(`make agent.adopt ISSUE=12 CONFIRM=c0ffee JSON=1 > ${job.job}.out 2> ${job.job}.err`)
  expect(started.wait).toBe(`sh ${job.job}.wait`)
  // The wait is wololo's own command, so the run allows it; another point waits for this one.
  expect((await $.tool.check({ tool: 'Bash', input: { command: started.wait } } as never)).decision).toBe('allow')
  expect(String((await $.tool.call({ tool: 'mcp__wololo__run_adapter', point: 'pr' } as never)).result)).toContain('still runs')

  // Still running: nothing more runs, and the answer says to wait again.
  expect((await adapter($, 'item')).running).toBe(true)
  host.files.set(`${job.job}.out`, `progress\n${JSON.stringify({ ok: true, run: 'r42', state: 'verified', unblock: 'make agent.publish RUN=r42 CONFIRM=h1' })}\n`)
  host.files.set(`${job.job}.code`, '2\n')
  const ended = await adapter($, 'item')
  expect([ended.running, ended.blocked]).toEqual([undefined, false])
  // The verify step is judged by what was known when the point started, as without the background: the first item does not verify.
  expect(host.shells.filter(line => !line.startsWith('nohup'))).toEqual(['make agent.plan ISSUE=12 JSON=1', 'make inst.claim', 'echo after'])
  const status = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result) as { run: { adapter_vars: Record<string, string>; adapter_job: unknown } }
  expect(status.run.adapter_vars).toEqual({ confirm: 'c0ffee', runner_run: 'r42', publish_hash: 'h1' })
  expect(status.run.adapter_job).toBe(null)
})

test('a background step that dies without an exit code blocks the run', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ adapters: { pr: { steps: [{ cmd: 'make agent.publish JSON=1', background: true }] } } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'X' } as never)).result)
  host.answers.push({ match: /^nohup sh /, stdout: '777\n', exit: 0 })
  expect((await adapter($, 'pr')).running).toBe(true)
  host.dead.add('777')
  expect((await adapter($, 'pr')).blocked).toBe(true)
  const status = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result) as { run: { blocked: { reason: string } } }
  expect(status.run.blocked.reason).toContain('stopped before it finished')
})

test("a refusal of the project's tool blocks the run with its words, and a missing value is named", async ($, on) => {
  const host = await adapterRun($, on)
  host.answers.push({ match: /agent\.plan/, stdout: JSON.stringify({ ok: false, code: 'not_approved', message: 'Issue is not approved: approve its current spec' }), exit: 1 })
  const refused = await adapter($, 'plan')
  expect(refused.blocked).toBe(true)
  const status = parse((await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)).result) as { run: { blocked: { reason: string } } }
  expect(status.run.blocked.reason).toBe('plan: Issue is not approved: approve its current spec')
  expect(String((await $.tool.call({ tool: 'mcp__wololo__run_adapter', point: 'item' } as never)).result)).toContain('needs confirm')
})

test("/wololo-status shows the runs another tool drives, and what unblocks the ones waiting for you", async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ mirror: { list: 'make agent.status JSON=1', run: 'make agent.status RUN={run} JSON=1' } }))
  const runs = [
    { id: 'a1', issue: 4301, state: 'needs_decision', request: null, waiting_on: 'the developer: answer' },
    { id: 'b2', issue: 4290, state: 'ci', request: null, waiting_on: 'nobody yet' },
    { id: 'c3', issue: 4100, state: 'merged', request: null, waiting_on: 'the release owner' },
  ]
  host.answers.push({ match: /RUN=a1/, stdout: JSON.stringify({ ok: true, state: 'needs_decision', waiting_on: 'the developer: answer', unblock: 'make agent.decision RUN=a1 REVISION=r ANSWER=<file>' }), exit: 2 })
  host.answers.push({ match: /RUN=b2/, stdout: JSON.stringify({ ok: true, state: 'ci', waiting_on: 'CI', unblock: null }), exit: 3 })
  host.answers.push({ match: /agent\.status JSON=1$/, stdout: JSON.stringify({ ok: true, data: { runs } }), exit: 0 })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'wololo-status', args: '' } as never)
  expect(ran.text).toContain('runner #4301 · needs_decision · the developer: answer · make agent.decision RUN=a1')
  expect(ran.text).toContain('runner #4290 · ci · CI')
  expect(ran.text).not.toContain('#4100')
  const ui = await $.ui.mount({
    plugin: 'wololo',
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'wololo-status', args: '', text: ran.text ?? '', isErrored: false },
  })
  expect((await ui.find({ type: 'Text', text: /runner #4301/ }))?.text).toBe('shop · runner #4301')
  expect(await ui.find({ type: 'Text', text: /te espera/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /sigue solo/ })).toBeTruthy()
  await ui.unmount()
})

test('keep_awake holds the machine up in leases while a run is active, and not otherwise', async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ keep_awake: true }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await clock.advance(3_000)
  expect(host.shells.filter(line => line.includes('caffeinate'))).toEqual([])
  await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'text', ref: 'x' }, title: 'X' } as never)
  await clock.advance(3_000)
  expect(host.shells.filter(line => line.includes('caffeinate -i -t 300'))).toHaveLength(1)
  await clock.advance(240_000)
  expect(host.shells.filter(line => line.includes('caffeinate -i -t 300'))).toHaveLength(2)
})

test("while a background step runs, its status command says on the card what the tool is doing", async ($, on) => {
  const host = fakeHost(on, { clock: false })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('tool.call', () => ({ result: {} }))
  const pr = { steps: [{ cmd: 'make agent.publish JSON=1', background: true, status: 'make agent.status ISSUE={issue} JSON=1' }] }
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ adapters: { pr } }))
  host.answers.push({ match: /^nohup sh /, stdout: '4242\n', exit: 0 })
  host.answers.push({ match: /agent\.status ISSUE=12/, stdout: JSON.stringify({ ok: true, state: 'verifying', waiting_on: 'Codex' }), exit: 3 })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'X' } as never)
  expect((await adapter($, 'pr')).running).toBe(true)
  await clock.advance(16_000)
  expect(host.shells.filter(line => line.includes('agent.status'))).toHaveLength(1)
  const events = (host.files.get(`${DATA}/runs/${[...host.files.keys()].find(k => k.endsWith('/events.jsonl'))?.split('/').at(-2)}/events.jsonl`) ?? '').split('\n')
  expect(events.some(line => line.includes('"doing"') && line.includes('pr: verifying · Codex'))).toBe(true)
  // At most once a minute.
  await clock.advance(30_000)
  expect(host.shells.filter(line => line.includes('agent.status'))).toHaveLength(1)
  await clock.advance(45_000)
  expect(host.shells.filter(line => line.includes('agent.status'))).toHaveLength(2)
})

test('with review.final set, the implement stage completes only after a passing final review of the committed code', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ review: { final: { skill: 'code-review', args: 'high {branch}' } } }))
  host.git.set('rev-parse HEAD^{tree}', '7ree')
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const event = async (type: string, data: Record<string, unknown>) => String((await $.tool.call({ tool: 'mcp__wololo__event', type, data } as never)).result)
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Pagos', mode: 'full' } as never)).result)
  for (const stage of ['context', 'definition', 'gate_a', 'plan', 'implement']) expect(await event('stage.entered', { stage })).toContain('"ok": true')

  expect(await event('stage.completed', { stage: 'implement' })).toContain('after the final review')
  expect(await event('final_review', { verdict: 'fail', findings: 2 })).toContain('"ok": true')
  expect(await event('stage.completed', { stage: 'implement' })).toContain('found 2 to fix')
  expect(await event('final_review', { verdict: 'pass', findings: 2 })).toContain('"ok": true')
  host.git.set('rev-parse HEAD^{tree}', '8ree')
  expect(await event('stage.completed', { stage: 'implement' })).toContain('changed after the final review')
  expect(await event('final_review', { verdict: 'pass', findings: 0 })).toContain('"ok": true')
  expect(await event('stage.completed', { stage: 'implement' })).toContain('"ok": true')
})

import { type TestBody, expect, mock, test } from 'claude-code/testing'

const HOME = '/home/t'
const REPO = '/repo'
const DATA = `${HOME}/.claude/wololo`

type Host = { opens: Array<{ id: string; focus?: boolean }>; files: Map<string, string>; gh: string[]; tools: Map<string, boolean>; ps: Map<string, string>; dead: Set<string>; killed: string[]; shells: string[]; answers: Array<{ match: RegExp; stdout: string; exit: number }>; git: Map<string, string> }

function fakeHost(on: Parameters<TestBody>[1], options: { clock?: boolean; unplaced?: string } = {}): Host {
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

  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.id', () => ({ value: 's1' }))
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
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: files.has(e.path) || [...files.keys()].some(k => k.startsWith(`${e.path}/`)) }))
  on('fs.stat', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.list', (_, e) => {
    const names = new Map<string, 'file' | 'dir'>()
    for (const key of files.keys()) {
      if (!key.startsWith(`${e.path}/`)) continue
      const rest = key.slice(e.path.length + 1)
      const [name, ...more] = rest.split('/')
      if (name) names.set(name, more.length > 0 ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', (_, e) => {
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
      return done()
    }
    if (cmd === 'gh') {
      gh.push(args.join(' '))
      return done('https://github.com/acme/shop/issues/12\n')
    }
    if (cmd === 'git') {
      const line = args.join(' ')
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
    on('clock.now', () => ({ value: (now += 1_000) }))
  }
  on('tool.check', (_, e) => ({ decision: e.tool === 'AskUserQuestion' ? ('allow' as const) : ('ask' as const) }))
  return { opens, files, gh, tools, ps, dead, killed, shells, answers, git }
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
  expect(answer.branch).toBe('wololo/12-partial-payments')
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
  expect(entered.header).toBe('[wololo #12 · 1/8 Contexto · ⟳ trabajando]')
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
  expect(await probe.find({ type: 'Text', text: /^Archivos del run/ })).toBeUndefined()
  await probe.press({ key: 'toggle' })
  expect((await probe.find({ type: 'Text', text: /^Archivos del run/ }))?.text).toContain(`${DATA}/runs/`)
  await probe.press({ key: 'tab-items' })
  expect((await probe.find({ type: 'Text', text: /todavía no tiene ítems/ }))?.text).toBe('El plan todavía no tiene ítems.')
  await probe.press({ key: 'tab-history' })
  expect((await probe.find({ type: 'Text', text: /Run iniciado/ }))?.text).toContain('▶ Run iniciado: Partial payments')
  expect(await probe.find({ type: 'Text', text: /^Archivos del run/ })).toBeUndefined()
  await probe.press({ key: 'detail' })
  expect((await probe.find({ type: 'Text', text: /Etapa 1\/8 Contexto/ }))?.text).toContain('→ Etapa 1/8 Contexto')
  await probe.press({ key: 'tab-summary' })
  expect((await probe.find({ type: 'Text', text: /^Archivos del run/ }))?.text).toContain(`${DATA}/runs/`)
  await probe.press({ key: 'toggle' })
  expect(await probe.find({ type: 'Text', text: /^Archivos del run/ })).toBeUndefined()
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
  const allowed = await $.tool.check({ tool: 'Bash', input: { command: 'git push -u origin wololo/12-partial-payments' } } as never)
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

test('with spec.to_github off, issue writes stay in files', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  host.files.set(`${DATA}/projects/acme__shop/config.json`, JSON.stringify({ spec: { to_github: false } }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  parse((await $.tool.call({ tool: 'mcp__wololo__start', source: { kind: 'github_issue', ref: '12' }, title: 'Local only' } as never)).result)
  host.files.set('/tmp/body.md', 'spec')
  const answer = parse((await $.tool.call({ tool: 'mcp__wololo__publish', kind: 'issue_body', number: 12, body_file: '/tmp/body.md' } as never)).result)
  expect(answer.published).toBe(false)
  expect(host.gh).toEqual([])
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
  expect((await ui.find({ type: 'Text', text: /^▶ 2\./ }))?.text).toBe('▶ 2. Back: API')
  expect((await ui.find({ type: 'Text', text: /^· 3\./ }))?.text).toBe('· 3. Front: tipos')
  await ui.unmount()
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
  expect((await ui.find({ type: 'Text', text: /^r · i · h$/ }))?.text).toBe('r · i · h')
  expect((await ui.find({ type: 'Text', text: /^pestañas/ }))?.text).toBe('pestañas: Resumen, Ítems, Historial')
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

test('the expanded card pages its tab instead of growing past its rows', async ($, on) => {
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
  const range = (await ui.find({ type: 'Text', text: /^1–\d+ de \d+$/ }))?.text ?? ''
  expect(range).toMatch(/^1–\d+ de \d+$/)
  await ui.press({ key: 'page-down' })
  expect((await ui.find({ type: 'Text', text: /^\d+–\d+ de \d+$/ }))?.text).not.toBe(range)
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
    .trim()
    .split('\n')
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

test('a background task the session no longer runs is closed at the end of the turn', async ($, on) => {
  fakeHost(on)
  let next = 0
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { result: { backgroundTaskId: `t${++next}` } } : { result: {} }))
  on('classic.Stop', () => ({}))
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
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 't2', type: 'shell', status: 'running', description: 'Frontend' }] } as never)
  expect(await open()).toEqual(['t2'])
  await $.classic.Stop({ stop_hook_active: false } as never)
  expect(await open()).toEqual(['t2'])
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
// set hands the atom to another instance again.
function otherOwner(on: Parameters<TestBody>[1], id = 'other'): { set: (id: string) => void } {
  let other: string | null = id
  on('state.get', (_, e, next) => (e.key === 'owner' && other !== null ? { value: { value: other, version: 1_000 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.key === 'owner') other = null
    return next(e)
  })
  return {
    set: (next: string) => {
      other = next
    },
  }
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

test('a session takes the run from the instance that owned it, and the permission it left waiting goes after the last seq on disk', async ($, on) => {
  const host = fakeHost(on)
  otherOwner(on)
  on('tool.call', () => ({ result: {} }))
  seedRun(host, 'repo-txt-perm02', { waiting: true })
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__wololo__get', scope: 'run' } as never)
  expect(eventLines(host, 'repo-txt-perm02').filter(line => line.type === 'permission.resolved').map(line => line.seq)).toEqual([4])
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

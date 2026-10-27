import { type TestBody, expect, test } from 'claude-code/testing'

const HOME = '/home/t'
const REPO = '/repo'
const DATA = `${HOME}/.claude/wololo`

type Host = { files: Map<string, string>; gh: string[] }

function fakeHost(on: Parameters<TestBody>[1]): Host {
  const files = new Map<string, string>()
  const gh: string[] = []

  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: REPO }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__wololo__${e.name}` } }))
  on('agent.register', (_, e) => ({ value: { agent: `wololo:${e.name}` } }))
  on('agent.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
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
    if (cmd === 'gh') {
      gh.push(args.join(' '))
      return done('https://github.com/acme/shop/issues/12\n')
    }
    if (cmd === 'git') {
      const line = args.join(' ')
      if (line === 'rev-parse --show-toplevel') return done(REPO)
      if (line.startsWith('rev-parse --path-format=absolute --git-common-dir')) return done(`${REPO}/.git`)
      if (line === 'remote get-url origin') return done('git@github.com:acme/shop.git')
    }
    return done('', 1)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }))
  let now = 1_800_000_000_000
  on('clock.now', () => ({ value: (now += 1_000) }))
  on('tool.check', (_, e) => ({ decision: e.tool === 'AskUserQuestion' ? ('allow' as const) : ('ask' as const) }))
  return { files, gh }
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

test('the init review walks from what was detected to the chosen sections and saves', async ($, on) => {
  const host = fakeHost(on)
  on('tool.call', () => ({ result: {} }))
  on('ui.close', () => ({ value: undefined }))
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })
  const answer = parse((await $.tool.call({ tool: 'mcp__wololo__review_config', proposal: { tests: { suite: ['make test'], suite_runs: 'ci' } } } as never)).result)
  expect(answer.opened).toBe(true)
  const ui = await $.ui.mount(CONFIG_PANE)
  expect((await ui.find({ type: 'Text', text: /^tests\.suite_runs/ }))?.text).toBe('tests.suite_runs: ci')
  await ui.press({ key: 'review' })
  await ui.press({ key: 'choose-autonomy' })
  await ui.press({ key: 'continue' })
  await ui.press({ key: 'autonomy=guided' })
  await ui.press({ key: 'next' })
  expect(JSON.parse(host.files.get(`${DATA}/projects/acme__shop/config.json`) ?? '{}')).toEqual({
    tests: { suite: ['make test'], suite_runs: 'ci' },
    autonomy: 'guided',
  })
  await ui.unmount()
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

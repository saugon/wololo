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
  const probe = await $.ui.mount({
    plugin: 'wololo',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 140, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  })
  expect((await probe.find({ type: 'Text', text: /^wololo · / }))?.text).toBe('wololo · #12 Partial payments')
  expect((await probe.find({ type: 'Text', text: /TRABAJANDO/ }))?.text).toBe(' ⟳ TRABAJANDO ')
  expect((await probe.find({ type: 'Text', text: /^1\/8/ }))?.text).toBe('1/8 Contexto')
  expect((await probe.find({ type: 'Text', text: /Aprobar PR/ }))?.text).toBe('· Aprobar PR')
  expect((await probe.find({ type: 'Text', text: /modo checkpoints/ }))?.text).toBe('⏸ modo checkpoints')
  expect((await probe.find({ type: 'Text', text: /frena para aprobar/ }))?.text).toBe('· frena para aprobar el spec y el PR (/wololo config)')
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
  expect((await ui.find({ type: 'Text', text: / i: Ítems / }))?.text).toBe(' i: Ítems ')
  await ui.unmount()
})

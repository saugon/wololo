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
  expect((await probe.find({ type: 'Text', text: /Gate B/ }))?.text).toBe('· Gate B')
  expect(await probe.find({ type: 'Text', text: /^Archivos del run/ })).toBeUndefined()
  await probe.press({ key: 'toggle' })
  expect((await probe.find({ type: 'Text', text: /^Archivos del run/ }))?.text).toContain(`${DATA}/runs/`)
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
  expect(types.slice(-2)).toEqual(['question.asked', 'question.answered'])
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


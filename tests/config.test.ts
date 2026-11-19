import { expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, branchName, branchRef, envPrefix, expand, globToRegExp, parseFlags, planTouched, ports, projectKey, resolve, riskyFiles, slugify, validate, withEnv, withOverrides } from '../hooks/config'
import { helpText } from '../hooks/help'

test('project config overrides global, which overrides defaults; arrays replace', async () => {
  const { config, errors } = resolve({ autonomy: 'full', budgets: { debate_rounds: 3 } }, { autonomy: 'guided', tests: { suite: ['make test'] } })
  expect(errors).toEqual([])
  expect(config.autonomy).toBe('guided')
  expect(config.budgets.debate_rounds).toBe(3)
  expect(config.debate.critic).toBe(DEFAULT_CONFIG.debate.critic)
  expect(config.tests.suite).toEqual(['make test'])
  expect(config.tests.e2e_runs).toBe('local')
})

test('validation names unknown keys, wrong types and bad enum values', async () => {
  expect(validate({ autonomia: 'full' })).toEqual(['autonomia: unknown key'])
  expect(validate({ screenshots: { max: '5' } })).toEqual(['screenshots.max: expected number, got string'])
  expect(validate({ autonomy: 'yolo' })).toEqual(['autonomy: must be one of full, checkpoints, guided'])
  expect(validate({ models: { critic: { model: 'opus' } } })).toEqual([])
})

test('project keys come from the origin remote, or from the git dir', async () => {
  expect(projectKey('git@github.com:lambdaclass/vertex.git', '/x/.git')).toBe('lambdaclass__vertex')
  expect(projectKey('https://github.com/Owner/Repo', '/x/.git')).toBe('owner__repo')
  expect(projectKey('', '/Users/me/code/thing/.git')).toMatch(/^local__thing-[0-9a-f]{8}$/)
})

test('templates fill variables and evaluate port arithmetic', async () => {
  expect(expand('wololo/{ref}-{slug}', { ref: '4312', slug: 'pagos' })).toBe('wololo/4312-pagos')
  expect(expand('4000+10*{slot}', { slot: 2 })).toBe('4020')
  expect(expand('../{repo}.wololo/{run}', { repo: 'vertex', run: 'r1' })).toBe('../vertex.wololo/r1')
})

test('ports are computed per slot with their env', async () => {
  const config = resolve({}, { commands: { start: [{ name: 'backend', cmd: 'make backend.run', port: '4000+10*{slot}', env: { INST: '{slot}', PORT: '{port}' } }] } }).config
  expect(ports(config, 1)).toEqual([{ name: 'backend', port: 4010, cmd: 'make backend.run', env: { INST: '1', PORT: '4010' } }])
})

test('slugs drop accents and punctuation', async () => {
  expect(slugify('Pagos parciales: cobro por pasos ¡ya!')).toBe('pagos-parciales-cobro-por-pasos-ya')
})

test('globs match the usual test file names', async () => {
  expect(globToRegExp('**/*_test.*').test('backend/apps/x/test/orders_test.exs')).toBe(true)
  expect(globToRegExp('**/*_test.*').test('orders_test.exs')).toBe(true)
  expect(globToRegExp('frontend/**/*.test.ts').test('frontend/src/a/b.test.ts')).toBe(true)
  expect(globToRegExp('frontend/**/*.test.ts').test('backend/a.test.ts')).toBe(false)
})

test('touched test files are grouped into the configured commands, the rest reported', async () => {
  const tests = resolve({}, {
    tests: {
      touched: [
        { match: 'backend/**/*_test.exs', cmd: 'make backend.test FILES="{files}"' },
        { match: 'frontend/**/*.test.ts', cmd: 'cd frontend && pnpm vitest run {files}' },
      ],
    },
  }).config.tests
  const plan = planTouched(
    ['backend/apps/a/test/x_test.exs', 'backend/apps/a/lib/x.ex', 'frontend/src/y.test.ts', 'e2e/z.spec.ts', 'backend/apps/a/test/x_test.exs'],
    tests,
  )
  expect(plan.files).toEqual(['backend/apps/a/test/x_test.exs', 'e2e/z.spec.ts', 'frontend/src/y.test.ts'])
  expect(plan.commands).toEqual([
    { cmd: 'make backend.test FILES="backend/apps/a/test/x_test.exs"', files: ['backend/apps/a/test/x_test.exs'] },
    { cmd: 'cd frontend && pnpm vitest run frontend/src/y.test.ts', files: ['frontend/src/y.test.ts'] },
  ])
  expect(plan.unmatched).toEqual(['e2e/z.spec.ts'])
})

test('view colors take theme keys or hex values, and keep the others when only one changes', async () => {
  const { config, errors } = resolve({}, { view: { colors: { working: '#7aa2f7' } } })
  expect(errors).toEqual([])
  expect(config.view.colors).toEqual({ working: '#7aa2f7', waiting: 'warning', blocked: 'error', done: 'success' })
  expect(validate({ view: { colors: { workin: 'red' } } })).toEqual(['view.colors.workin: unknown key'])
})

test('env goes before each step of a project command, never before a cd', async () => {
  const prefix = envPrefix({ set: { MIX_ENV: 'test', LABEL: 'a b' }, unset: ['INST', 'E2E_BACKEND_PORT'] })
  expect(prefix).toBe("env -u INST -u E2E_BACKEND_PORT MIX_ENV=test LABEL='a b'")
  expect(withEnv('cd frontend && pnpm vitest run a.ts', prefix)).toBe(`cd frontend && ${prefix} pnpm vitest run a.ts`)
  expect(withEnv('make test', '')).toBe('make test')
  expect(envPrefix(DEFAULT_CONFIG.env)).toBe('')
})

test('risk paths pick the changed files that make a run high risk', async () => {
  const files = ['backend/priv/repo/migrations/1_add.exs', 'frontend/src/a.ts', 'infra/main.tf']
  expect(riskyFiles(files, ['**/migrations/**', 'infra/**'])).toEqual(['backend/priv/repo/migrations/1_add.exs', 'infra/main.tf'])
  expect(riskyFiles(files, [])).toEqual([])
  expect(validate({ risk_paths: ['a/**'], env: { set: { A: '1' }, unset: ['INST'] } })).toEqual([])
})

test('debate.max_rounds from an earlier config becomes budgets.debate_rounds, unless that is set', async () => {
  const old = resolve({ debate: { max_rounds: 4, depth: 'deep' } }, {})
  expect(old.errors).toEqual([])
  expect(old.config.debate.depth).toBe('deep')
  expect(old.config.budgets.debate_rounds).toBe(4)
  expect(resolve({ debate: { max_rounds: 4 }, budgets: { debate_rounds: 1 } }, {}).config.budgets.debate_rounds).toBe(1)
})

test('launch flags become a mode, a review and config paths for one run; bad ones are named', async () => {
  const flags = parseFlags(['--guided', '--review-pr', '--awake', '--no-adapters', '--base=release/2.4', '--e2e=off', '--ready'])
  expect([flags.mode, flags.review, flags.errors]).toEqual(['guided', 'pr', []])
  const config = withOverrides({ ...DEFAULT_CONFIG, adapters: { plan: { steps: [{ cmd: 'make plan' }] } } }, flags.overrides)
  expect([config.keep_awake, config.adapters, config.pr.base, config.pr.draft, config.tests.e2e_runs]).toEqual([true, {}, 'release/2.4', false, 'off'])
  expect(config.pr.enabled).toBe(true)
  expect(parseFlags(['--e2e=sometimes', '--base', '--yolo']).errors).toEqual([
    '--base needs a value: --base=<value>',
    'unknown flag --yolo',
    'tests.e2e_runs: must be one of local, ci, off (from a flag)',
  ])
})

test('the final review is set, given arguments or turned off by flag for one run', async () => {
  const set = parseFlags(['--final-review=review-v1', '--final-review-args=high {branch}'])
  expect(set.errors).toEqual([])
  expect(withOverrides(DEFAULT_CONFIG, set.overrides).review.final).toEqual({ skill: 'review-v1', args: 'high {branch}' })
  const configured = { ...DEFAULT_CONFIG, review: { ...DEFAULT_CONFIG.review, final: { skill: 'code-review', args: 'high' } } }
  expect(withOverrides(configured, parseFlags(['--no-final-review']).overrides).review.final.skill).toBe('')
})

test('--node ties the run to the goal node Wololo Desk launched it from, and sets no config', async () => {
  const flags = parseFlags(['--node=g1/n1', '--full'])
  expect(flags.errors).toEqual([])
  expect(flags.node).toEqual({ goal: 'g1', id: 'n1' })
  expect(flags.overrides).toEqual({})
  expect(parseFlags(['--node=g1']).errors).toEqual(['--node needs a goal and a node: --node=<goal>/<node>'])
  expect(parseFlags(['--node=']).errors.length).toBe(1)
})

test("the help says, next to each launch flag, what the project's config does without it", async () => {
  const { config } = resolve({}, { autonomy: 'full', keep_awake: true, spec: { to_github: false }, pr: { base: 'develop' } })
  const text = helpText('es', config)
  expect(text).toContain('--full: no pregunta: decide solo y anota cada supuesto (sin flag)')
  expect(text).toContain('--checkpoints: frena para aprobar el spec y el PR\n')
  expect(text).toContain('(sin flag: --awake)')
  expect(text).toContain('(sin flag: --no-github-spec)')
  expect(text).toContain('(sin flag: --base=develop)')
  expect(text).toContain('(sin flag: no hay adaptadores configurados)')
  expect(helpText('en', DEFAULT_CONFIG)).toContain('--checkpoints: stops to approve the spec and the PR (without a flag)')
})

test('a branch takes the issue number or the plan name, and a text source leaves no placeholder behind', async () => {
  const vars = { repo: 'shop', run: 'shop-txt-abc123', slug: 'split-payments' }
  expect(branchName('feat/{ref}-{slug}', { ...vars, ref: branchRef({ kind: 'github_issue', ref: '#4734' }) })).toBe('feat/4734-split-payments')
  expect(branchName('feat/{ref}-{slug}', { ...vars, ref: branchRef({ kind: 'file', ref: 'docs/plans/pagos.md' }) })).toBe('feat/pagos-md-split-payments')
  expect(branchName('feat/{ref}-{slug}', { ...vars, ref: branchRef({ kind: 'text', ref: 'x' }) })).toBe('feat/split-payments')
  expect(branchName('wololo/{ref}/{slug}', { ...vars, ref: '' })).toBe('wololo/split-payments')
})

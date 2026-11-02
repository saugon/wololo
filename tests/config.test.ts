import { expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, envPrefix, expand, globToRegExp, planTouched, ports, projectKey, resolve, riskyFiles, slugify, validate, withEnv } from '../hooks/config'

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

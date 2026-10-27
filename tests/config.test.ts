import { expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, expand, globToRegExp, planTouched, ports, projectKey, resolve, slugify, validate } from '../hooks/config'

test('project config overrides global, which overrides defaults; arrays replace', async () => {
  const { config, errors } = resolve({ autonomy: 'full', debate: { max_rounds: 3 } }, { autonomy: 'guided', tests: { suite: ['make test'] } })
  expect(errors).toEqual([])
  expect(config.autonomy).toBe('guided')
  expect(config.debate.max_rounds).toBe(3)
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

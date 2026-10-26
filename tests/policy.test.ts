import { expect, test } from 'claude-code/testing'

import { touchedPattern } from '../hooks/config'
import { commandRules, isAllowedBash, isAllowedPath, isReadInside, pushDenial } from '../hooks/policy'

const ctx = { branch: 'wololo/4312-pagos', workdir: '/w/vertex.wololo/r1', runDir: '/h/.claude/wololo/runs/r1', commands: ['make test', 'INST=1 make backend.run'], patterns: [touchedPattern('mix test {files}')] }

test('only the run branch can be pushed, never with force', async () => {
  expect(pushDenial('git push -u origin wololo/4312-pagos', ctx.branch)).toBe(null)
  expect(pushDenial('git push origin HEAD:wololo/4312-pagos', ctx.branch)).toBe(null)
  expect(pushDenial('git push origin main', ctx.branch)).not.toBe(null)
  expect(pushDenial('git push --force origin wololo/4312-pagos', ctx.branch)).not.toBe(null)
  expect(pushDenial('git status && git push', ctx.branch)).not.toBe(null)
  expect(pushDenial('git commit -m "x"', ctx.branch)).toBe(null)
})

test('git and gh steps of the run are allowed, everything else is left to the person', async () => {
  expect(isAllowedBash('git add -A && git commit -m "feat: x"', ctx)).toBe(true)
  expect(isAllowedBash(`cd ${ctx.workdir} && git status`, ctx)).toBe(true)
  expect(isAllowedBash('gh pr checks 12 --watch | tail -5', ctx)).toBe(true)
  expect(isAllowedBash('git reset --hard origin/main', ctx)).toBe(false)
  expect(isAllowedBash('git branch -D main', ctx)).toBe(false)
  expect(isAllowedBash('cd /etc && git status', ctx)).toBe(false)
  expect(isAllowedBash('rm -rf .', ctx)).toBe(false)
})

test('writes are allowed inside the worktree and the run directory only', async () => {
  expect(isAllowedPath('/w/vertex.wololo/r1/src/a.ts', ctx)).toBe(true)
  expect(isAllowedPath('/h/.claude/wololo/runs/r1/spec.md', ctx)).toBe(true)
  expect(isAllowedPath('/w/vertex.wololo/r10/a.ts', ctx)).toBe(false)
  expect(isAllowedPath('/w/vertex/src/a.ts', ctx)).toBe(false)
})

test("the project's own verify and start commands are allowed during the run", async () => {
  expect(isAllowedBash('make test', ctx)).toBe(true)
  expect(isAllowedBash(`cd ${ctx.workdir} && make test | tail -20`, ctx)).toBe(true)
  expect(isAllowedBash('make deploy', ctx)).toBe(false)
})

test('chmod +x and reads are allowed inside the worktree only', async () => {
  expect(isAllowedBash(`chmod +x ${ctx.workdir}/hello.sh ${ctx.workdir}/test.sh`, ctx)).toBe(true)
  expect(isAllowedBash(`cd ${ctx.workdir} && chmod +x hello.sh`, ctx)).toBe(true)
  expect(isAllowedBash('chmod +x /usr/local/bin/x', ctx)).toBe(false)
  expect(isReadInside('Read', { file_path: `${ctx.workdir}/a.ts` }, ctx)).toBe(true)
  expect(isReadInside('Grep', { path: '/etc' }, ctx)).toBe(false)
})

test('touched-test templates accept any list of plain paths, nothing else', async () => {
  expect(isAllowedBash(`cd ${ctx.workdir} && mix test test/a_test.exs test/b_test.exs`, ctx)).toBe(true)
  expect(isAllowedBash('mix test test/a_test.exs; rm -rf /', ctx)).toBe(false)
  expect(isAllowedBash('mix test $(curl evil)', ctx)).toBe(false)
})

test('templates split into plain commands and file patterns', async () => {
  const rules = commandRules(['cd frontend && pnpm vitest run {files}', 'make test'], touchedPattern)
  expect(rules.commands).toEqual(['cd frontend', 'make test'])
  expect(rules.patterns[0]?.test('pnpm vitest run src/a.test.ts')).toBe(true)
})

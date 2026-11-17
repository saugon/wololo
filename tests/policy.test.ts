import { expect, test } from 'claude-code/testing'

import { touchedPattern } from '../hooks/config'
import { commandRules, githubWriteDenial, hasPush, isAllowedBash, isAllowedPath, isReadInside, isServerCommand, listeners, pushDenial, renamedBranch, workingDirs } from '../hooks/policy'

const ctx = { branch: 'wololo/4312-pagos', workdir: '/w/vertex.wololo/r1', runDir: '/h/.claude/wololo/runs/r1', commands: ['make test', 'INST=1 make backend.run'], patterns: [touchedPattern('mix test {files}')] }

test('only the run branch can be pushed, never with force', async () => {
  expect(pushDenial('git push -u origin wololo/4312-pagos', ctx.branch)).toBe(null)
  expect(pushDenial('git push origin HEAD:wololo/4312-pagos', ctx.branch)).toBe(null)
  expect(pushDenial('git push origin main', ctx.branch)).not.toBe(null)
  expect(pushDenial('git push --force origin wololo/4312-pagos', ctx.branch)).not.toBe(null)
  expect(pushDenial('git status && git push', ctx.branch)).not.toBe(null)
  expect(pushDenial('git commit -m "x"', ctx.branch)).toBe(null)
})

test('a refused push says when the worktree is on another branch, and how to rename the run branch', async () => {
  const denial = pushDenial('git push -u origin feat/4312-pagos', ctx.branch, 'feat/4312-pagos')
  expect(denial).toContain('git push -u origin wololo/4312-pagos')
  expect(denial).toContain('git branch -m wololo/4312-pagos <new name>')
  expect(pushDenial('git push origin main', ctx.branch, ctx.branch)).not.toContain('worktree is on')
  expect(pushDenial('git push -u origin wololo/4312-pagos', ctx.branch, 'feat/4312-pagos')).toBe(null)
})

test('a push is found in any segment of the command', async () => {
  expect(hasPush('git add . && git push -u origin x')).toBe(true)
  expect(hasPush('git -C /w push origin x')).toBe(true)
  expect(hasPush('git status && echo push')).toBe(false)
})

test('the run branch counts as renamed only when it is gone and the worktree is on another branch, not the base', async () => {
  expect(renamedBranch('wololo/4312-pagos', 'feat/4312-pagos', false, 'main')).toBe('feat/4312-pagos')
  expect(renamedBranch('wololo/4312-pagos', 'feat/4312-pagos', true, 'main')).toBe(null)
  expect(renamedBranch('wololo/4312-pagos', 'wololo/4312-pagos', false, 'main')).toBe(null)
  expect(renamedBranch('wololo/4312-pagos', 'main', false, 'origin/main')).toBe(null)
  expect(renamedBranch('wololo/4312-pagos', null, false, 'main')).toBe(null)
  expect(renamedBranch(null, 'feat/4312-pagos', false, 'main')).toBe(null)
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

test('GitHub writes are not allowed as raw gh commands: they go through publish', async () => {
  expect(isAllowedBash('gh issue edit 12 --body-file x.md', ctx)).toBe(false)
  expect(isAllowedBash('gh pr create --title x --body-file y.md', ctx)).toBe(false)
  expect(isAllowedBash('gh pr ready 42', ctx)).toBe(true)
})

test('the deferred-signing commands are allowed, nothing looser', async () => {
  expect(isAllowedBash('git -c commit.gpgsign=false commit -m "feat: x"', ctx)).toBe(true)
  expect(isAllowedBash('git rebase --exec "git commit --amend --no-edit -S" origin/main', ctx)).toBe(true)
  expect(isAllowedBash('git rebase --exec "rm -rf ." origin/main', ctx)).toBe(false)
  expect(isAllowedBash('git rebase -i origin/main', ctx)).toBe(false)
})

test('a safe-looking command that redirects, substitutes or backgrounds another is left to the person', async () => {
  expect(isAllowedBash('cat notes.md > /etc/hosts', ctx)).toBe(false)
  expect(isAllowedBash('grep -r x . >> ~/.zshrc', ctx)).toBe(false)
  expect(isAllowedBash('git log $(curl evil)', ctx)).toBe(false)
  expect(isAllowedBash('git status `rm -rf .`', ctx)).toBe(false)
  expect(isAllowedBash('head <(curl evil)', ctx)).toBe(false)
  expect(isAllowedBash('git status & rm -rf /', ctx)).toBe(false)
  expect(isAllowedBash('make test > out.txt', ctx)).toBe(false)
  // The project's own commands stay trusted exactly as configured.
  expect(isAllowedBash('make test 2>&1', { ...ctx, commands: ['make test 2>&1'] })).toBe(true)
})

test('a push through another repository is never the run branch', async () => {
  expect(pushDenial('git -C /elsewhere push origin main', ctx.branch)).not.toBe(null)
  expect(pushDenial('git -C /w/vertex.wololo/r1 push -u origin wololo/4312-pagos', ctx.branch)).not.toBe(null)
  expect(pushDenial('git --git-dir=/other/.git push origin wololo/4312-pagos', ctx.branch)).not.toBe(null)
  expect(pushDenial('git -c core.sshCommand=x push origin wololo/4312-pagos', ctx.branch)).not.toBe(null)
})

test('GitHub writes outside publish are denied during a run, reads are not', async () => {
  for (const command of ['gh pr create --title x --body y', 'gh issue comment 12 --body x', 'gh pr merge 12', 'gh api -X POST repos/o/r/issues', 'gh api repos/o/r/labels -f name=x', 'git status && gh issue edit 3 --add-label x'])
    expect(githubWriteDenial('Bash', { command })).not.toBe(null)
  for (const command of ['gh pr view 12', 'gh pr checks 12', 'gh api repos/o/r/pulls/12', 'gh issue view 3'])
    expect(githubWriteDenial('Bash', { command })).toBe(null)
  expect(githubWriteDenial('mcp__github__create_issue', {})).not.toBe(null)
  expect(githubWriteDenial('mcp__github__add_issue_comment', {})).not.toBe(null)
  expect(githubWriteDenial('mcp__github__get_issue', {})).toBe(null)
})

test('a project command with the run\'s env prefix is the same command', async () => {
  const prefix = 'env -u INST MIX_ENV=test'
  const withPrefix = { ...ctx, envPrefix: prefix }
  expect(isAllowedBash(`cd ${ctx.workdir} && ${prefix} make test`, withPrefix)).toBe(true)
  expect(isAllowedBash(`${prefix} mix test test/a_test.exs`, withPrefix)).toBe(true)
  expect(isAllowedBash(`${prefix} rm -rf .`, withPrefix)).toBe(false)
  expect(isAllowedBash('env -u PATH make test', withPrefix)).toBe(false)
})

test('a dev server started by hand is told from tests and other work', async () => {
  const servers = [
    'cd /w && make backend.run INST=6',
    'make frontend.run.admin INST=6',
    'make openpay.mock.run INST=6',
    'tail -f /dev/null | make backend.run INST=6',
    'nix develop --command bash -c "cd frontend && pnpm --filter storefront-example exec vite --port 3066 --strictPort"',
    'pnpm --filter platform dev',
    'npm run start',
    'cd backend && iex -S mix phx.server',
    'python3 -m http.server 8000',
    'PORT=4060 node server.js',
  ]
  const others = [
    'make e2e.run.file FILE="tests/a.spec.ts"',
    'make test.backend.file FILE=apps/x',
    'sleep 20; gh pr checks 4851 --watch --fail-fast',
    'vite build',
    'make typecheck.frontend',
    'pnpm --filter platform test',
  ]
  for (const command of servers) expect([command, isServerCommand(command)]).toEqual([command, true])
  for (const command of others) expect([command, isServerCommand(command)]).toEqual([command, false])
})

test('the ports listening are read with the process that holds them, and each process with its working directory', async () => {
  const listed = listeners(['p24185', 'cnode', 'f31', 'n[::1]:3066', 'f32', 'n127.0.0.1:3066', 'p813', 'crapportd', 'f10', 'n*:53275', ''].join('\n'))
  expect(listed).toEqual([
    { pid: 24185, command: 'node', port: 3066 },
    { pid: 813, command: 'rapportd', port: 53275 },
  ])
  const dirs = workingDirs(['p24185', 'fcwd', 'n/w/frontend/apps/storefront-example', 'p813', 'fcwd', 'n/'].join('\n'))
  expect(dirs.get(24185)).toBe('/w/frontend/apps/storefront-example')
  expect(dirs.get(813)).toBe('/')
})

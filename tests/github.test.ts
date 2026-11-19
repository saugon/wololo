import { expect, test } from 'claude-code/testing'

import { decide, ghArgs, isWololoRepo, prComments, urlIn, wololoMention } from '../hooks/github'

test('a text that fits goes whole', async () => {
  expect(decide(1_000, null, 65_000)).toEqual({ send: 'full', length: 1_000 })
})

test('a text that does not fit sends nothing until there is a summary, then the summary', async () => {
  expect(decide(70_000, null, 65_000).send).toBe('nothing')
  expect(decide(70_000, 3_000, 65_000)).toEqual({ send: 'summary', length: 70_000, summaryLength: 3_000 })
  expect(decide(70_000, 66_000, 65_000).send).toBe('nothing')
})

test('gh arguments per kind, and their required fields', async () => {
  expect(ghArgs({ kind: 'issue_body', number: 12 }, '/r/issue-body.md')).toEqual(['issue', 'edit', '12', '--body-file', '/r/issue-body.md'])
  expect(ghArgs({ kind: 'pr_create', title: 'feat: x', base: 'main', head: 'wololo/12-x', draft: true }, '/r/pr-body.md')).toEqual([
    'pr', 'create', '--title', 'feat: x', '--base', 'main', '--head', 'wololo/12-x', '--body-file', '/r/pr-body.md', '--draft',
  ])
  expect(ghArgs({ kind: 'issue_comment' }, '/r/c.md')).toBe('issue_comment needs number.')
  expect(ghArgs({ kind: 'pr_body', number: 4813 }, '/r/pr-body.md')).toEqual(['pr', 'edit', '4813', '--body-file', '/r/pr-body.md'])
  expect(ghArgs({ kind: 'pr_comment', number: 4813 }, '/r/c.md')).toEqual(['pr', 'comment', '4813', '--body-file', '/r/c.md'])
  expect(ghArgs({ kind: 'pr_body' }, '/r/pr-body.md')).toBe('pr_body needs number.')
  expect(ghArgs({ kind: 'pr_ready', number: 4873 }, '')).toEqual(['pr', 'ready', '4873'])
  expect(ghArgs({ kind: 'pr_ready' }, '')).toBe('pr_ready needs number.')
})

test('the URL gh prints is found', async () => {
  expect(urlIn('Creating pull request\nhttps://github.com/acme/shop/pull/42\n')).toBe('https://github.com/acme/shop/pull/42')
})

test('wololoMention finds the tool named anywhere, with the words around it', () => {
  expect(wololoMention('feat: offline payments\n\nCloses #12')).toBeNull()
  expect(wololoMention('The full spec is kept in Wololo run vertex-12-abc.')).toContain('Wololo run vertex-12-abc')
  expect(wololoMention('wololo/12-pagos')).toBe('wololo/12-pagos')
})

test('isWololoRepo is true only for wololo\'s own repository', () => {
  expect(isWololoRepo('saugon__wololo')).toBe(true)
  expect(isWololoRepo('wololo')).toBe(true)
  expect(isWololoRepo('lambdaclass__vertex')).toBe(false)
  expect(isWololoRepo('acme__wololo-fork')).toBe(false)
})

test("the PR's comments, reviews that say something and line comments count, the gh login's own do not", async () => {
  const view = {
    comments: [
      { author: { login: 'ana' }, createdAt: '2026-11-19T10:00:00Z' },
      { author: { login: 'me' }, createdAt: '2026-11-19T10:05:00Z' },
    ],
    reviews: [
      { author: { login: 'chatgpt-codex-connector' }, submittedAt: '2026-11-19T10:10:00Z', state: 'COMMENTED', body: 'Two issues' },
      { author: { login: 'luis' }, submittedAt: '2026-11-19T10:11:00Z', state: 'COMMENTED', body: '' },
      { author: { login: 'luis' }, submittedAt: '2026-11-19T10:12:00Z', state: 'CHANGES_REQUESTED', body: '' },
    ],
  }
  const lines = 'chatgpt-codex-connector[bot]\t2026-11-19T10:10:01Z\nme\t2026-11-19T10:20:00Z\nnot a line\n'
  expect(prComments(view, lines, 'me')).toEqual([
    { author: 'ana', at: '2026-11-19T10:00:00Z' },
    { author: 'chatgpt-codex-connector', at: '2026-11-19T10:10:00Z' },
    { author: 'luis', at: '2026-11-19T10:12:00Z' },
    { author: 'chatgpt-codex-connector', at: '2026-11-19T10:10:01Z' },
  ])
  expect(prComments('nope', '', null)).toEqual([])
})

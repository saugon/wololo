import { expect, test } from 'claude-code/testing'

import { decide, ghArgs, urlIn } from '../hooks/github'

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
})

test('the URL gh prints is found', async () => {
  expect(urlIn('Creating pull request\nhttps://github.com/acme/shop/pull/42\n')).toBe('https://github.com/acme/shop/pull/42')
})

import { expect, test } from 'claude-code/testing'

import { decide, ghArgs, isWololoRepo, prComments, prState, threadOf, urlIn, wololoMention } from '../hooks/github'

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
  // A comment on a line is answered in its thread, and the reply's link is what comes back.
  expect(ghArgs({ kind: 'pr_reply', number: 5151, commentId: 2611 }, '/r/reply.md')).toEqual([
    'api', '--method', 'POST', 'repos/{owner}/{repo}/pulls/5151/comments/2611/replies', '-F', 'body=@/r/reply.md', '--jq', '.html_url',
  ])
  expect(ghArgs({ kind: 'pr_reply', number: 5151 }, '/r/reply.md')).toBe('pr_reply needs number and comment_id.')
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

const user = (login: string) => ({ __typename: 'User', login })
const bot = (login: string) => ({ __typename: 'Bot', login })

test('the PR state reads the review, the reviewers, the checks and what is left unanswered', async () => {
  const pr = {
    mergeQueueEntry: null,
    reviewDecision: 'CHANGES_REQUESTED',
    mergeStateStatus: 'BEHIND',
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'leo' } }, { requestedReviewer: { __typename: 'Team', slug: 'web' } }] },
    latestReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: user('ana') }, { state: 'APPROVED', author: user('mia') }, { state: 'APPROVED', author: bot('copilot') }] },
    reviews: { nodes: [{ body: 'Mirá el nombre', createdAt: '2026-11-20T10:00:00Z', author: user('ana') }, { body: '', createdAt: '2026-11-20T12:00:00Z', author: user('mia') }] },
    comments: { nodes: [{ createdAt: '2026-11-20T11:00:00Z', author: user('me') }, { createdAt: '2026-11-20T13:00:00Z', author: bot('vercel') }] },
    reviewThreads: {
      nodes: [
        { isResolved: false, comments: { nodes: [{ author: user('ana') }] } },
        { isResolved: false, comments: { nodes: [{ author: user('ana') }, { author: user('me') }] } },
        { isResolved: true, comments: { nodes: [{ author: user('ana') }] } },
        { isResolved: false, comments: { nodes: [{ author: user('ana') }, { author: user('me') }, { author: bot('coderabbit') }] } },
      ],
    },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }, { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'StatusContext', state: 'ERROR' }] } } } }] },
  }
  expect(prState(pr, 'me')).toEqual({
    queue: null,
    review: {
      decision: 'changes_requested',
      approved_by: ['mia'],
      changes_by: ['ana'],
      requested: ['leo', 'web'],
      // Two open threads end on someone else's word, a reviewing bot's too; the conversation's last human word is the
      // person's (the deploy bot's after it does not count).
      unanswered: 2,
      checks: 'failing',
      failing: 2,
      behind: true,
    },
  })
  // Unknown who the person is, nothing is counted as unanswered.
  expect(prState(pr, null)?.review.unanswered).toBe(0)
})

test('a PR with nothing to say reads as no review asked, no checks, and its queue as unknown', async () => {
  expect(prState({}, 'me')).toEqual({
    queue: undefined,
    review: { decision: null, approved_by: [], changes_by: [], requested: [], unanswered: 0, checks: null, failing: 0, behind: false },
  })
  expect(prState({ mergeQueueEntry: { position: 3, state: 'AWAITING_CHECKS' }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] } }, 'me')?.review.checks).toBe('pending')
  expect(prState({ mergeQueueEntry: { position: 3, state: 'AWAITING_CHECKS' } }, 'me')?.queue).toEqual({ position: 3, state: 'AWAITING_CHECKS' })
  expect(prState(null, 'me')).toBeNull()
})

test('the thread a line comment is in is found by any of its comments', async () => {
  const pr = {
    reviewThreads: {
      nodes: [
        { id: 'T1', isResolved: false, comments: { nodes: [{ databaseId: 10 }, { databaseId: 11 }] } },
        { id: 'T2', isResolved: true, comments: { nodes: [{ databaseId: 20 }] } },
      ],
    },
  }
  expect(threadOf(pr, 11)).toEqual({ id: 'T1', isResolved: false })
  expect(threadOf(pr, 20)).toEqual({ id: 'T2', isResolved: true })
  expect(threadOf(pr, 99)).toBeNull()
  expect(threadOf(null, 10)).toBeNull()
})

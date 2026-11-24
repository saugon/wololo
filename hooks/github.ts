import type { PrReview } from './model'

export const GITHUB_BODY_LIMIT = 65_000

export type PublishKind = 'issue_body' | 'issue_comment' | 'issue_create' | 'pr_create' | 'pr_body' | 'pr_comment' | 'pr_ready'

// The writes spec.to_github governs: what the run puts on the issue.
export function isIssueWrite(kind: PublishKind): boolean {
  return kind === 'issue_body' || kind === 'issue_comment' || kind === 'issue_create'
}

export type PublishDecision =
  | { send: 'full'; length: number }
  | { send: 'summary'; length: number; summaryLength: number }
  | { send: 'nothing'; reason: string }

export function decide(bodyLength: number, summaryLength: number | null, limit = GITHUB_BODY_LIMIT): PublishDecision {
  if (bodyLength <= limit) return { send: 'full', length: bodyLength }
  if (summaryLength === null) {
    return {
      send: 'nothing',
      reason: `The text has ${bodyLength} characters and GitHub takes ${limit}. Write a summary to a file and call again with summary_file; the full text stays in its file.`,
    }
  }
  if (summaryLength > limit)
    return { send: 'nothing', reason: `The summary has ${summaryLength} characters and GitHub takes ${limit}. Shorten it.` }
  return { send: 'summary', length: bodyLength, summaryLength }
}

export type PublishTarget = {
  kind: PublishKind
  number?: number
  title?: string
  base?: string
  head?: string
  draft?: boolean
}

export function ghArgs(target: PublishTarget, file: string): string[] | string {
  switch (target.kind) {
    case 'issue_body':
      return target.number ? ['issue', 'edit', String(target.number), '--body-file', file] : 'issue_body needs number.'
    case 'issue_comment':
      return target.number ? ['issue', 'comment', String(target.number), '--body-file', file] : 'issue_comment needs number.'
    case 'issue_create':
      return target.title ? ['issue', 'create', '--title', target.title, '--body-file', file] : 'issue_create needs title.'
    case 'pr_create': {
      if (!target.title || !target.base || !target.head) return 'pr_create needs title, base and head.'
      const args = ['pr', 'create', '--title', target.title, '--base', target.base, '--head', target.head, '--body-file', file]
      return target.draft ? [...args, '--draft'] : args
    }
    case 'pr_body':
      return target.number ? ['pr', 'edit', String(target.number), '--body-file', file] : 'pr_body needs number.'
    case 'pr_comment':
      return target.number ? ['pr', 'comment', String(target.number), '--body-file', file] : 'pr_comment needs number.'
    case 'pr_ready':
      return target.number ? ['pr', 'ready', String(target.number)] : 'pr_ready needs number.'
  }
}

// wololo is the person's tool, not part of the change: nothing the run leaves on GitHub (a branch, a PR or issue title or body, a
// comment) names it. Its own repository is the exception, where wololo is the subject. The words around the first mention, or null.
export function wololoMention(text: string): string | null {
  const match = /wololo/i.exec(text)
  if (!match) return null
  const start = Math.max(0, match.index - 30)
  return text.slice(start, match.index + 36).replace(/\s+/g, ' ').trim()
}

export function isWololoRepo(projectKey: string): boolean {
  return /(^|__)wololo$/.test(projectKey)
}

export function urlIn(text: string): string | null {
  return /https:\/\/github\.com\/\S+\/(?:issues|pull)\/\d+(?:#\S+)?/.exec(text)?.[0] ?? null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type PrComment = { author: string; at: string }

// The PR's comments, reviews with a word or a verdict, and the comments on its lines, from whoever is not the gh login.
export function prComments(view: unknown, lines: string, viewer: string | null): PrComment[] {
  const out: PrComment[] = []
  // GitHub names a bot `codex[bot]` on a line comment and `codex` elsewhere: one name for both.
  const name = (login: string) => login.replace(/\[bot\]$/, '')
  const login = (author: unknown) => (isObject(author) && typeof author.login === 'string' ? name(author.login) : '')
  if (isObject(view)) {
    for (const c of Array.isArray(view.comments) ? view.comments : []) {
      if (isObject(c) && typeof c.createdAt === 'string') out.push({ author: login(c.author), at: c.createdAt })
    }
    for (const r of Array.isArray(view.reviews) ? view.reviews : []) {
      if (!isObject(r) || typeof r.submittedAt !== 'string') continue
      const said = typeof r.body === 'string' && r.body.trim() !== ''
      if (said || r.state === 'CHANGES_REQUESTED') out.push({ author: login(r.author), at: r.submittedAt })
    }
  }
  for (const line of lines.split('\n')) {
    const [author = '', at = ''] = line.split('\t')
    if (author && /^\d{4}-\d\d-\d\dT/.test(at)) out.push({ author: name(author), at })
  }
  return out.filter(c => c.author && c.author !== (viewer && name(viewer)))
}

// One query for what the PR card shows: its merge queue entry and where its review stands.
export const PR_STATE_QUERY = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){
mergeQueueEntry{position state}
reviewDecision mergeStateStatus
reviewRequests(first:20){nodes{requestedReviewer{__typename ... on User{login} ... on Team{slug} ... on Bot{login}}}}
latestReviews(first:30){nodes{state author{__typename login}}}
reviews(last:30){nodes{body createdAt author{__typename login}}}
comments(last:30){nodes{createdAt author{__typename login}}}
reviewThreads(first:100){nodes{isResolved comments(last:20){nodes{author{__typename login}}}}}
commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){nodes{__typename ... on CheckRun{status conclusion} ... on StatusContext{state}}}}}}}
}}}`

type Author = { login: string; bot: boolean }

function author(node: unknown): Author | null {
  if (!isObject(node) || !isObject(node.author) || typeof node.author.login !== 'string') return null
  const login = node.author.login
  return { login, bot: node.author.__typename === 'Bot' || login.endsWith('[bot]') }
}

function nodes(value: unknown): unknown[] {
  return isObject(value) && Array.isArray(value.nodes) ? value.nodes : []
}

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])

// The merge queue entry (null when out of it, undefined when the answer does not say) and the review, from
// PR_STATE_QUERY's pullRequest. A conversation is unanswered when its last word is not `viewer`'s: an open review thread
// whoever wrote last, reviewing bots such as Devin or Codex too; the PR's own comments and reviews with bots aside, which
// there are mostly deploys and coverage. With no viewer known, none is counted. Null when `pr` is not a pull request.
export function prState(pr: unknown, viewer: string | null): { queue: { position: number | null; state: string } | null | undefined; review: PrReview } | null {
  if (!isObject(pr)) return null
  const entry = pr.mergeQueueEntry
  const queue =
    entry === null
      ? null
      : isObject(entry) && typeof entry.state === 'string'
        ? { position: typeof entry.position === 'number' ? entry.position : null, state: entry.state }
        : undefined

  const decision =
    pr.reviewDecision === 'APPROVED' ? 'approved' : pr.reviewDecision === 'CHANGES_REQUESTED' ? 'changes_requested' : pr.reviewDecision === 'REVIEW_REQUIRED' ? 'review_required' : null
  const latest = nodes(pr.latestReviews).filter(isObject)
  const by = (state: string) =>
    latest.filter(r => r.state === state).map(author).filter((a): a is Author => !!a && !a.bot).map(a => a.login)
  const requested = nodes(pr.reviewRequests)
    .map(n => (isObject(n) && isObject(n.requestedReviewer) ? n.requestedReviewer : null))
    .map(r => (r && typeof r.login === 'string' ? r.login : r && typeof r.slug === 'string' ? r.slug : null))
    .filter((n): n is string => !!n)

  let unanswered = 0
  if (viewer) {
    const lastHuman = (list: unknown[]) => list.map(author).filter((a): a is Author => !!a && !a.bot).at(-1)
    for (const thread of nodes(pr.reviewThreads)) {
      if (!isObject(thread) || thread.isResolved === true) continue
      const last = nodes(thread.comments).map(author).at(-1)
      if (last && last.login !== viewer) unanswered++
    }
    // The PR's own conversation: its comments and the reviews that say something, in the order they were written.
    const said = [
      ...nodes(pr.comments).filter(isObject),
      ...nodes(pr.reviews).filter(r => isObject(r) && typeof r.body === 'string' && r.body.trim() !== '').filter(isObject),
    ].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    const last = lastHuman(said)
    if (last && last.login !== viewer) unanswered++
  }

  const commit = nodes(pr.commits)[0]
  const rollup = isObject(commit) && isObject(commit.commit) && isObject(commit.commit.statusCheckRollup) ? commit.commit.statusCheckRollup : null
  const failing = rollup
    ? nodes(rollup.contexts).filter(c => isObject(c) && (FAILED.has(String(c.conclusion)) || FAILED.has(String(c.__typename === 'StatusContext' ? c.state : '')))).length
    : 0
  const state = rollup ? String(rollup.state) : ''
  const checks = !rollup ? null : state === 'SUCCESS' ? 'passing' : state === 'FAILURE' || state === 'ERROR' ? 'failing' : 'pending'

  return {
    queue,
    review: {
      decision,
      approved_by: by('APPROVED'),
      changes_by: by('CHANGES_REQUESTED'),
      requested,
      unanswered,
      checks,
      failing,
      behind: pr.mergeStateStatus === 'BEHIND',
    },
  }
}

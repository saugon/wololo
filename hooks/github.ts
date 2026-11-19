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

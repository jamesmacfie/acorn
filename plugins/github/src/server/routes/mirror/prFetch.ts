import { createLogger, type RouteFailure, type RouteResult } from '@acorn/plugin-api/node'
import type { PullTopologyCompleteness } from '../../../shared/api'
import { gh, ghError, ghGraphQL, ghGraphQLResult } from '../../githubApi'
import { mapLimited } from '../../mapLimited'

// Fetching one pull request from GitHub, completely, before anything is written. The GraphQL detail
// walks every connection to its end through one cursor walker, and the REST files list walks every
// page up to GitHub's ceiling. Both return a staged value; prMirror.ts swaps it into the mirror in one
// batch, so a failure on any page leaves the previous mirror exactly as it was.
//
// A module with no `ctx` in reach, so the owner is stated here (docs/plugin-authoring.md §
// Telemetry and logging).
const log = createLogger('github', 'github')

export const COMPLETE = { kind: 'complete' } as const satisfies PullTopologyCompleteness

// GraphQL's largest page. Every connection asks for it.
const PAGE_SIZE = 100
// Review threads, and the checks and comments inside them, fetch their later pages a few at a time.
const CONTINUATION_CONCURRENCY = 4

// ─── GraphQL detail ──────────────────────────────────────────────────────────

type PageInfo = { endCursor: string | null; hasNextPage: boolean }
export type Connection<T> = { pageInfo: PageInfo; nodes: T[] }

type GqlActor = { login: string } | null
export type GqlLabel = { name: string; color: string | null }
export type GqlReview = { id: string; author: GqlActor; state: string; bodyHTML: string | null; submittedAt: string | null }
export type GqlReviewRequest = { id: string; requestedReviewer: { login?: string } | null }
export type GqlComment = { id: string; author: GqlActor; bodyHTML: string | null; createdAt: string | null }
export type GqlCommit = {
  commit: {
    oid: string
    messageHeadline: string
    committedDate: string | null
    author: { name: string | null; user: { login: string } | null } | null
  }
}
export type GqlThreadComment = { id: string; databaseId: number | null; author: GqlActor; bodyHTML: string | null; createdAt: string | null }
type GqlThreadFields = { id: string; isResolved: boolean; path: string | null; line: number | null; originalLine: number | null; diffSide: string | null }
export type GqlThread = GqlThreadFields & { comments: GqlThreadComment[] }
export type GqlContext =
  | {
      __typename: 'CheckRun'
      id: string
      name: string
      status: string | null
      conclusion: string | null
      detailsUrl: string | null
      checkSuite: { workflowRun: { databaseId: number | null } | null } | null
    }
  | { __typename: 'StatusContext'; id: string; context: string; state: string | null; targetUrl: string | null }

export type PullScalars = {
  id: string
  number: number
  title: string
  state: string
  isDraft: boolean
  bodyHTML: string | null
  headRefOid: string | null
  author: GqlActor
  baseRefName: string | null
  headRefName: string | null
  updatedAt: string | null
  mergeable: string | null
  mergeStateStatus: string | null
  autoMergeRequest: { mergeMethod: string } | null
}

// The staged aggregate: every connection walked to its end, in the order GitHub returned it.
export type PullComposite = PullScalars & {
  labels: GqlLabel[]
  reviews: GqlReview[]
  reviewRequests: GqlReviewRequest[]
  comments: GqlComment[]
  commits: GqlCommit[]
  threads: GqlThread[]
  checks: GqlContext[]
}

const PAGE_INFO = 'pageInfo { endCursor hasNextPage }'
const LABEL_NODES = 'name color'
const REVIEW_NODES = 'id author { login } state bodyHTML submittedAt'
const REVIEW_REQUEST_NODES = 'id requestedReviewer { ... on User { login } }'
const COMMENT_NODES = 'id author { login } bodyHTML createdAt'
const COMMIT_NODES = 'commit { oid messageHeadline committedDate author { name user { login } } }'
const THREAD_COMMENT_NODES = 'id databaseId author { login } bodyHTML createdAt'
const CONTEXT_NODES = `__typename
  ... on CheckRun { id name status conclusion detailsUrl checkSuite { workflowRun { databaseId } } }
  ... on StatusContext { id context state targetUrl }`

// One page of a connection. The first page names no cursor; every later page names `$after`.
const page = (field: string, nodes: string, after: boolean) =>
  `${field}(first: ${PAGE_SIZE}${after ? ', after: $after' : ''}) { ${PAGE_INFO} nodes { ${nodes} } }`

const THREAD_NODES = `id isResolved path line originalLine diffSide ${page('comments', THREAD_COMMENT_NODES, false)}`

// The pull request's own connections: which field, which node selection, and which value names a
// node, so a node that appears on two pages is kept once, where it first appeared.
const PULL_CONNECTIONS = {
  labels: { field: 'labels', nodes: LABEL_NODES, identity: (n: GqlLabel) => n.name },
  reviews: { field: 'reviews', nodes: REVIEW_NODES, identity: (n: GqlReview) => n.id },
  reviewRequests: { field: 'reviewRequests', nodes: REVIEW_REQUEST_NODES, identity: (n: GqlReviewRequest) => n.id },
  comments: { field: 'comments', nodes: COMMENT_NODES, identity: (n: GqlComment) => n.id },
  commits: { field: 'commits', nodes: COMMIT_NODES, identity: (n: GqlCommit) => n.commit?.oid },
  reviewThreads: { field: 'reviewThreads', nodes: THREAD_NODES, identity: (n: GqlThreadFields) => n.id },
} as const

const SCALARS = `id number title state isDraft bodyHTML headRefOid author { login } baseRefName headRefName updatedAt
      mergeable mergeStateStatus autoMergeRequest { mergeMethod }`

// The first request: the scalars and the first page of every connection. Its worst case is 100 review
// threads of 100 comments each, about 10,700 nodes against GitHub's 500,000 per call.
export const PULL_FIRST_QUERY = `
query PR($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${SCALARS}
      ${Object.entries(PULL_CONNECTIONS).map(([alias, c]) => `${alias}: ${page(c.field, c.nodes, false)}`).join('\n      ')}
      latestCommit: commits(last: 1) { nodes { commit { statusCheckRollup { id ${page('contexts', CONTEXT_NODES, false)} } } } }
    }
  }
}`

// Every later page, of any connection, addressed through the node that owns it.
const continuationQuery = (ownerType: string, field: string, nodes: string) =>
  `query Page($id: ID!, $after: String!) { node(id: $id) { ... on ${ownerType} { page: ${page(field, nodes, true)} } } }`

type Token = string

const failure = (error: string, detail: string): { ok: false; failure: RouteFailure } =>
  ({ ok: false, failure: { error, status: 502, detail: [detail] } })

async function graphql<T>(token: Token, query: string, variables: Record<string, unknown>): Promise<RouteResult<T>> {
  const result = await ghGraphQLResult<T>(await ghGraphQL(token, query, variables))
  if (result.ok) return { ok: true, value: result.data }
  // Partial data with errors is not a completed page. The messages go through the scrubbed logger.
  if (result.kind === 'graphql') {
    log.error(`pull detail GraphQL errors: ${result.messages.join('; ')}`)
    return { ok: false, failure: { error: 'graphql', status: 502, detail: result.messages } }
  }
  return { ok: false, failure: result.failure }
}

const nextPage = (token: Token, ownerType: string, field: string, nodes: string, id: string) =>
  async (after: string): Promise<RouteResult<unknown>> => {
    const result = await graphql<{ node?: { page?: unknown } | null }>(token, continuationQuery(ownerType, field, nodes), { id, after })
    return result.ok ? { ok: true, value: result.value?.node?.page } : result
  }

const isConnection = (value: unknown): value is Connection<unknown> => {
  if (!value || typeof value !== 'object') return false
  const { nodes, pageInfo } = value as Partial<Connection<unknown>>
  return Array.isArray(nodes)
    && !!pageInfo
    && typeof pageInfo.hasNextPage === 'boolean'
    && (pageInfo.endCursor === null || typeof pageInfo.endCursor === 'string')
}

/**
 * Walk one connection from its first page to its last. Returns every node once, in the order GitHub
 * first returned it, or fails: a page of the wrong shape, a node with no identity, a repeated or
 * missing cursor while GitHub still says there is more, or a failed request. Nothing is dropped
 * quietly, because a dropped node would make a short list look complete.
 */
export async function walkConnection<T>(
  label: string,
  first: unknown,
  next: (after: string) => Promise<RouteResult<unknown>>,
  identity: (node: T) => unknown,
): Promise<RouteResult<T[]>> {
  const byId = new Map<string, T>()
  const cursors = new Set<string>()
  let current = first
  for (;;) {
    if (!isConnection(current)) return failure('github_malformed', label)
    for (const node of current.nodes) {
      const id = node && typeof node === 'object' ? identity(node as T) : undefined
      if (typeof id !== 'string' || !id) return failure('github_malformed', label)
      if (!byId.has(id)) byId.set(id, node as T)
    }
    const { hasNextPage, endCursor } = current.pageInfo
    if (!hasNextPage) return { ok: true, value: [...byId.values()] }
    if (!endCursor || cursors.has(endCursor)) return failure('github_pagination', label)
    cursors.add(endCursor)
    const result = await next(endCursor)
    if (!result.ok) return result
    current = result.value
  }
}

type FirstPull = PullScalars & Record<keyof typeof PULL_CONNECTIONS, unknown> & {
  latestCommit?: { nodes?: { commit?: { statusCheckRollup?: { id: string; contexts: unknown } | null } }[] }
}

/** Fetch one pull request's detail with every connection exhausted. Nothing is written. */
export async function fetchPullComposite(token: Token, owner: string, repo: string, number: number): Promise<RouteResult<PullComposite>> {
  const first = await graphql<{ repository?: { pullRequest?: FirstPull | null } | null }>(token, PULL_FIRST_QUERY, { owner, repo, number })
  if (!first.ok) return first
  const pull = first.value?.repository?.pullRequest
  if (!pull) return { ok: false, failure: { error: 'pull_not_found', status: 404 } }

  const walk = <K extends keyof typeof PULL_CONNECTIONS>(key: K) => {
    const c = PULL_CONNECTIONS[key]
    return walkConnection(key, pull[key], nextPage(token, 'PullRequest', c.field, c.nodes, pull.id), c.identity as (node: never) => unknown)
  }
  const rollup = pull.latestCommit?.nodes?.[0]?.commit?.statusCheckRollup
  const [labels, reviews, reviewRequests, comments, commits, threadPages, checks] = await Promise.all([
    walk('labels'),
    walk('reviews'),
    walk('reviewRequests'),
    walk('comments'),
    walk('commits'),
    walk('reviewThreads'),
    rollup
      ? walkConnection<GqlContext>('contexts', rollup.contexts, nextPage(token, 'StatusCheckRollup', 'contexts', CONTEXT_NODES, rollup.id), (n) => n.id)
      : Promise.resolve({ ok: true as const, value: [] as GqlContext[] }),
  ])
  if (!labels.ok) return labels
  if (!reviews.ok) return reviews
  if (!reviewRequests.ok) return reviewRequests
  if (!comments.ok) return comments
  if (!commits.ok) return commits
  if (!threadPages.ok) return threadPages
  if (!checks.ok) return checks

  // Each thread's own comments, walked from the first page the thread arrived with.
  const threadComments = await mapLimited(threadPages.value as (GqlThreadFields & { comments: unknown })[], CONTINUATION_CONCURRENCY, (thread) =>
    walkConnection<GqlThreadComment>('threadComments', thread.comments, nextPage(token, 'PullRequestReviewThread', 'comments', THREAD_COMMENT_NODES, thread.id), (n) => n.id))
  const threads: GqlThread[] = []
  for (const [i, result] of threadComments.entries()) {
    if (!result.ok) return result
    threads.push({ ...(threadPages.value[i] as GqlThreadFields), comments: result.value })
  }

  // The connection fields are overwritten with their walked lists; the first-page objects that
  // remain on the spread are not part of PullComposite and nothing reads them.
  return {
    ok: true,
    value: {
      ...pull,
      labels: labels.value as GqlLabel[],
      reviews: reviews.value as GqlReview[],
      reviewRequests: reviewRequests.value as GqlReviewRequest[],
      comments: comments.value as GqlComment[],
      commits: commits.value as GqlCommit[],
      threads,
      checks: checks.value,
    },
  }
}

// ─── REST files ──────────────────────────────────────────────────────────────

export type GitHubFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  sha: string | null
  patch?: string // omitted for binary / too-large / pure-rename files
}

// GitHub's documented limits for "List pull request files": 100 per page, 3,000 in all.
export const FILES_PAGE_SIZE = 100
export const FILES_UPSTREAM_LIMIT = 3000
const FILES_MAX_PAGES = FILES_UPSTREAM_LIMIT / FILES_PAGE_SIZE

export type FilesFetch = { files: GitHubFile[]; completeness: PullTopologyCompleteness }

const isGitHubFile = (value: unknown): value is GitHubFile => {
  if (!value || typeof value !== 'object') return false
  const f = value as Partial<GitHubFile>
  return typeof f.filename === 'string' && !!f.filename
    && typeof f.status === 'string'
    && typeof f.additions === 'number'
    && typeof f.deletions === 'number'
    && (f.sha === null || typeof f.sha === 'string')
    && (f.patch === undefined || typeof f.patch === 'string')
}

const hasNextLink = (link: string | null) => !!link && /rel="next"/.test(link)

/**
 * Fetch every file GitHub will list for a pull request, in its order. Pages are read one after
 * another until a short page, a full page with no `next` link, or the 30th page. Past the 30th page
 * GitHub lists nothing, so there the pull's own `changed_files` decides whether the list is complete.
 * A duplicate path or a malformed page fails the whole fetch. Nothing is written.
 */
export async function fetchFiles(token: Token, owner: string, repo: string, number: number): Promise<RouteResult<FilesFetch>> {
  const files: GitHubFile[] = []
  const seen = new Set<string>()
  for (let pageNo = 1; pageNo <= FILES_MAX_PAGES; pageNo++) {
    const res = await gh(token, `/repos/${owner}/${repo}/pulls/${number}/files?per_page=${FILES_PAGE_SIZE}&page=${pageNo}`)
    const err = ghError(res)
    if (err) return { ok: false, failure: err }
    const body: unknown = await res.json().catch(() => null)
    if (!Array.isArray(body) || body.length > FILES_PAGE_SIZE || !body.every(isGitHubFile)) return failure('github_malformed', 'files')
    for (const file of body) {
      if (seen.has(file.filename)) return failure('github_malformed', 'duplicate file')
      seen.add(file.filename)
      files.push(file)
    }
    if (body.length < FILES_PAGE_SIZE) return { ok: true, value: { files, completeness: COMPLETE } }
    if (pageNo === FILES_MAX_PAGES) break
    if (!hasNextLink(res.headers.get('link'))) return { ok: true, value: { files, completeness: COMPLETE } }
  }

  // Thirty full pages. A full last page does not prove there is nothing after it.
  const res = await gh(token, `/repos/${owner}/${repo}/pulls/${number}`)
  const err = ghError(res)
  if (err) return { ok: false, failure: err }
  const pull = (await res.json().catch(() => null)) as { changed_files?: unknown } | null
  const reportedTotal = typeof pull?.changed_files === 'number' ? pull.changed_files : null
  if (reportedTotal !== null && reportedTotal <= files.length) return { ok: true, value: { files, completeness: COMPLETE } }
  return {
    ok: true,
    value: {
      files,
      completeness: { kind: 'incomplete', cause: 'upstream-cap', resource: 'files', received: files.length, reportedTotal, limit: FILES_UPSTREAM_LIMIT },
    },
  }
}

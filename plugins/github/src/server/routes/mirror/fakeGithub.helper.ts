import type { GitHubFile, GqlComment, GqlCommit, GqlContext, GqlLabel, GqlReview, GqlReviewRequest, GqlThread, PullScalars } from './prFetch'

// A deterministic GitHub for one pull request, answering the requests prFetch.ts makes: the GraphQL
// first page, every cursor continuation, the REST files pages with their `Link` header, and the pull
// itself. It paginates the way GitHub documents: 100 nodes a page, files capped at 3,000. Tests
// stub `fetch` with `fake.fetch` and read back what was asked for.

export type FakePull = PullScalars & {
  labels: GqlLabel[]
  reviews: GqlReview[]
  reviewRequests: GqlReviewRequest[]
  comments: GqlComment[]
  commits: GqlCommit[]
  threads: GqlThread[]
  checks: GqlContext[]
  rollupId: string
  files: GitHubFile[]
  // What `GET /pulls/:number` reports as changed_files. Null leaves the field out.
  changedFiles: number | null
}

export type FakeRequest =
  | { kind: 'graphql-first' }
  | { kind: 'graphql-page'; ownerType: string; field: string; id: string; after: string }
  | { kind: 'files'; page: number }
  | { kind: 'pull' }

const PAGE = 100
const FILES_CAP = 3000

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

export function makeFakePull(counts: {
  labels?: number
  reviews?: number
  comments?: number
  commits?: number
  threads?: number
  commentsPerThread?: (thread: number) => number
  checks?: number
  files?: number
  changedFiles?: number | null
  patch?: (file: number) => string | undefined
} = {}): FakePull {
  const files = counts.files ?? 0
  return {
    id: 'PR_node',
    number: 7,
    title: 'Large pull',
    state: 'OPEN',
    isDraft: false,
    bodyHTML: '<p>body</p>',
    headRefOid: 'head-sha',
    author: { login: 'ada' },
    baseRefName: 'main',
    headRefName: 'feature',
    updatedAt: '2026-09-26T00:00:00Z',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    autoMergeRequest: null,
    labels: range(counts.labels ?? 0).map((i) => ({ name: `label-${i}`, color: 'ffffff' })),
    reviews: range(counts.reviews ?? 0).map((i) => ({ id: `review-${i}`, author: { login: 'rev' }, state: 'COMMENTED', bodyHTML: `r${i}`, submittedAt: '2026-09-26T00:00:00Z' })),
    reviewRequests: [],
    comments: range(counts.comments ?? 0).map((i) => ({ id: `comment-${i}`, author: { login: 'ada' }, bodyHTML: `c${i}`, createdAt: '2026-09-26T00:00:00Z' })),
    commits: range(counts.commits ?? 0).map((i) => ({ commit: { oid: `commit-${i}`, messageHeadline: `m${i}`, committedDate: '2026-09-26T00:00:00Z', author: { name: 'Ada', user: { login: 'ada' } } } })),
    threads: range(counts.threads ?? 0).map((t) => ({
      id: `thread-${t}`,
      isResolved: false,
      path: `src/file-${t % Math.max(files, 1)}.ts`,
      line: 1,
      originalLine: 1,
      diffSide: 'RIGHT',
      comments: range(counts.commentsPerThread?.(t) ?? 1).map((c) => ({ id: `thread-${t}-comment-${c}`, databaseId: t * 1000 + c, author: { login: 'rev' }, bodyHTML: `t${t}c${c}`, createdAt: '2026-09-26T00:00:00Z' })),
    })),
    checks: range(counts.checks ?? 0).map((i) => ({ __typename: 'CheckRun', id: `check-${i}`, name: `check-${i}`, status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: null, checkSuite: null })),
    rollupId: 'rollup-node',
    files: range(files).map((i) => ({
      filename: `src/file-${i}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 1,
      sha: `blob-${i}`,
      ...(counts.patch ? (counts.patch(i) === undefined ? {} : { patch: counts.patch(i) }) : { patch: `@@ -1 +1 @@\n-old ${i}\n+new ${i}` }),
    })),
    changedFiles: counts.changedFiles === undefined ? files : counts.changedFiles,
  }
}

const connection = <T,>(items: T[], after: string | null) => {
  const start = after ? Number(after) : 0
  const nodes = items.slice(start, start + PAGE)
  const end = start + nodes.length
  return { pageInfo: { endCursor: nodes.length ? String(end) : null, hasNextPage: end < items.length }, nodes }
}

const threadNode = (thread: GqlThread) => {
  const { comments, ...fields } = thread
  return { ...fields, comments: connection(comments, null) }
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } })

export function fakeGithub(
  pull: FakePull,
  options: {
    // Answer a request differently: return a Response to send it instead of the fake's own.
    override?: (request: FakeRequest) => Response | undefined
  } = {},
) {
  const requests: FakeRequest[] = []
  let inFlight = 0
  let maxInFlight = 0

  const answer = (request: FakeRequest): Response => {
    const overridden = options.override?.(request)
    if (overridden) return overridden
    if (request.kind === 'graphql-first') {
      return json({
        data: {
          repository: {
            pullRequest: {
              ...Object.fromEntries(Object.entries(pull).filter(([key]) => !['labels', 'reviews', 'reviewRequests', 'comments', 'commits', 'threads', 'checks', 'rollupId', 'files', 'changedFiles'].includes(key))),
              labels: connection(pull.labels, null),
              reviews: connection(pull.reviews, null),
              reviewRequests: connection(pull.reviewRequests, null),
              comments: connection(pull.comments, null),
              commits: connection(pull.commits, null),
              reviewThreads: { ...connection(pull.threads, null), nodes: connection(pull.threads, null).nodes.map(threadNode) },
              latestCommit: { nodes: [{ commit: { statusCheckRollup: { id: pull.rollupId, contexts: connection(pull.checks, null) } } }] },
            },
          },
        },
      })
    }
    if (request.kind === 'graphql-page') {
      const { ownerType, field, id, after } = request
      let page: unknown
      if (ownerType === 'PullRequest' && field === 'reviewThreads') {
        const c = connection(pull.threads, after)
        page = { ...c, nodes: c.nodes.map(threadNode) }
      } else if (ownerType === 'PullRequest') {
        const lists: Record<string, unknown[]> = { labels: pull.labels, reviews: pull.reviews, reviewRequests: pull.reviewRequests, comments: pull.comments, commits: pull.commits }
        page = connection(lists[field]!, after)
      } else if (ownerType === 'PullRequestReviewThread') {
        page = connection(pull.threads.find((t) => t.id === id)!.comments, after)
      } else if (ownerType === 'StatusCheckRollup') {
        page = connection(pull.checks, after)
      }
      return json({ data: { node: { page } } })
    }
    if (request.kind === 'files') {
      const served = pull.files.slice(0, FILES_CAP)
      const start = (request.page - 1) * PAGE
      const body = served.slice(start, start + PAGE)
      const more = start + PAGE < served.length
      return json(body, more ? { link: `<https://api.github.com/x?page=${request.page + 1}>; rel="next"` } : {})
    }
    return json(pull.changedFiles === null ? {} : { changed_files: pull.changedFiles })
  }

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    let request: FakeRequest
    if (url.pathname === '/graphql') {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> }
      const continuation = /on (\w+) \{ page: (\w+)\(/.exec(body.query)
      request = continuation
        ? { kind: 'graphql-page', ownerType: continuation[1]!, field: continuation[2]!, id: body.variables.id!, after: body.variables.after! }
        : { kind: 'graphql-first' }
    } else if (url.pathname.endsWith('/files')) {
      request = { kind: 'files', page: Number(url.searchParams.get('page') ?? '1') }
    } else {
      request = { kind: 'pull' }
    }
    requests.push(request)
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      // One macrotask, so requests that were started together are genuinely in flight together.
      await new Promise((resolve) => setTimeout(resolve, 0))
      return answer(request)
    } finally {
      inFlight--
    }
  }

  return { fetch, requests, maxInFlight: () => maxInFlight }
}

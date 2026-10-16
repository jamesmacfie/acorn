import type { PluginTelemetry } from '@acorn/plugin-api/node'

// Every call out to a provider needs a deadline shorter than the client's. The client's fan-out gives a
// node 5s and then draws "unavailable" over the whole node, so a fetch that outlasts it reads to the
// user as "your machine is down" rather than "this API is slow", and the "this provider is
// unavailable" answer below never reaches anyone. Four seconds matches core's own provider routes
// (`LIST_TIMEOUT_MS` in node-core). The deadline is per request, not per route: a route that loops over
// several connections can still add up past the client's 5s.
const REQUEST_TIMEOUT_MS = 4_000

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'acorn',
})

// No credential means GitHub is not connected (`githubToken` returns '' for that). Answer locally
// with the response GitHub itself would give, rather than spending a round trip to be told: ghError
// maps 401 to `reauth`, which is already the client's "reconnect GitHub" path, so "never connected"
// and "credential revoked" converge on one user-visible outcome and no call site needs a new branch.
const notConnected = (): Response =>
  new Response(JSON.stringify({ message: 'GitHub is not connected' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })

// ─── Telemetry ───────────────────────────────────────────────────────────────
//
// One `github.api` span per call (docs/telemetry/runtimes.md § Node seams). The URL never rides along,
// because it holds repository, branch and label names. The operation comes from the fixed list below.

type ApiTelemetry = Pick<PluginTelemetry, 'enabled' | 'startSpan'>
let telemetry: ApiTelemetry | undefined
/** `ctx.telemetry`, handed over at init, because the modules that call GitHub have no `ctx` in reach. */
export const setGithubApiTelemetry = (next: ApiTelemetry | undefined): void => {
  telemetry = next
}

const REPO = String.raw`^/repos/[^/]+/[^/]+`
const REST_OPERATIONS: [RegExp, string][] = [
  [/^\/user$/, 'user'],
  [/^\/user\/repos$/, 'user.repos'],
  [/^\/repositories$/, 'repositories'],
  [/^\/search\/issues$/, 'search.issues'],
  [new RegExp(`${REPO}$`), 'repo'],
  [new RegExp(`${REPO}/pulls$`), 'pulls'],
  [new RegExp(`${REPO}/pulls/\\d+$`), 'pull'],
  [new RegExp(`${REPO}/pulls/\\d+/files$`), 'pull.files'],
  [new RegExp(`${REPO}/pulls/\\d+/merge$`), 'pull.merge'],
  [new RegExp(`${REPO}/pulls/\\d+/reviews$`), 'pull.reviews'],
  [new RegExp(`${REPO}/pulls/\\d+/requested_reviewers$`), 'pull.reviewers'],
  [new RegExp(`${REPO}/pulls/\\d+/comments$`), 'pull.comments'],
  [new RegExp(`${REPO}/pulls/\\d+/comments/\\d+/replies$`), 'pull.comment.replies'],
  [new RegExp(`${REPO}/issues/\\d+/comments$`), 'issue.comments'],
  [new RegExp(`${REPO}/issues/\\d+/labels(/[^/]+)?$`), 'issue.labels'],
  [new RegExp(`${REPO}/labels$`), 'labels'],
  [new RegExp(`${REPO}/compare/.+$`), 'compare'],
  [new RegExp(`${REPO}/git/blobs/[^/]+$`), 'git.blob'],
  [new RegExp(`${REPO}/actions/runs$`), 'actions.runs'],
  [new RegExp(`${REPO}/actions/runs/\\d+/(attempts/\\d+/)?jobs$`), 'actions.jobs'],
  [new RegExp(`${REPO}/actions/runs/\\d+/rerun-failed-jobs$`), 'actions.rerun'],
  [new RegExp(`${REPO}/actions/jobs/\\d+$`), 'actions.job'],
  [new RegExp(`${REPO}/actions/jobs/\\d+/rerun$`), 'actions.rerun'],
  [new RegExp(`${REPO}/actions/jobs/\\d+/logs$`), 'actions.job.logs'],
]

/** The operation a REST path names, or `other`. Never any part of the path itself. */
export const restOperation = (path: string): string => {
  const bare = path.split('?')[0]!
  return REST_OPERATIONS.find(([pattern]) => pattern.test(bare))?.[1] ?? 'other'
}

/** The first field a GraphQL document asks for, such as `repository` or `mergePullRequest`. A
 *  schema name, never a value: variables carry those. */
export const graphQLOperation = (query: string): string => {
  const field = /\{\s*(?:\w+\s*:\s*)?(\w{1,64})/.exec(query)?.[1]
  return field ? `graphql.${field}` : 'graphql'
}

function timed(operation: string, method: string, call: () => Promise<Response>): Promise<Response> {
  if (!telemetry?.enabled()) return call()
  const span = telemetry.startSpan('github.api', { attrs: { operation, method } })
  return call().then(
    (res) => {
      const limit = Number(res.headers.get('x-ratelimit-limit'))
      const remaining = Number(res.headers.get('x-ratelimit-remaining'))
      const low = limit > 0 && res.headers.has('x-ratelimit-remaining') && remaining < limit * 0.1
      span.end(res.status >= 500 ? 'error' : 'ok', { status: res.status, ...(low ? { 'ratelimit.low': true } : {}) })
      return res
    },
    (error: unknown) => {
      span.end('error', { status: 0 })
      throw error
    },
  )
}

// REST.
export const gh = (token: string, path: string, init?: RequestInit) =>
  token
    ? timed(restOperation(path), init?.method ?? 'GET', () =>
        fetch(`https://api.github.com${path}`, {
          ...init,
          headers: { ...ghHeaders(token), ...init?.headers },
          // A caller that brought its own signal keeps it, deadline included.
          signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      )
    : Promise.resolve(notConnected())

// GraphQL, POST to /graphql. No ETag support (docs/caching.md); callers self-cache by TTL.
export const ghGraphQL = (token: string, query: string, variables: Record<string, unknown>, signal?: AbortSignal) =>
  token
    ? timed(graphQLOperation(query), 'POST', () =>
        fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables }),
          // As with REST, a caller's own signal wins. A data source read brings its run's budget,
          // and one search page can take longer than four seconds.
          signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      )
    : Promise.resolve(notConnected())

// Normalize a non-OK GitHub REST/GraphQL Response to a client error code + HTTP status, or null
// when the response is OK (2xx). Callers handle endpoint-specific statuses (e.g. merge 405/409,
// GraphQL `errors`) themselves, then delegate everything else here so the taxonomy stays uniform
// (docs/github-integration.md). GitHub signals rate limits as 403 *or* 429 with x-ratelimit-remaining: 0
// (primary) or retry-after (secondary), and SAML enforcement as 403 with x-github-sso.
export const ghError = (res: Response): { error: string; status: 401 | 403 | 429 | 502 } | null => {
  if (res.ok) return null
  if (res.status === 401) return { error: 'reauth', status: 401 }
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after'))
      return { error: 'rate_limited', status: 429 }
    if (res.headers.has('x-github-sso')) return { error: 'sso', status: 403 }
    return { error: 'forbidden', status: 403 }
  }
  return { error: 'github_unavailable', status: 502 }
}

// Parse a GraphQL Response once: HTTP-level failures map through ghError; a 200 with an `errors`
// array is surfaced as kind 'graphql' with its messages so each caller can apply its own
// endpoint-specific mapping (e.g. prActions' 422 auto_merge_not_allowed) without re-parsing.
export type GhGraphQLResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'http'; failure: { error: string; status: 401 | 403 | 429 | 502 } }
  | { ok: false; kind: 'graphql'; messages: string[] }

export const ghGraphQLResult = async <T>(res: Response): Promise<GhGraphQLResult<T>> => {
  const err = ghError(res)
  if (err) return { ok: false, kind: 'http', failure: err }
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message?: string }[] }
  if (body.errors?.length)
    return { ok: false, kind: 'graphql', messages: body.errors.map((e) => e.message ?? 'unknown graphql error') }
  return { ok: true, data: body.data as T }
}

// Thin GitHub client (docs/github-integration.md). Injects the standard headers and
// returns the raw Response so callers handle status/parsing. Stays here in apps/desktop/src/server/
// until a third consumer justifies promoting it to packages/.
// ponytail: no client-side ETag parsing yet (callers pass If-None-Match themselves); ghError
// below normalizes auth / rate-limit / SSO statuses for every route.
const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'acorn',
})

// REST.
export const gh = (token: string, path: string, init?: RequestInit) =>
  fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...ghHeaders(token), ...init?.headers },
  })

// GraphQL — POST to /graphql. No ETag support (docs/caching.md); callers self-cache by TTL.
export const ghGraphQL = (token: string, query: string, variables: Record<string, unknown>) =>
  fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

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
  if (body.errors?.length) return { ok: false, kind: 'graphql', messages: body.errors.map((e) => e.message ?? 'unknown graphql error') }
  return { ok: true, data: body.data as T }
}

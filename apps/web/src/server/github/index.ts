// Thin GitHub client (docs/api-structure.md "start lean"). Injects the standard headers and
// returns the raw Response so callers handle status/parsing. Stays here in apps/web/src/server/
// until a third consumer justifies promoting it to packages/.
// ponytail: no ETag / rate-limit parsing yet — add when conditional fetch lands.
const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'aacorn',
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

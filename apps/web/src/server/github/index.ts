// Thin GitHub REST wrapper (docs/api-structure.md "start lean"). Injects the standard
// headers and returns the raw Response so callers handle status/parsing. Stays here in
// apps/web/src/server/ until a third consumer justifies promoting it to packages/.
// ponytail: no ETag / rate-limit parsing yet — add when conditional fetch lands.
export const gh = (token: string, path: string, init?: RequestInit) =>
  fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gurthurd',
      ...init?.headers,
    },
  })

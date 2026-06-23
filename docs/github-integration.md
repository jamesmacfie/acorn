# GitHub Integration

All GitHub access goes through two thin clients in
`apps/web/src/server/github/index.ts`. The route handlers
(`apps/web/src/server/routes/`) call these, mirror the result into D1, and
return a public projection. The browser never talks to GitHub directly and
never holds the token (see [authentication](./authentication.md)).

## The clients

Both inject the standard headers and return the **raw `Response`** so callers
own status handling and parsing.

```ts
const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'aacorn',
})

// REST
export const gh = (token, path, init?) =>
  fetch(`https://api.github.com${path}`, { ...init, headers: { ...ghHeaders(token), ...init?.headers } })

// GraphQL — POST to /graphql
export const ghGraphQL = (token, query, variables) =>
  fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
```

These deliberately stay in `apps/web/src/server/` rather than being promoted to
a shared package until a third consumer justifies it.

## REST vs GraphQL — the decision

- **REST** for list reads and most writes — it's simple, and crucially it
  carries **ETags**, which enable free conditional revalidation (`304`). See
  [caching](./caching.md#etag-conditional-revalidation).
- **GraphQL** for the **composite PR-detail read** (PR + reviews + comments +
  review threads + checks in one round-trip) and for two mutations that have no
  clean REST equivalent (draft toggle, thread resolve/unresolve). GraphQL has
  **no ETag**, so anything fetched this way self-caches by TTL only.

## Operation → endpoint map

### Reads

| aacorn operation | API | GitHub endpoint |
| --- | --- | --- |
| Repos list | REST | `GET /user/repos?sort=pushed&direction=desc&per_page=100` |
| PR list | REST | `GET /repos/{owner}/{repo}/pulls?state={state}&sort=updated&direction=desc&per_page=100` (conditional `If-None-Match`) |
| PR files + patches | REST | `GET /repos/{owner}/{repo}/pulls/{n}/files?per_page=100` |
| PR detail (composite) | GraphQL | `repository.pullRequest { … reviews comments reviewThreads commits.statusCheckRollup }` |

The composite GraphQL query pulls `id number title state isDraft bodyHTML
headRefOid author baseRefName headRefName updatedAt`, plus `labels` (first 20),
`reviews` / `comments` / `reviewThreads` (first 50), and the latest commit's
`statusCheckRollup` contexts (`CheckRun` and `StatusContext`). Files are *not*
in the composite — the richer REST `/files` endpoint owns `pr_files`.

> `ponytail:` first-page only — cursor pagination for reviews/comments/threads,
> and Link-header pagination for repos/PRs/files, are deferred.

### Write actions

| aacorn operation | API | GitHub endpoint |
| --- | --- | --- |
| Merge | REST | `PUT /repos/{owner}/{repo}/pulls/{n}/merge` (`merge_method`) |
| Close / reopen | REST | `PATCH /repos/{owner}/{repo}/pulls/{n}` (`{ state }`) |
| Draft ↔ ready | GraphQL | `convertPullRequestToDraft` / `markPullRequestReadyForReview` (needs PR node id) |
| Add discussion comment | REST | `POST /repos/{owner}/{repo}/issues/{n}/comments` (`Accept: …full+json` → `body_html`) |
| Add label / remove label | REST | `POST` / `DELETE /repos/{owner}/{repo}/issues/{n}/labels[/{name}]` |
| Start inline review comment | REST | `POST /repos/{owner}/{repo}/pulls/{n}/comments` (`commit_id` = head sha, `path`, `line`, `side`) |
| Reply to thread | REST | `POST /repos/{owner}/{repo}/pulls/{n}/comments/{commentId}/replies` (numeric `databaseId`) |
| Resolve / unresolve thread | GraphQL | `resolveReviewThread` / `unresolveReviewThread` (by thread node id) |
| Rerun failed jobs | REST | `POST /repos/{owner}/{repo}/actions/runs/{runId}/rerun-failed-jobs` |
| Toggle "viewed" file | — | No GitHub call — app-state only (see [data-layer](./data-layer.md)) |

### Write actions and the mirror {#write-actions}

Each write calls GitHub, then keeps the D1 mirror consistent so a read inside
the TTL window reflects the change:

- **Merge / close / reopen** update `pull_requests.state` directly.
- **Draft toggle** updates `pull_requests.draft`. Requires the mirrored
  `nodeId` — if absent, returns `409 node_id_unknown` (open the PR first to
  mirror it).
- **Add comment / labels** write the returned canonical data into `comments` /
  `pr_labels`.
- **Inline review comment / reply / resolve** can't be mirrored surgically, so
  they **bust the PR's `sync_state` freshness** (`bustPrSync`) — the next detail
  GET refetches the composite from GitHub.
- **Rerun failed jobs** has no mirror to update; the new run states surface on
  the next composite refetch.

The client layers optimistic updates / invalidation on top. See
[api-reference](./api-reference.md) for request/response shapes and
[frontend](./frontend.md) for the mutation wiring.

## ETags and rate limits

- **ETags** are aacorn's main rate-limit defense. The PR-list route sends
  `If-None-Match` with the stored `sync_state.etag`; a `304` costs nothing
  against the limit and re-serves the mirror. The repos route captures the ETag
  per row. GraphQL reads (PR detail) have no ETag and rely on the TTL gate.
- A shared `ghError(res)` helper in `server/github/index.ts` maps any non-OK GitHub
  REST/GraphQL response to a normalized `{ error, status }`, applied uniformly across
  every route:
  - **`401`** (revoked/expired token) → `{ error: 'reauth' }`, so the client bounces
    to re-login (see [authentication](./authentication.md#the-401--reauth-bounce)).
  - **rate limit** (`403`/`429` with `x-ratelimit-remaining: 0`, or any `retry-after`)
    → `429 { error: 'rate_limited' }`.
  - **SAML SSO** (`403` with `x-github-sso`) → `403 { error: 'sso' }`.
  - other **`403`** (insufficient scope/permission) → `403 { error: 'forbidden' }`.
  - anything else → `502 { error: 'github_unavailable' }`.
- Routes handle their endpoint-specific statuses first — merge `405`/`409`
  (`merge_failed`), GraphQL `errors` in the response body — then delegate the
  remainder to `ghError()`.

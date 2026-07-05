# GitHub Integration

All GitHub access goes through two thin clients in
`apps/desktop/src/server/github/index.ts`. The route handlers
(`apps/desktop/src/server/routes/`) call these, mirror the result into the local
SQLite read-model, and return a public projection. The browser never talks to GitHub directly and
never holds the token (see [authentication](./authentication.md)).

## The clients

Both inject the standard headers and return the **raw `Response`** so callers
own status handling and parsing.

```ts
const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'acorn',
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

These deliberately stay in `apps/desktop/src/server/` rather than being promoted to
a shared package until a third consumer justifies it.

Two calls deliberately bypass the clients: the OAuth code→token exchange
(`routes/auth.ts` — it targets `github.com/login/oauth`, not the API host) and
the signed log-blob fetch in `routes/actions.ts` (the redirect target must be
fetched **without** the auth header).

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

| acorn operation | API | GitHub endpoint |
| --- | --- | --- |
| Repos list | REST | `GET /user/repos?sort=pushed&direction=desc&per_page=100` |
| Single repo (mirror-miss resolve) | REST | `GET /repos/{owner}/{repo}` (`resolveRepoForUser`) |
| Repo labels | REST | `GET /repos/{owner}/{repo}/labels?per_page=100` |
| Open PR list | REST | `GET /repos/{owner}/{repo}/pulls?state=open&sort=updated&direction=desc&per_page=100` (conditional `If-None-Match`) |
| Closed PR list (paged proxy) | REST | `GET /repos/{owner}/{repo}/pulls?state=closed&…&per_page=50&page={p}` (no mirror; Link header drives load-more) |
| PR files + patches | REST | `GET /repos/{owner}/{repo}/pulls/{n}/files?per_page=100` |
| PR detail (composite) | GraphQL | `repository.pullRequest { …PrFields }` — single and multi-alias batch forms share `PR_FRAGMENT` (`prMirror.ts`) |
| File blob (context expansion) | REST | `GET /repos/{owner}/{repo}/git/blobs/{sha}` (cached forever on disk by sha) |
| Branch list (create PR) | GraphQL | `repository.refs(refPrefix:"refs/heads/", …)` — paged up to 30×100, sorted by tip `committedDate` locally |
| Compare (create PR preview) | REST | `GET /repos/{owner}/{repo}/compare/{base}...{head}?per_page=100` |
| Workflow run jobs | REST | `GET /repos/{owner}/{repo}/actions/runs/{runId}/jobs?per_page=100` |
| Job logs | REST | `GET /repos/{owner}/{repo}/actions/jobs/{jobId}/logs` (302 followed manually, unauthenticated) |

The composite GraphQL query (`PR_FRAGMENT`) pulls `id number title state isDraft
bodyHTML headRefOid author baseRefName headRefName updatedAt mergeable
mergeStateStatus autoMergeRequest.mergeMethod`, plus `labels` (first 20),
`reviews` / `reviewRequests` / `comments` / `reviewThreads` (first 50), timeline
commits (first 100), and the latest commit's `statusCheckRollup` contexts
(`CheckRun` and `StatusContext`). Files are *not* in the composite — the richer
REST `/files` endpoint owns `pr_files`.

> `ponytail:` first-page only — cursor pagination for reviews/comments/threads,
> and Link-header pagination for repos/PRs/files, are deferred.

### Write actions

| acorn operation | API | GitHub endpoint |
| --- | --- | --- |
| Merge | REST | `PUT /repos/{owner}/{repo}/pulls/{n}/merge` (`merge_method`) |
| Enable / disable auto-merge | GraphQL | `enablePullRequestAutoMerge` / `disablePullRequestAutoMerge` (needs PR node id; no REST equivalent) |
| Close / reopen | REST | `PATCH /repos/{owner}/{repo}/pulls/{n}` (`{ state }`) |
| Draft ↔ ready | GraphQL | `convertPullRequestToDraft` / `markPullRequestReadyForReview` (needs PR node id) |
| Add discussion comment | REST | `POST /repos/{owner}/{repo}/issues/{n}/comments` (`Accept: …full+json` → `body_html`) |
| Add label / remove label | REST | `POST` / `DELETE /repos/{owner}/{repo}/issues/{n}/labels[/{name}]` |
| Submit review | REST | `POST /repos/{owner}/{repo}/pulls/{n}/reviews` (`{ event, body }`) |
| Request / remove reviewer | REST | `POST` / `DELETE /repos/{owner}/{repo}/pulls/{n}/requested_reviewers` (`{ reviewers: [login] }`) |
| Start inline review comment | REST | `POST /repos/{owner}/{repo}/pulls/{n}/comments` (`commit_id` = head sha, `path`, `line`, `side`) |
| Reply to thread | REST | `POST /repos/{owner}/{repo}/pulls/{n}/comments/{commentId}/replies` (numeric `databaseId`) |
| Resolve / unresolve thread | GraphQL | `resolveReviewThread` / `unresolveReviewThread` (by thread node id) |
| Create PR | REST | `POST /repos/{owner}/{repo}/pulls` (`{ title, body, base, head, draft }`; `422` message surfaced verbatim) |
| Rerun failed jobs | REST | `POST /repos/{owner}/{repo}/actions/runs/{runId}/rerun-failed-jobs` |
| Toggle "viewed" file | — | No GitHub call — app-state only (see [data-layer](./data-layer.md)) |

### Write actions and the mirror {#write-actions}

Each write calls GitHub, then keeps the local mirror consistent so a read inside
the TTL window reflects the change:

- **Merge / close / reopen** update `pull_requests.state` directly.
- **Draft toggle** updates `pull_requests.draft`; **auto-merge enable/disable**
  update `pull_requests.auto_merge_enabled`. Both are GraphQL and require the
  mirrored `nodeId` — if absent, they return `409 node_id_unknown` (open the PR
  first to mirror it).
- **Add comment / labels / requested reviewers** write the returned canonical
  data into `comments` / `pr_labels` / `review_requests` (labels and reviewers
  replace the full set GitHub echoes back).
- **Inline review comment / reply / resolve / submit review** can't be mirrored
  surgically, so they **bust the PR's `sync_state` freshness** (`bustPrSync`) —
  the next detail GET refetches the composite from GitHub.
- **Create PR** busts the repo's open-pulls `sync_state` so the list refetches
  with the new PR; the detail mirror fills on first navigation.
- **Rerun failed jobs** has no mirror to update; the new run states surface on
  the next composite refetch.

The client layers optimistic updates / invalidation on top. See
[api-reference](./api-reference.md) for request/response shapes and
[frontend](./frontend.md) for the mutation wiring.

## ETags and rate limits

- **ETags** are acorn's main rate-limit defense. The PR-list route sends
  `If-None-Match` with the stored `sync_state.etag`; a `304` costs nothing
  against the limit and re-serves the mirror. The repos route and GraphQL reads
  (PR detail) have no ETag and rely on the TTL gate.
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
- Routes handle their endpoint-specific statuses first — e.g. merge `405`/`409`
  (`merge_failed`) — then delegate the remainder to `ghError()`.
- GraphQL responses go through `ghGraphQLResult(res)` (same module): it runs
  `ghError` for HTTP-level failures and normalizes a `200 + errors` body into a
  `kind: 'graphql'` result with the messages, so callers apply only their
  endpoint-specific mapping (prActions maps auto-merge-enable errors to
  `422 auto_merge_not_allowed`; most others map to `502`; pullDetail surfaces
  the messages as `502 { error: 'graphql', detail }`).
- REST helpers that feed the mirror return the same normalized
  `RouteResult<T>` shape (`{ ok: true, value } | { ok: false, failure }`) —
  `refreshRepos`, `resolveRepoForUser`, and `fetchFiles` in
  `routes/prMirror.ts` — so route handlers never re-derive failures.
- `resolveRepoForUser` (`routes/repoMirror.ts`) additionally folds a GitHub
  `404` *or plain `403`* on the single-repo resolve into `404 repo_not_found` —
  a deliberate, kept decision (documented at the fold): GitHub itself 404s
  repos you can't see, so the UI gets one "can't get there" state and acorn
  doesn't confirm that a private repo exists.


# API Reference

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)). The HTTP surface below is unchanged — it is now served by an
> in-process Node server (`@hono/node-server`) on `http://127.0.0.1:4317`. Read "the Worker" as
> "the local server".

The server's complete HTTP surface. One Hono app
(`apps/web/src/server/index.ts`) serves `/auth/*` and `/api/*`; see
[architecture-overview](./architecture-overview.md).

All `/api/*` routes run through two middlewares first:

1. `csrf()` — Origin / `Sec-Fetch-Site` check on mutating calls.
2. `authMiddleware` — decrypts the session cookie into `ctx.user` (or `null`).

A route that needs a session returns `401 { error: 'unauthenticated' }` when
`ctx.user` is `null`. See [authentication](./authentication.md).

## Conventions

- All responses are JSON unless noted. Timestamps are epoch **milliseconds**.
- Reads return public projections (no `userId`, no staleness columns, no token).
- Mutating requests take a JSON body.

## Shared client contract

The SPA uses a small shared TypeScript contract rather than a runtime RPC
client. `apps/web/src/shared/api.ts` owns response types, route builders, and
query-key factories; `apps/web/src/client/queries.ts` and `mutations.ts` consume
those helpers with plain same-origin `fetch`.

That keeps the client bundle thin and preserves the exact request shape of the
HTTP API: no generated client, no additional network calls, and no extra
runtime wrapper on the hot read paths. `apps/web/src/shared/api.test.ts`
characterizes the route strings and query-key shapes so cache compatibility
does not drift.

---

## Auth routes (`/auth`)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/auth/login` | Mint OAuth state (in-memory map + cookie), redirect to GitHub authorize |
| `GET` | `/auth/callback` | Validate state, exchange code, seal session, redirect `/` |
| `GET` | `/auth/permissions` | Redirect to the GitHub OAuth app settings page |
| `POST` | `/auth/logout` | Clear session cookies → `204` |

`/auth/callback` errors: `400` (missing `code`/`state`), `403 invalid state`
(cookie mismatch or consumed/expired state). Token-exchange failure
redirects back to `/auth/login`. Full flow in
[authentication](./authentication.md).

---

## `GET /api/me`

Current user, public fields only.

```ts
200 → { login: string, name: string, avatar: string, scopes: string[] }
401 → { error: 'unauthenticated' }   // valid logged-out state; client returns null
```

---

## Repos (`/api/repos`)

### `GET /api/repos`

This user's repos (mirror; serve-then-revalidate, ~5 min TTL). Ordered by
`pushedAt` desc.

```ts
200 → Repo[]
  Repo = { id, owner, name, private, defaultBranch, pushedAt }
401 → { error: 'unauthenticated' } | { error: 'reauth' }   // reauth = GitHub 401
502 → { error: 'github_unavailable' }
```

### `POST /api/repos/refresh`

Force the next `GET /api/repos` to re-sync (sets `fetchedAt = 0`).

```ts
204 (no body)
401 → { error: 'unauthenticated' }
```

---

## Pull lists (`/api/repos/:owner/:repo/pulls`)

### `GET /api/repos/:owner/:repo/pulls?state=open|closed`

PR list for a repo (mirror; serve-then-revalidate, ~45 s TTL, conditional
`If-None-Match`). `state` defaults to `open`; `closed` covers merged. Ordered by
`updatedAt` desc.

```ts
200 → Pull[]
  Pull = { number, title, state, draft, author, headRef, baseRef, updatedAt }
401 → { error: 'unauthenticated' } | { error: 'reauth' }
404 → { error: 'repo_not_found' }       // repo not in this user's mirror
502 → { error: 'github_unavailable' }
```

A GitHub `304` is handled internally (re-serves the mirror); the client always
sees `200`.

---

## Pull detail (`/api/repos/:owner/:repo/pulls/:number`)

### `GET /api/repos/:owner/:repo/pulls/:number`

The composite read (GraphQL; mirror, ~45 s TTL, **TTL-only** — no ETag).

```ts
200 → PullDetail
  PullDetail = {
    pull: (Pull & { body, headSha }) | null,
    labels:   { name, color }[],
    reviews:  { id, author, state, body, submittedAt }[],
    comments: { id, author, body, createdAt }[],
    commits:  { sha, message, author, authorLogin, committedAt }[],
    checks:   { name, status, url, runId }[],
    threads:  { threadId, path, line, side, resolved, comments: ThreadComment[] }[],
  }
  ThreadComment = { id, databaseId, author, body, createdAt }
400 → { error: 'bad_number' }
401 → { error: 'unauthenticated' } | { error: 'reauth' }
404 → { error: 'repo_not_found' } | { error: 'pull_not_found' }
502 → { error: 'github_unavailable' }
       | { error: 'graphql', detail: string[] }   // GraphQL returned errors
```

Note: a GraphQL-level error (HTTP 200 with an `errors` array) is surfaced as
`502 graphql` rather than masquerading as a `404`.

---

## Pull files (`/api/repos/:owner/:repo/pulls/:number/files`)

### `GET /api/repos/:owner/:repo/pulls/:number/files`

Changed files + patches (REST; mirror, ~45 s TTL). Patch bodies are cached
on-disk by blob SHA (see [caching](./caching.md)). Merges in per-user `viewed`
state.

```ts
200 → PullFile[]
  PullFile = { path, status, additions, deletions, sha, viewed, patch }
            // patch is null for binary / too-large / pure-rename files
400 → { error: 'bad_number' }
401 → { error: 'unauthenticated' } | { error: 'reauth' }
404 → { error: 'repo_not_found' }
502 → { error: 'github_unavailable' }
```

---

## PR write actions (`/api/repos/:owner/:repo/pulls/:number/...`)

All resolve the mirror PR row first; unknown owner/repo → `404 repo_not_found`,
non-integer number → `400 bad_number`, GitHub `401` → `401 reauth`. After
success each updates or busts the SQLite mirror (see
[github-integration](./github-integration.md#write-actions)).

### `POST .../merge`

Body `{ method?: 'merge' | 'squash' | 'rebase' }` (default `merge`).

```ts
200 → { state: 'merged' }
409 → { error: 'merge_failed', status: 405 | 409 }
      // GitHub 405 = not mergeable, 409 = head moved — both reported as 409
502 → { error: 'github_unavailable' }
```

### `POST .../:action{close|reopen}`

```ts
200 → { state: 'closed' | 'open' }
502 → { error: 'github_unavailable' }
```

### `POST .../draft`

Body `{ draft?: boolean }`. GraphQL; needs the mirrored PR node id.

```ts
200 → { draft: boolean }
409 → { error: 'node_id_unknown' }   // open the PR first to mirror its node id
502 → { error: 'github_unavailable' }   // includes GraphQL errors
```

### `POST .../comments`

Add a discussion comment. Body `{ body: string }`.

```ts
200 → { id, author, body, createdAt }
400 → { error: 'empty_body' }
502 → { error: 'github_unavailable' }
```

### `GET /api/repos/:owner/:repo/labels`

Repo label choices for the PR label picker. Returns the first 100 GitHub labels sorted by name.

```ts
200 → { name, color }[]
401 → { error: 'unauthenticated' } | { error: 'reauth' }
404 → { error: 'repo_not_found' }
502 → { error: 'github_unavailable' }
```

### `POST .../labels` / `DELETE .../labels`

Add or remove a label. Body `{ name: string }`. Returns the PR's full label set.

```ts
200 → { name, color }[]
400 → { error: 'empty_name' }
502 → { error: 'github_unavailable' }
```

### `POST .../viewed`

Toggle a file's "viewed" checkbox (app-state; **no GitHub call**). Body
`{ path: string, viewed: boolean }`.

```ts
200 → { path, viewed }
400 → { error: 'bad_request' }
```

### `POST .../review-comments`

Start a new inline review comment on a line. Needs the mirrored head sha. Body
`{ body, path, line, side? }` (`side` default `RIGHT`).

```ts
200 → { ok: true }
400 → { error: 'bad_request' }       // missing body/path/line
409 → { error: 'head_sha_unknown' }  // open the PR first to mirror head sha
502 → { error: 'github_unavailable' }
```

### `POST .../review-comments/:commentId/replies`

Reply to an existing thread. `:commentId` is the numeric `databaseId`. Body
`{ body: string }`.

```ts
200 → { ok: true }
400 → { error: 'empty_body' }
502 → { error: 'github_unavailable' }
```

### `POST .../threads/:threadId/resolve`

Resolve / unresolve a thread (GraphQL, by thread node id). Body
`{ resolved: boolean }`.

```ts
200 → { resolved: boolean }
502 → { error: 'github_unavailable' }   // includes GraphQL errors
```

### `POST /api/repos/:owner/:repo/actions/:runId/rerun`

Rerun a workflow run's failed jobs. **Repo-scoped** — `:runId` is the Actions
run id (from a check's `runId`), not a PR number.

```ts
200 → { ok: true }
401 → { error: 'unauthenticated' } | { error: 'reauth' }
403 → { error: 'forbidden' }            // insufficient Actions permission
502 → { error: 'github_unavailable' }
```

---

## Pins (`/api/pins`)

### `GET /api/pins`

This user's pinned repo ids, sorted ascending.

```ts
200 → number[]
401 → { error: 'unauthenticated' }
```

### `PUT /api/pins`

Pin or unpin one repo. Body `{ repoId: number, pinned: boolean }`.

```ts
200 → { repoId, pinned }
400 → { error: 'bad_request' }
401 → { error: 'unauthenticated' }
```

---

## Prefs (`/api/prefs`)

### `GET /api/prefs`

This user's preferences as a key→value map.

```ts
200 → Record<string, string>
401 → { error: 'unauthenticated' }
```

### `PUT /api/prefs`

Upsert one preference. Body `{ key: string, value: string }`.

```ts
200 → { key, value }
400 → { error: 'bad_request' }
401 → { error: 'unauthenticated' }
```

---

## Error codes {#error-codes}

| Code | Error | Meaning |
| --- | --- | --- |
| `400` | `bad_number`, `bad_request`, `empty_body`, `empty_name` | Malformed request |
| `401` | `unauthenticated` | No / invalid session cookie |
| `401` | `reauth` | GitHub returned `401` — token revoked/expired; client bounces to `/auth/login` |
| `429` | `rate_limited` | GitHub primary/secondary rate limit (`403`/`429` with `x-ratelimit-remaining: 0` or `retry-after`) |
| `403` | `sso` | GitHub `403` requiring SAML SSO authorization (`x-github-sso` header) |
| `403` | `forbidden` | Other GitHub `403` (insufficient scope/permission, e.g. rerun-failed-jobs) |
| `403` | (auth) `invalid state` | OAuth state mismatch/consumed (`/auth/callback`) |
| `404` | `repo_not_found`, `pull_not_found` | Resource not in this user's mirror / not on GitHub |
| `409` | `merge_failed` (`status` 405\|409) | Not mergeable (405) or head moved (409) |
| `409` | `node_id_unknown`, `head_sha_unknown` | Mirror lacks node id / head sha — open the PR first |
| `502` | `github_unavailable` | Any other non-OK GitHub response (incl. GraphQL mutation errors) |
| `502` | `graphql` (`detail: string[]`) | PR-detail GraphQL query returned errors |

> The `401`/`429`/`403` rows above are produced by the shared `ghError()` helper
> in `server/github/index.ts`, applied uniformly across every GitHub-backed route.
> Endpoint-specific statuses (merge `405`/`409`, GraphQL `errors`) are handled by
> the route before it delegates the rest to `ghError()`. The per-route blocks below
> list each route's common codes; any GitHub-backed route may additionally return
> `rate_limited`/`sso`/`forbidden` per this table.

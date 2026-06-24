# Caching

acorn layers three caches between the browser and GitHub. Each has a different
scope, lifetime, and privacy rule. The whole design follows one principle:
**serve the last-known data immediately, revalidate behind it.**

| Layer | Where | Scope | Holds |
| --- | --- | --- | --- |
| D1 mirror | Worker / D1 | Per user | All GitHub projections (repos, PRs, files, reviews, comments, checks, labels, threads) |
| KV `BLOBS` | Worker / KV | Shared, public repos only | Immutable patch/diff bodies keyed by blob SHA |
| IndexedDB | Browser | Per user / device | TanStack Query cache (last API responses) |

See [data-layer](./data-layer.md) for the schema behind layer 1 and
[offline-pwa](./offline-pwa.md) for how layer 3 powers offline browsing.

## Layer 1 — D1 mirror

The mirror is the Worker's read cache of GitHub. Every read goes through it
(see the serve-then-revalidate pattern below). Freshness is governed by a TTL
and, where available, an ETag.

### TTLs (`STALE_AFTER_MS`)

Exact values from the route source:

| Resource | Route | TTL |
| --- | --- | --- |
| Repos list | `routes/repos.ts` | `300_000` ms (~5 min) — "slow-changing" metadata |
| PR list | `routes/pulls.ts` | `45_000` ms (~45 s) — "fast-changing" list data |
| PR detail (composite) | `routes/pullDetail.ts` | `45_000` ms (~45 s) — "fast-changing" |
| PR files | `routes/pullFiles.ts` | `45_000` ms (~45 s) |

A row/collection is fresh when `fetchedAt + STALE_AFTER_MS > Date.now()`. Repos
gate on the newest row's `fetchedAt`; the PR list, PR detail and files gate on
the matching `sync_state` row.

### ETag conditional revalidation

When stale, endpoints that have an ETag revalidate conditionally rather than
blindly refetching:

- **Repos** capture the response `etag` (per-row column).
- **PR lists** store the collection ETag in `sync_state` and send
  `If-None-Match` on the next fetch. A **`304 Not Modified` is free** against
  the GitHub rate limit — the route just bumps `sync_state.fetchedAt` and
  re-serves the existing mirror rows:

```ts
if (res.status === 304) {
  await db.insert(schema.syncState)
    .values({ userId, resource, etag: sync?.etag ?? null, fetchedAt: now })
    .onConflictDoUpdate({ target: [...], set: { fetchedAt: now } })
  return c.json((await readRows()).map(toPublic))
}
```

- **GraphQL has no ETag.** PR detail (the composite read) cannot do conditional
  revalidation, so it is **TTL-only** — freshness is purely the `sync_state`
  gate. The same is true for `pr_files` (it's TTL-only in `sync_state`; the REST
  files call does not currently send `If-None-Match`).

> Conditional `If-None-Match` revalidation is wired in the PR-list route only;
> the repos route stores ETags per row but does not yet replay them, and
> `pr_files`/PR-detail are TTL-only. Rate-limit responses (`403`/`429`) are
> detected centrally by `ghError()` — see
> [github integration](./github-integration.md#etags-and-rate-limits).

### Serve-then-revalidate pattern

Every mirror read follows the same shape:

```
1. Read sync_state / newest fetchedAt.
2. Fresh within TTL?  → serve the mirror rows. No GitHub call.
3. Stale or missing?  → fetch GitHub (conditional If-None-Match if we have an ETag).
     - 304 → bump freshness, serve existing rows.
     - 200 → delete-then-insert rows + upsert sync_state, then serve.
```

List refreshes are **delete-then-insert in one `db.batch([...])`** so resources
the user lost access to (closed PRs, lost repos) drop out atomically. Because D1
caps bound parameters at 100 per statement, inserts are chunked by column count
(e.g. repos: 9 rows × 10 cols = 90 params; PRs: 6 rows × 14 cols = 84). `pr_files`
inserts one row per statement because patch bodies are large.

## Layer 2 — KV `BLOBS` (immutable patches)

The `BLOBS` KV namespace holds **patch/diff bodies**, keyed by the file's blob
`sha`:

```ts
const blobKey = (sha: string) => `patch:${sha}`
```

A patch body is immutable for a given blob sha — the content can't change
without the sha changing — so it is safe to cache indefinitely and to share.

**Public repos only.** In `routes/pullFiles.ts`:

- **Public repo:** patch bodies are written to KV (`BLOBS.put(blobKey(sha), …)`)
  and the D1 `pr_files.patch` column is left `null`. On read, the patch is
  resolved from KV by sha.
- **Private repo:** the patch body stays in the user-scoped D1 `pr_files.patch`
  column and never touches KV.

```ts
patch: f.patch ?? (f.sha ? await c.env.BLOBS.get(blobKey(f.sha)) : null)
```

This keeps the shared cache strictly public — see the rule below.

## Layer 3 — Client IndexedDB (TanStack Query persistence)

The SPA uses TanStack Query as a stale-while-revalidate cache and persists it to
IndexedDB via `idb-keyval`. From `apps/web/src/client/index.tsx`:

```ts
defaultOptions: { queries: { refetchOnWindowFocus: true, gcTime: 1000 * 60 * 60 * 24 } }
```

- **`gcTime`: 24h** (`1000 * 60 * 60 * 24`). Deliberately long so persisted
  entries survive a reload — that's what enables offline browsing of
  recently-seen PRs.
- **`refetchOnWindowFocus: true`** — refocusing the tab revalidates, keeping the
  serve-then-revalidate feel on the client.

The persister stores under key `acorn-cache` with `maxAge` 24h. On render the
app shows the last persisted data instantly, then refetches.

This cache is **per-user and private**. On logout the app wipes it
(`window.addEventListener('acorn:logout', () => void clear())`) so the next
user can't read it. See [offline-pwa](./offline-pwa.md) for the service-worker
app shell that complements this.

## Public/private cache rule {#public-private-rule}

The invariant that ties all three layers together:

> **Only public, identical-for-all-users data may live in shared storage.**

- D1 mirror rows are **user-scoped** (`userId` in every PK) — a private repo's
  mirror never serves across users. See [data-layer](./data-layer.md#user-scoping-rule).
- KV `BLOBS` is shared, so it holds **only** public patch bodies. Private
  patches stay in user-scoped D1.
- IndexedDB is per-device and per-user, and is cleared on logout.

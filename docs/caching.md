# Caching

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)). The shared-KV `BLOBS` cache is now a per-user **on-disk dir** keyed
> by SHA, and the old public-only caching guard (`if (!repoRow.private)`) has since been **removed**
> — every body caches locally regardless of repo visibility. The three-tier model and TTLs are
> otherwise unchanged.

acorn layers three caches between the browser and GitHub. Each has a different
scope and lifetime. The whole design follows one principle:
**serve the last-known data immediately, revalidate behind it.**

| Layer | Where | Scope | Holds |
| --- | --- | --- | --- |
| SQLite mirror | Local server / SQLite | Per user | All GitHub projections (repos, PRs, files, reviews, comments, checks, labels, threads) plus external issues (Linear, Rollbar → `issues`) |
| `BLOBS` cache | Local server / on-disk | Per device | Immutable patch bodies + full file bodies keyed by blob SHA |
| IndexedDB | Browser | Per user / device | TanStack Query cache (last API responses) |

See [data-layer](./data-layer.md) for the schema behind layer 1. Layer 3
(the IndexedDB-persisted TanStack Query cache, below) powers offline browsing
of recently-seen data.

## Layer 1 — SQLite mirror

The mirror is the local server's read cache of GitHub. Every read goes through it
(see the serve-then-revalidate pattern below). Freshness is governed by a TTL
and, where available, an ETag.

### TTLs (`STALE_AFTER_MS`)

Exact values from the route source:

| Resource | Constant | TTL |
| --- | --- | --- |
| Repos list | `REPOS_STALE_AFTER_MS`, `routes/repoMirror.ts` (used by `routes/repos.ts`) | `300_000` ms (5 min) — "slow-changing" metadata |
| PR list (open) | `STALE_AFTER_MS`, `routes/pulls.ts` | `45_000` ms (45 s) — "fast-changing" list data |
| PR detail (composite) | `STALE_AFTER_MS`, `routes/prMirror.ts` (shared by `pullDetail.ts` / `pullsBatch.ts`) | `45_000` ms (45 s) — "fast-changing" |
| PR files | same `prMirror.ts` constant (via `pullFiles.ts` / `pullsBatch.ts`) | `45_000` ms (45 s) |
| Linear issues | `ISSUES_STALE_AFTER_MS`, `routes/linear.ts` | `600_000` ms (10 min) — tickets move slowly; the panel forces fresh with `?refresh=1` |
| Rollbar items | `ITEMS_STALE_AFTER_MS`, `routes/rollbar.ts` | `120_000` ms (2 min) — errors move fast |

A row/collection is fresh when `fetchedAt + STALE_AFTER_MS > Date.now()`. Repos
gate on the newest row's `fetchedAt`; the PR list, PR detail and files gate on
the matching `sync_state` row; external issues gate on the `issues` row's
`fetchedAt`. The TTL windows live only in the route constants above — there is
no per-row `staleAfter` column.

The batch-prefetch route (`routes/pullsBatch.ts`) warms detail + files for up to
10 PRs at once and applies the same per-PR `sync_state` gates, so already-fresh
PRs cost no GitHub calls.

### ETag conditional revalidation

When stale, endpoints that have an ETag revalidate conditionally rather than
blindly refetching:

- **Open PR list** stores the collection ETag in `sync_state` and sends
  `If-None-Match` on the next fetch. (The **closed** PR list does *not* go
  through the mirror at all — it is proxied straight from GitHub one 50-item
  page per request and load-mored client-side; closed PRs are historical, so
  there is nothing worth caching in the mirror with a 45 s TTL.) A **`304 Not Modified` is free** against
  the GitHub rate limit — the route just bumps `sync_state.fetchedAt` and
  re-serves the existing mirror rows:

```ts
if (res.status === 304) {
  await db.insert(schema.syncState)
    .values({ userId, resource, etag: sync?.etag ?? null, fetchedAt: now })
    .onConflictDoUpdate({ target: [...], set: { fetchedAt: now } })
  return { ok: true, value: await readPublicRows() }
}
```

- **GraphQL has no ETag.** PR detail (the composite read) cannot do conditional
  revalidation, so it is **TTL-only** — freshness is purely the `sync_state`
  gate. The same is true for `pr_files` (it's TTL-only in `sync_state`; the REST
  files call does not currently send `If-None-Match`).

> Conditional `If-None-Match` revalidation is wired in the PR-list route only;
> the repos route and `pr_files`/PR-detail are TTL-only (no stored ETag — the
> one-time write-only `etag`/`staleAfter` columns were dropped from
> `repos`/`pull_requests`). Rate-limit responses (`403`/`429`) are detected
> centrally by `ghError()` — see
> [github integration](./github-integration.md#etags-and-rate-limits).

### Serve-then-revalidate pattern

Every mirror read follows the same shape:

```
1. Read sync_state / newest fetchedAt.
2. Fresh within TTL?    → serve the mirror rows. No GitHub call.
3. Stale but present?   → serve the mirror rows immediately, refresh in the
                          background (fire-and-forget).
4. Cold (nothing cached) or forced (`?force=true` on the PR list)?
                        → block on the GitHub fetch (conditional If-None-Match
                          if we have an ETag).
     - 304 → bump sync_state.fetchedAt, serve existing rows.
     - 200 → rewrite the mirror rows + upsert sync_state, then serve.
```

Background refreshes go through `trackBackgroundRefresh`
(`src/server/background.ts`) — a tracked fire-and-forget set with error logging.
Production never awaits them; tests settle them via `settleBackground()` from
the same module.

Two explicit invalidation paths bypass the TTL: `POST /api/repos/refresh` zeroes
every repo row's `fetchedAt`, and PR mutations bust the PR's `sync_state` row
(`bustPrSync` in `routes/prContext.ts`) so the next read refetches.

How the 200 path rewrites the mirror differs per resource:

- **Repos** (`refreshRepos`, `routes/repoMirror.ts`): delete-then-insert in one
  `db.batch([...])` (emulated via a better-sqlite3 transaction — see
  [electron.md](./electron.md) §4c) so repos the user lost access to drop out
  atomically.
- **Open PR list** (`routes/pulls.ts`): chunked **upsert** of list-level fields
  only — preserving detail-owned columns like `body` that the GraphQL detail
  route fetched — followed by a prune of rows whose `fetchedAt` predates the
  refresh, the Flow B task updates, and the `sync_state` upsert, all in one
  `db.batch` (a single transaction), so a mid-refresh failure leaves the
  previous mirror + stale sync intact and the next request retries.
- **PR detail children** (`mirrorPr`) and **`pr_files`** (`mirrorFiles`), both in
  `routes/prMirror.ts`: delete-then-insert in one `db.batch`.

Inserts are chunked by column count (`chunkRowsByColumnBudget`,
`src/server/db/batch.ts`) to keep each statement under a conservative
100-bound-parameter budget (`MAX_BOUND_PARAMS`) — better-sqlite3 allows far
more (32k+), but small statements stay predictable. `pr_files` inserts one row
per statement.

## Layer 2 — on-disk `BLOBS` cache (immutable patches)

The `BLOBS` cache holds **patch/diff bodies** and **full file bodies** (for
expanding unchanged context around diff hunks), keyed by the file's blob `sha`.
It's a local directory — `<dataDir>/blobs/`, where the data root is
`app.getPath('userData')` in packaged builds and the repo-local
`apps/desktop/.acorn/` in dev (`main/electron.ts` / `devDataDir` in
`src/main/server.ts`) — one file per key, implemented by `diskBlobCache`
(the typed `BlobCache { get, put }`) in `src/main/bindings.ts`
(non-filename-safe chars are sanitized to `_`, so `patch:<sha>` lands on disk
as `patch_<sha>`). Immutable content means no TTL and no delete. Both key
formats live in one shared module, `src/server/blobs.ts`:

```ts
export const patchBlobKey = (sha: string) => `patch:${sha}`       // prMirror.ts — patch bodies
export const fileBodyBlobKey = (sha: string) => `filebody:${sha}` // pullBlob.ts — full file bodies
```

A body is immutable for a given blob sha — the content can't change without the
sha changing — so it is cached indefinitely. There is **no eviction, by design**:
the cache is a single user's own diff bodies on their own disk, entries are
small text, and correctness never depends on deletion (a stale entry is
impossible; an unused one is just bytes). Revisit only if `.acorn/blobs/` ever
becomes a real disk-space complaint. Every body is cached regardless of repo
visibility: `mirrorFiles` writes patches to `BLOBS` (the `pr_files` table
carries only metadata + `sha`; its old always-null `patch` column is dropped),
and reads resolve from `BLOBS` by sha:

```ts
patch: includePatches && f.sha ? await env.BLOBS.get(patchBlobKey(f.sha)) : null
```

(The old public-only rule existed because Workers KV was *shared* across users; a
local single-user cache has no such constraint, and the `if (!repoRow.private)`
guard has been removed from `pullBlob.ts`/`prMirror.ts` — see
[electron.md](./electron.md) §5.)

## Layer 3 — Client IndexedDB (TanStack Query persistence)

The SPA uses TanStack Query as a stale-while-revalidate cache and persists it to
IndexedDB via `idb-keyval`. From `apps/desktop/src/client/index.tsx`:

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
user can't read it.

## Locality {#public-private-rule}

All three layers are now local to one machine and one user, so the old
"only-public-data-in-shared-storage" invariant (a Workers-KV concern) is retired:

- SQLite mirror rows are **user-scoped** (`userId` in every PK), inherited from the
  multi-tenant design. See [data-layer](./data-layer.md#user-scoping-rule).
- The `BLOBS` cache is an on-disk dir private to your machine — it caches all
  bodies by sha, public or private (the public-only guard is gone from the code).
- IndexedDB is per-device and per-user, and is cleared on logout.


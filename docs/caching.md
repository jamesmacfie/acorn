# Caching

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)). The shared-KV `BLOBS` cache is now a per-user **on-disk dir** keyed
> by SHA; the public/private split is vestigial on a single-user machine (Phase 3 removes it). The
> three-tier model and TTLs are otherwise unchanged.

acorn layers three caches between the browser and GitHub. Each has a different
scope and lifetime. The whole design follows one principle:
**serve the last-known data immediately, revalidate behind it.**

| Layer | Where | Scope | Holds |
| --- | --- | --- | --- |
| SQLite mirror | Local server / SQLite | Per user | All GitHub projections (repos, PRs, files, reviews, comments, checks, labels, threads) |
| `BLOBS` cache | Local server / on-disk | Per device | Immutable patch/diff bodies keyed by blob SHA |
| IndexedDB | Browser | Per user / device | TanStack Query cache (last API responses) |

See [data-layer](./data-layer.md) for the schema behind layer 1 and
[offline-pwa](./offline-pwa.md) for how layer 3 powers offline browsing.

## Layer 1 — SQLite mirror

The mirror is the local server's read cache of GitHub. Every read goes through it
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

List refreshes are **delete-then-insert in one `db.batch([...])`** (emulated via a
better-sqlite3 transaction — see [electron.md](./electron.md) §4c) so resources the
user lost access to (closed PRs, lost repos) drop out atomically. Inserts are
chunked by column count to keep each statement under a ~100 bound-parameter budget
(e.g. repos: 9 rows × 10 cols = 90; PRs: 6 rows × 14 cols = 84). `pr_files` inserts
one row per statement because patch bodies are large.

## Layer 2 — on-disk `BLOBS` cache (immutable patches)

The `BLOBS` cache holds **patch/diff bodies** (and full file bodies for context
expansion), keyed by the file's blob `sha`. It's a local directory under
`apps/web/.acorn/blobs/`, one file per key:

```ts
const blobKey = (sha: string) => `patch:${sha}`
```

A patch body is immutable for a given blob sha — the content can't change without
the sha changing — so it is cached indefinitely. Every body is cached this way
regardless of repo visibility: `mirrorFiles` writes patches to `BLOBS` and leaves
the `pr_files.patch` column `null`, and reads resolve from `BLOBS` by sha:

```ts
patch: f.patch ?? (f.sha ? await c.env.BLOBS.get(blobKey(f.sha)) : null)
```

(The old public-only rule existed because Workers KV was *shared* across users;
a local single-user cache has no such constraint — see [electron.md](./electron.md) §5.)

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

## Locality {#public-private-rule}

All three layers are now local to one machine and one user, so the old
"only-public-data-in-shared-storage" invariant (a Workers-KV concern) is retired:

- SQLite mirror rows are **user-scoped** (`userId` in every PK), inherited from the
  multi-tenant design. See [data-layer](./data-layer.md#user-scoping-rule).
- The `BLOBS` cache is an on-disk dir private to your machine — it caches all
  bodies by sha, public or private.
- IndexedDB is per-device and per-user, and is cleared on logout.

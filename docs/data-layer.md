# Data Layer

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)). The read-model mirror is unchanged but now lives in local SQLite
> (better-sqlite3 + Drizzle) under `apps/web/.acorn/`, not D1. `db.batch()` is emulated via a
> transaction (electron.md §4c). Read "D1" as "the local SQLite DB".

The data layer is [Drizzle ORM](https://orm.drizzle.team/) over local SQLite
(better-sqlite3). The schema is two kinds of table:

- **Mirror tables** — cached projections of GitHub data. Disposable,
  revalidated, populated on read. The SQLite mirror is a *cache of GitHub, not a
  source of truth* (see [architecture-overview](./architecture-overview.md)).
- **App-state tables** — data GitHub does not have. acorn is the source of
  truth: prefs, pinned repos, viewed-file checkboxes.

Source: `apps/web/src/server/db/schema.ts`,
`apps/web/src/server/db/index.ts`, `apps/web/migrations/`.

## Drizzle client

```ts
export const getDb = (env: Env): AppDatabase => env.DB
```

`env.DB` is the better-sqlite3 Drizzle client, built once at startup in
`src/main/bindings.ts` (with an emulated `.batch()`, since better-sqlite3 has no
native batch — see [electron.md](./electron.md) §4c). `getDb(env)` just hands it
back; routes import it directly.

## User-scoping rule

Almost every table is keyed by `userId` (the GitHub `login`). This is the
data-model expression of the **public/private rule**: a private repo's mirror
must never serve across users. Two users may mirror the same private repo, so
the GitHub repo `id` alone is *not* unique — the primary key includes
`userId`.

> `userId = user.login`. A `ponytail:` note in the source flags login-as-scope
> as "stable enough; revisit if logins churn."

Patch/blob bodies are the one thing kept outside the per-user tables: the on-disk
`BLOBS` cache (under `apps/web/.acorn/blobs/`) holds immutable bodies keyed by sha.
On a single-user machine the cache is private to you, so there is no public/private
split. See [caching](./caching.md).

## Mirror tables

These cache GitHub. They carry staleness bookkeeping and are refreshed
delete-then-insert.

### `repos`

PK `(userId, id)` — `id` is the GitHub repo id.

| Column | Notes |
| --- | --- |
| `userId`, `id` | scope + GitHub repo id |
| `owner`, `name` | |
| `private` | boolean; repo visibility (no longer affects caching — all bodies cache locally) |
| `defaultBranch` | |
| `pushedAt` | epoch ms; the repo selector orders by this |
| `fetchedAt`, `staleAfter`, `etag` | staleness columns (below) |

### `pull_requests`

PK `(userId, repoId, number)`.

| Column | Notes |
| --- | --- |
| `nodeId` | GraphQL node id — needed for draft↔ready toggles |
| `state` | `open` \| `closed` \| `merged` |
| `draft` | boolean |
| `title`, `body` | `body` is sanitized `bodyHTML` from GraphQL |
| `headSha` | head commit oid — used as `commit_id` for line comments |
| `headRef`, `baseRef`, `author`, `updatedAt` | |
| `fetchedAt`, `staleAfter`, `etag` | staleness columns |

### PR-detail children

These are mirrored together from the GraphQL composite read (and `pr_files`
from REST) and replaced wholesale on each sync. They have **no per-row
staleness** — freshness is governed centrally by `sync_state`
(`pr:<repoId>:<number>`). All are user-scoped and keyed off the PR
`(userId, repoId, number)` plus a per-row discriminator.

| Table | PK discriminator | Holds |
| --- | --- | --- |
| `pr_files` | `path` | `status`, `additions`, `deletions`, `sha` (blob sha); `patch` is always null — bodies resolve from the on-disk BLOBS cache by sha |
| `reviews` | `id` (node id) | `author`, `state`, `body`, `submittedAt` |
| `comments` | `id` (node id) | `author`, `body`, `createdAt` |
| `pr_commits` | `sha` | `message`, `author`, `authorLogin`, `committedAt` |
| `review_threads` | `id` (comment node id) | inline review-comment threads. Thread-level fields (`threadId`, `path`, `line`, `side`, `resolved`) are denormalized onto each comment row. `databaseId` is the numeric id REST needs for replies |
| `pr_labels` | `name` | `color` (6-hex, no leading `#`) |
| `checks` | `name` | `status`, `url`, `runId` (the Actions `workflowRun.databaseId`; null for status contexts — enables rerun-failed-jobs) |

### `sync_state`

PK `(userId, resource)`. **Collection-freshness bookkeeping.** A list endpoint's
ETag and last-fetch time have no per-row home, so they live here.

| Column | Notes |
| --- | --- |
| `userId`, `resource` | resource keys: `pulls:<repoId>:<state>`, `pr:<repoId>:<number>`, `files:<repoId>:<number>` |
| `etag` | the collection ETag for conditional revalidation (where available) |
| `fetchedAt` | epoch ms; the TTL gate compares `fetchedAt + staleAfter` to now |

A read checks `sync_state` first: if fresh within the TTL, it serves the mirror
with no GitHub call. PR-detail mutations bust the relevant `sync_state` row so
the next read refetches (see
[github-integration](./github-integration.md#write-actions)).

## Staleness columns

Two patterns coexist:

- **Per-row** (`repos`, `pull_requests`): a row is stale when
  `now > fetchedAt + staleAfter`. `etag` drives conditional revalidation.
- **Per-collection** (`sync_state`): the PR-detail children and file/PR lists
  have no per-row staleness; the single `sync_state` row gates the whole
  collection.

Exact TTL values and the ETag/304 flow are in [caching](./caching.md).

## App-state tables

acorn owns these. No mirror, no TTL — they survive mirror re-syncs.

### `viewed_files`

PK `(userId, repoId, number, path)`. Per-user "I've reviewed this file"
checkboxes. Not a GitHub concept; merged into the files read fresh on every
request so it persists across mirror re-syncs.

### `pinned_repos`

PK `(userId, repoId)`. Per-user pinned repos for the selector, ordered by `sort`
(ascending; appended at `max(sort)+1`).

### `prefs`

PK `(userId, key)`. Per-user key→value preferences (theme, diff view mode,
keybinding overrides, …). `GET /api/prefs` returns a key→value map; `PUT`
upserts one key.

## Migrations

Drizzle Kit is **generate-only** (`drizzle.config.ts`): it emits SQL from the
schema and never connects to a database itself.

```ts
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './migrations',
})
```

Workflow:

```bash
pnpm db:generate   # drizzle-kit generate → new SQL file in apps/web/migrations/
pnpm db:migrate    # tsx scripts/migrate.ts → apply to local SQLite (also runs on app startup)
```

Migrations live in `apps/web/migrations/` (`0000_*.sql` … `0013_*.sql` at time
of writing, plus a `meta/` snapshot directory) and are applied to the local
SQLite DB by `drizzle-orm/better-sqlite3/migrator` — automatically on app
startup (`openDb` in `src/main/bindings.ts`) and via `pnpm db:migrate`. The DB
and on-disk blob cache live under `apps/web/.acorn/` — see
[local-development](./local-development.md).

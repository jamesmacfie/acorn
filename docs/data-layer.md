# Data layer

The Node is the only owner of authoritative application data. SQLite uses the runtime's
`node:sqlite` and Drizzle, with one core database and one database for each table-owning plugin. The owning package
contains the schema and migration chain.

## Data root

Development uses `apps/node/.acorn/`; packaged Electron uses the app's `userData` root; standalone
Nodes use `ACORN_DATA_DIR` or the development default. The root is mode `0700` and protected by an
exclusive `node.lock`.

```text
<data-root>/
  core.sqlite
  plugins/<name>.sqlite
  blobs/
  worktrees/
  tls/{key.pem,cert.pem}
  logs/
  node.json
  node.lock
  internal-token
  active-identity
```

`node.json` stores the stable Node ID, its creation time, the preferred last-bound port, and the
  operator's `advertiseHost` answer. No certificate material — that is `tls/` — and no protocol
  version: it used to carry one, written at first boot, read by nothing, and stale the moment the
  binary serving the root moved on (`docs/api-reference.md § Versioning`). Its schema ignores unknown
  keys precisely so a field can be retired without stranding roots that still have it. A root is
  opened by `openDataRoot`, which creates the identity, takes the lock, and refuses an incompatible
  root. Refusing rather than falling back to a fresh identity matters because a root that already has
  paired devices must not have those pairings silently orphaned by a new random ID. Database upgrades
  are applied by the owning migration chain; backups are explicit archives and never mutate their
  source data.

Files written once into the root, the node identity, the session key, and the active-identity file,
use an atomic write: a temp file, an fsync, then a rename, so a crash mid-write cannot leave a
truncated file behind.

## Core database

Core owns data shared by multiple features:

| Area | Tables |
| --- | --- |
| Identity/transport | `devices`, `idempotency`, `audit` |
| Workspaces/tasks | `workspaces`, `projects`, `workspace_external_projects`, `tasks`, `task_links` |
| Project configuration/trust | `projects`, `config_acks` |
| Provider registry | `integrations` |
| External item projection | `issues`, `issue_resources`, provider `sync_state` markers |
| Node preferences | `prefs` |
| Schedules | `schedule_state`, `user_schedules`, `schedule_runs` |
| Dashboard measure history | `dashboard_measure_samples` |

Core table definitions are in `packages/node-core/src/server/db/schema.ts`. `devices` stores only
token hashes. `integrations` stores encrypted provider credentials plus non-secret provider metadata.
`config_acks` stores the exact hash and snapshot of trusted executable repository configuration. The
three schedule tables split state from definition by owner: a schedule declared by core or a plugin
keeps its definition in the registry and only its overrides and run state in `schedule_state`, while a
user-created one is a full row in `user_schedules` (`docs/schedules.md`).

`dashboard_measure_samples` is its own table rather than a row in the `core.dashboards` prefs slice,
for three reasons. The slice has a 64 KB cap and this is an unbounded-ish time series; every sample
would rewrite and re-sync the whole blob; and an old client round-trips a slice by writing back what
it parsed, which would make any old client a history-eraser. History is data with a retention policy,
not a preference. One sample per hour bucket per panel, machine-scoped like every other newer
app-state table; the sampler is `core:sample-measures` (`docs/dashboards.md § Trends`).

## Plugin databases

These plugins own SQLite files and migrations:

| File | Main data |
| --- | --- |
| `plugins/agents.sqlite` | managed sessions, turns, event ledger, requests, attachments, artifacts, webhooks, FTS |
| `plugins/changes.sqlite` | review notes and plugin-local change state |
| `plugins/database.sqlite` | project-scoped saved SQL queries, and the per-task scratch document behind the pane's editor (a LOADED plugin — same binding as `http.sqlite` below) |
| `plugins/github.sqlite` | repository/PR mirror, PR children, GitHub freshness, viewed files, pinned repos |
| `plugins/http.sqlite` | project-scoped requests/variables, encrypted request fields (a LOADED plugin — this file is bound from its manifest id, and its chain ships inside the package) |
| `plugins/memory.sqlite` | project-scoped derived memory index, proposals, FTS |
| `plugins/terminal.sqlite` | terminal session metadata; PTY output is not persisted there |
| `plugins/workflows.sqlite` | definitions, runs, steps, gates, and trigger state |

Docker, editor, Linear, Rollbar, model providers, preview, onboarding, and the built-in agents
profiles use core services or provider registries without their own database file. Notes has no
database either: task/workspace/global notes are markdown files under `<data-root>/notes`, and the
row this table used to carry for `plugins/notes.sqlite` described a store that no longer exists
(`plugins/notes/src/main/notes.ts`; `docs/notes-and-memory.md` still repeats the old claim).

A plugin declares that it owns tables in one line — `migrationsModule: import.meta.url` on its
`NodePlugin`, or `migrations` in its manifest if it is loaded from disk — and gets its handle from
`ctx.storage.open()`. It never names the file, the data root, or the chain's directory, and it does not
close the handle. See § Migrations below.

Every route a table-owning plugin registers is a factory function that closes over the handle
`ctx.storage.open()` returned, never a module-scope router that reads a handle off the request
environment. The environment carries no per-plugin database handles, so a request can never reach one
before that plugin's migrations have run: the handle exists only after `ctx.storage.open()` returns,
and every router is built from it after that point. It also means two `startServiceRuntime` instances
in the same process, as in a test, each build their own routers over their own handle instead of one
inheriting a handle the other has already closed.

Plugin databases have independent migration chains. There are no cross-database foreign keys,
`ATTACH` queries, or transactions spanning files. A cross-plugin workflow uses IDs, capabilities,
events, and durable operation state rather than joining tables.

## Database plugin: the Postgres pane

The database plugin's pane connects to a Postgres database per task, for browsing and editing the
task's dev database. That connection is not part of acorn's own data root: it is the user's own
database, reached over `pg`, and everything the pane shows is re-derived from it per call rather
than cached in `plugins/database.sqlite`.

`resolveDbUrl` (`plugins/database/src/main/database.ts`) resolves the connection URL for a task
without persisting it, trying in order: a committed `.acorn/config.toml [database].url_script`
(run inside the worktree), then `<worktree>/.env`'s `DATABASE_URL`, then `process.env.DATABASE_URL`.
A committed `url_script` is executable content from the checkout, so resolving it goes through the
same repo-config trust gate as other repo-authored run targets (`core/main/repoConfigTrust.ts`):
cloning a repo, or checking out a PR that adds the script, must not be enough to run it. A
user-or-database-authored script (`dbUrlFromRepo` false) is the user's own input and is not gated.

Every identifier the pane sends to Postgres (schema, table, and column names) is validated against
the live introspected schema before it is quoted, because identifiers can't be parameterized the
way values can. Values are always parameterized. Arbitrary SQL typed into the editor runs verbatim,
because it is the user's own database and writes are the point.

The introspected catalog behind table and column completions is cached per task and invalidated on
connect, on disconnect, and after any statement that is not a plain read or write, as a cheap
approximation for "DDL ran through this pane." A stale completion popup is a small bug, but a
visible one, and someone running a migration in the editor above the results grid is exactly who
would hit it.

AI query generation sends the introspected schema, the repo's free-form schema notes
(`projects.db_schema_notes`), and any saved queries picked as examples to a connected model
provider. The schema text is capped at 80,000 characters (`SCHEMA_CHAR_CAP`) and the notes/examples
block at 16,000 (`GENERATE_MAX_CONTEXT_CHARS`), so the two together stay under the model runtime's
100,000-character system prompt limit.

`plugins/database.sqlite` (see Plugin databases above) holds the project-scoped saved queries and
the task-scoped scratch document behind the pane's editor. Saved queries outlive any one task
worktree because they are written against a project's schema rather than a task's checkout; the
scratch document is task-scoped because it holds whatever the reader is doing right now.

## External-item read model

`issues`, `issue_resources`, `task_links`, and provider `sync_state` rows are deliberately core-owned
shared read models, not an accidental Linear or Rollbar database. The provider plugins own their
remote adapters and write through `ExternalItemStore`; core task context, linked-item resolution,
storage-footprint reporting, and more than one provider consume the same normalized cache. Moving the
tables into one provider would either duplicate the cache or make core join a plugin database, both of
which violate the one-database-per-plugin boundary.

The integration disconnect cascade in `packages/node-core/src/server/db/cascade.ts` therefore removes
the core rows keyed to the disconnected integration. It intentionally contains only core tables: no
plugin database has a foreign key into `integrations`, so there is no plugin-specific cascade
declaration to execute. Plugin-local rows are independently retained or pruned by their owning plugin.

## Collections: a projection, never a second store

A **collection** is a plugin route that answers with typed records the host draws itself — the data
side of [dashboards.md](./dashboards.md). It owns no tables and adds no file. It is a read over the
mirror the plugin already maintains: github's `pulls-mine` is a select over `plugins/github.sqlite`
joined to its repos, linear's `issues-mine` is the same fan-out over connections its rail source uses.
A plugin that has nothing mirrored has nothing to expose this way, and that is the intended shape —
the contribution exists to make an existing read composable, not to justify a new one.

Freshness splits across the two sides, and the split is the point:

- **Node-side TTL is the plugin's**, decided per route with whatever that plugin already uses. Linear
  declares one on the descriptor because its reads fan out per connection and no single resource
  exists for `serveThenRevalidate` to hold. GitHub's collection route declares none and never drives
  the mirror: freshness there stays with the repo-scoped list route a person is waiting on, because a
  panel polls unattended across every repository at once and revalidating here would multiply one
  dashboard by the user's repo count against a rate limit the whole plugin shares. The honest cost is
  rows as old as the last time that repo's PR list was opened.
- **Client-side refresh is per panel and the user's**, bounded to 30s–86400s. It is the first
  contribution whose refetch policy is per-contribution rather than the single shared chrome revision.

The one place a collection is *not* a read over the mirror is github's `involves` param — "review
requested of me", "assigned to me", "authored by me". Two of those three have no answer in the mirror:
assignees are not mirrored at all, and review requests arrive only with the PR-**detail** sync, so the
mirror knows you were asked to review exactly the pull requests you already opened. So that param
switches the route to one GitHub search (`review-requested:@me`), filling the same columns. It is
allowed the request the mirror read is not for the reason above inverted: the objection was N repos ×
one poll, and a search is one call whatever the repo count. It also reaches repos that were never
mirrored, which for "what is waiting on me" is the point rather than a side effect.

## Ownership rules

Provider data is a disposable read model. GitHub, Linear, and Rollbar remain the upstream source of
truth; refresh can delete and rebuild local rows. Application-owned state survives provider refreshes.

Machine-scoped entities include workspaces, tasks, notes, memories, terminal metadata, worktrees,
  and project configuration. Identity-scoped records use the node's boot-bound opaque owner id;
provider account changes must not alter the owner's settings, integrations, or saved requests.

The shared `blobs/` directory is content-addressed. It stores immutable patch bodies, file bodies,
attachments, and artifacts by SHA. Plugin rows may retain a blob until the owning record is deleted.
Worktrees are ordinary filesystem directories under the root and are not a database cache.

## Preferences and client persistence

Node preferences are stored in the core `prefs` key/value table and accessed through the core prefs
routes. Device presentation preferences (theme, style, keybindings, and layout) live in the desktop's
local persistence. Client persistence also holds fleet membership, Node labels/pins, selection,
per-task layouts, and drafts.

Query data is not authoritative. `client-core` maintains one TanStack Query client and IndexedDB
persister per Node, with scoped keys and a Node-switch eviction handler. Two Nodes can hold the same
resource ID without colliding.

## Migrations

Edit the schema in its owning package, run `pnpm db:generate`, and verify every chain with
`pnpm db:check`. Launching a Node also applies pending migrations. The desktop build stages core and
plugin migration directories beside the bundled Node artifact — except for a LOADED plugin, whose chain
is staged inside its own package by `apps/node/scripts/build-plugin.mjs` and read from there, because the
package is the only copy the loader will look at. http is the one plugin on that path.

Every chain starts from a single baseline migration that creates the current schema. The pre-project
`(owner, name)` model and its one-way data migrations were squashed away with it, so a database
written before that baseline cannot be upgraded — start from a fresh data root.

Native SQLite access is centralized, and both plugin tiers reach it the same way: `ctx.storage.open()`
returns a migrated handle whose filename the host bound to the plugin id. Only the source of the chain
differs — a loaded plugin's manifest names a directory confined to its package, a built-in declares
`migrationsModule: import.meta.url` on its `NodePlugin` and the host walks from there
(`packages/node-core/src/main/pluginMigrations.ts` covers all three runtime layouts).

A built-in's chain lives in one of three places depending on how the node was run: a source checkout
(`plugins/<name>/migrations/`), a built desktop app before packaging
(`apps/desktop/out/migrations/<name>/`, beside core's own chain at `out/migrations/`), or a packaged app
(`<resources>/migrations/<name>/`). `pluginMigrationsFolder` resolves this by walking up from the
plugin's own module URL, never from node-core's, so a plugin can never find node-core's chain by
proximity and adopt the wrong schema. At each level it checks the plugin-scoped candidate
(`migrations/<plugin>/`) before the bare `migrations/` directory, because the built and packaged
layouts place core's chain and a plugin's chain side by side. The walk never crosses the plugin's own
package root, so a missing chain fails rather than silently adopting an ancestor's DDL. A loaded
plugin skips the walk entirely: its manifest names the directory, already confined to its package, and
`pluginMigrationsChain` only validates that a Drizzle chain actually exists there. The host opens each
file lazily on first use, hands out one handle per boot, and closes it immediately after that plugin's
`dispose()` — so a plugin's dispose is about the resources the plugin itself owns, and a plugin whose only
resource was the database needs no dispose at all. Both tiers use `CoreServices` for core-owned
operations. What happens when a loaded plugin's chain GROWS between
versions — the update applies at the next boot, against a database that already has rows — is covered by
`apps/node/test/integration/httpLoaded.test.ts`, along with a broken chain failing contained and
uninstall-without-purge keeping the file.

Drizzle-kit cannot model a virtual table, so a plugin that wants FTS5 search
(`plugins/agents.sqlite`'s `agent_events_fts`, `plugins/memory.sqlite`'s `memories_fts`) writes the
`CREATE VIRTUAL TABLE` and its triggers by hand into its migration SQL instead of declaring them in
the Drizzle schema. The schema file still declares the backing columns the triggers read, so renaming
one there is a signal to update the migration, but the thing that actually catches a missed rename is
a schema-drift test that opens the migrated database and checks the virtual table's shape against the
schema, because the trigger body is plain SQL text with no type checker over it
(`plugins/agents/src/node/ftsSchema.test.ts` is the pattern to copy).

## Backup and import

`POST /v2/core/backup` snapshots core and plugin SQLite databases with SQLite's online-backup API;
`GET` on the same route returns the suggested destination path.
The archive excludes blobs and worktrees and scrubs credentials, device rows, and other token
material. Restore is a manual operation into a fresh data root.

The archive holds `core.sqlite` and every `plugins/*.sqlite`: the workspace and task model, repo
configuration, agent transcripts, notes, memories, and the HTTP client's saved requests. Secrets are
blanked rather than removed, so an `integrations` row survives with an empty `access_token`: a
restored node still shows that a connection existed and needs re-entering, and a deleted row would
have silently lost the workspace links that point at it. Device rows are deleted outright, since a
device row is itself a credential's public half and a restored node must re-pair rather than show a
list of machines that no longer have access. Blobs and worktrees are excluded for size, not risk: the
blob cache is routinely the largest thing in a data root and is refetchable from the provider, and a
worktree is a git checkout whose restore is `git clone`.

There is no runtime configuration importer, and no upgrade path from a pre-baseline database; a
backup remains the supported way to preserve a source before an upgrade.
Executable configuration recovered without a matching `config_acks` row must be reviewed again.

## Retention

There is a scheduler now (`docs/schedules.md`), and both boot-time sweeps moved onto it. The old
argument — that a node nobody restarts is also one nobody accumulates a backlog on — had it backwards:
a node left running for a month pruned nothing at all. The idempotency sweep followed the audit prune
for exactly that reason; expired replay rows already *read* as absent, so it was always space rather
than correctness, and space is what a long-lived node accumulates.

- idempotency rows: 24 hours, reclaimed by the `core:idempotency-sweep` schedule (daily, 03:05 node-local);
- audit rows: 90 days, pruned by the `core:audit-prune` schedule (daily, 03:20 node-local);
- terminal replay: bounded per session;
- logs: size/age policy owned by the Node runtime;
- plugin databases: retained while a plugin is disabled; deletion is explicit;
- provider mirrors and blobs: refetchable and prunable according to their cache policies.

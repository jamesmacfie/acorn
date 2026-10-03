# Data layer

The Node is the only owner of authoritative application data. SQLite uses the runtime's
`node:sqlite` and Drizzle, with one core database and one database for each table-owning plugin. The
owning package contains the schema and migration chain.

## Shared typed values

`packages/protocol/src/data/values/dataValues.ts`, `packages/protocol/src/data/values/dataSchemas.ts`, and
`packages/protocol/src/data/values/dataBindings.ts` own the version 1 typed-data contract. Node and client
plugin facades export its parsers and types. `acorn-plugin-types` publishes matching declarations
for installed plugins; its contract test checks assignability in both directions.

Values preserve finite numbers, booleans, null, arrays, and plain objects. Structural schemas accept
`type`, `properties`, `required`, `items`, primitive `enum`, and boolean `additionalProperties`.
Nullable types combine one type with null. Unsupported keywords fail parsing. Allowed additional
keys survive validation. Field labels, display hints, choices, and query capabilities are separate
metadata. Observed fields cannot claim choices or query capabilities.

Pointers use escaped JSON Pointer segments and own data properties. Prototype names, malformed
escapes, and accessors are rejected. Array fields can be addressed whole; metadata does not infer
element indices from samples. Missing is an internal symbol, distinct from null. Canonical projection
encoding includes sorted field addresses and explicit missing markers. Object keys sort by code
unit; array ordering and primitive types remain significant.

`DATA_LIMITS` owns bounds, including 12 nested levels, 256 fields, 2,048-character descriptions,
four predicate group levels, and 50 comparisons. Comparisons do not coerce values. Ordered
comparisons require matching strings or numbers; presence tests handle missing explicitly.

## Data root

Development uses `apps/node/.acorn/`, a packaged desktop build uses the OS application-data root, and
standalone Nodes use `ACORN_DATA_DIR` or the development default. The root is mode `0700` and
protected by an exclusive `node.lock`.

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

`node.json` stores the stable Node ID, its creation time, the preferred last-bound port, the
operator's `advertiseHost` answer, and — only on a Node somebody provisioned — the attachment record
naming the control plane it enrolled with ([node enrollment](./node-enrollment.md)). No certificate
material, which lives in `tls/`, and no protocol version. It used to carry one, written at first boot, read by nothing, and stale the moment the
binary serving the root moved on. See versioning in [the API reference](./api-reference.md). Its
schema ignores unknown keys so a field can be retired without stranding roots that still have it.

The recoverable reset command is documented in [local development](./local-development.md). It names
each selected root explicitly and inventories owned files. It never removes `worktrees/` or a whole
data root.

`openDataRoot` creates the identity, takes the lock, and refuses an incompatible root. Refusing
rather than falling back to a fresh identity matters because a root that already has paired devices
must not have those pairings silently orphaned by a new random ID. Database upgrades are applied by
the owning migration chain. Backups are explicit archives and never mutate their source data.

Files written once into the root, the node identity, the session key, and the active-identity file,
use an atomic write: a temp file, an fsync, then a rename, so a crash mid-write cannot leave a
truncated file behind.

Every write to `node.json` is also a read-modify-write against the file rather than a serialisation of
whatever the open `DataRoot` last held. Two owners write it now — this process's data root, and the
detach route in a later process — and a writer that serialised its cached copy would silently drop the
other's field.

## Core database

Core owns data shared by multiple features:

| Area | Tables |
| --- | --- |
| Identity/transport | `devices`, `idempotency`, `audit` |
| Workspaces/tasks | `workspaces`, `projects`, `workspace_external_projects`, `tasks`, `task_links`, `task_pulls` |
| Project configuration/trust | `projects`, `config_acks` |
| Provider registry | `integrations` |
| External item projection | `issues`, `issue_resources`, provider `sync_state` markers |
| Node preferences | `prefs` |
| Schedules | `schedule_state`, `user_schedules`, `schedule_runs` |
| Dashboard measure history | `dashboard_measure_samples` |
| Dashboard authoring | `dashboard_drafts`, `dashboard_revisions` |
| Saved queries | `query_drafts`, `query_revisions`, `query_consumers` |

Core table definitions are in `packages/node-core/src/server/db/schema.ts`. Query tables are defined in the feature-owned
`packages/node-core/src/server/queries/schema.ts` and exported through the core schema. Draft saves
and publication check affected-row counts. Published query content and digests are immutable;
revision rows outlive deleted drafts. Consumer references block deletion. See
[the query library contract](./data-sources.md#workspace-query-library).
Dashboard draft and revision tables are likewise feature-owned under
`packages/node-core/src/server/dashboards/schema.ts`. Published rows are immutable, draft saves use
affected-row compare-and-swap checks, and saved query references register panel consumer records.

`devices` stores only
token hashes. `integrations` stores encrypted provider credentials plus non-secret provider metadata.
`task_pulls` stores task-owned PR relations created through Acorn, including managed-agent
provenance; the GitHub mirror remains plugin-owned and disposable.
`config_acks` stores the exact hash and snapshot of trusted executable repository configuration. The
three schedule tables split state from definition by owner. A schedule declared by core or a plugin
keeps its definition in the registry and only its overrides and run state in `schedule_state`, while
a user-created one is a full row in `user_schedules`. See [the schedules doc](./schedules.md).

`dashboard_measure_samples` is its own table rather than a row in the `core.dashboards` prefs slice,
for three reasons. The slice has a 64 KB cap and this is a growing time series. Every sample would
rewrite and re-sync the whole blob. And an old client round-trips a slice by writing back what it
parsed, which would make any old client a history-eraser. History is data with a retention policy,
not a preference. One sample per hour bucket per panel, machine-scoped like every other newer
app-state table. The sampler is `core:sample-measures`, covered by trends in
[the dashboards doc](./dashboards.md).

## Plugin databases

These plugins own SQLite files and migrations:

| File | Main data |
| --- | --- |
| `plugins/agents.sqlite` | managed sessions, turns, event ledger, delegation spawn ledger, requests, attachments, artifacts, webhooks, FTS |
| `plugins/changes.sqlite` | review notes and plugin-local change state |
| `plugins/database.sqlite` | project-scoped saved SQL queries, and the per-task scratch document behind the pane's editor (a loaded plugin, same binding as `http.sqlite` below) |
| `plugins/browser.sqlite` | browser captures and screenshot bytes |
| `plugins/github.sqlite` | repository/PR mirror, PR children in provider order, PR file patch state and digest, GitHub freshness and files completeness, viewed files, pinned repos |
| `plugins/http.sqlite` | project-scoped requests and variables, encrypted request fields (a loaded plugin, so this file is bound from its manifest id and its chain ships inside the package) |
| `plugins/terminal.sqlite` | terminal session metadata; PTY output is not persisted there |
| `plugins/workflows.sqlite` | Workflow drafts and immutable revisions, dependency/publication journals, recoverable repository-file drafts and write journals, runs, steps, gates, dispatches, approved schedule bindings and occurrences, processing scopes, selections, record states, attempts, and committed source boundaries |

The GitHub mirror replaces a pull request's detail, and separately its files, in one `db.batch`
each, together with that resource's `sync_state` row. Every PR child table has a `position` column:
the row's zero-based place in GitHub's order for that pull, which reads order by. `review_threads`
counts across every comment of every thread, so one ordering recovers both the thread order and the
comment order. `pr_files` also holds `patch_state` and `patch_key`, the digest the patch body is
stored under. `sync_state` has four nullable columns, `incomplete_cause`, `received`,
`reported_total`, and `upstream_limit`, that only a files resource sets, and only when GitHub's
3,000-file ceiling cut the list short. The mirror's second migration empties the PR child tables and
drops the `pr:` and `files:` sync rows, so every pull refetches once after the upgrade.

The diff viewer's documents are generated data, and none of it is a table
([diff-rendering.md](./diff-rendering.md) § The document). A pull request's segment descriptors are a
blob per patch, keyed by the patch digest and the diff-document version, written beside the patch
body before the swap; `pr_files.patch_key` is what makes them valid, and a new version of the
segmenter reads a different key and cuts again. Segment rows are never stored: they are cut from the
patch body when asked for. A compare preview stores its patch bodies the same way and nothing else.
A working tree's documents are process memory in the Changes plugin, valid for the digest the last
document gave each file and lost on restart.

Docker, editor, Linear, Rollbar, model providers, preview, onboarding, and the built-in agents
profiles use core services or provider registries without their own database file. Notes has no
database either: task, workspace, and global notes are markdown files under `<data-root>/notes`, in
`plugins/notes/src/server/notes.ts`. The row this table used to carry for `plugins/notes.sqlite`
described a store that no longer exists, and [notes and memory](./notes-and-memory.md) still repeats
the old claim.

A plugin declares that it owns tables in one line, either `migrationsModule: import.meta.url` on its
`NodePlugin` or `migrations` in its manifest if it is loaded from disk, and gets its handle from
`ctx.storage.open()`. It never names the file, the data root, or the chain's directory, and it does
not close the handle. See the migrations section below.

Every route a table-owning plugin registers is a factory function that closes over the handle
`ctx.storage.open()` returned, never a module-scope router that reads a handle off the request
environment. The environment carries no per-plugin database handles, so a request can never reach one
before that plugin's migrations have run. The handle exists only after `ctx.storage.open()` returns,
and every router is built from it after that point. It also means two `startServiceRuntime` instances
in the same process, as in a test, each build their own routers over their own handle instead of one
inheriting a handle the other has already closed.

Plugin databases have independent migration chains. There are no cross-database foreign keys,
`ATTACH` queries, or transactions spanning files. A cross-plugin workflow uses IDs, capabilities,
events, and durable operation state rather than joining tables.

`agent_spawns` is the Agents plugin's authority relation for agent-driven delegation and its recovery
record. It stores root and direct-owner IDs, stable child task and session IDs, depth, isolation,
provisioning state, and an owner-scoped idempotency key. It does not mirror child runtime state. A
worktree spawn crosses the Agents and core databases through stable IDs and replayable operations;
there is no cross-file transaction.

`workflow_runs` stores explicit root run, parent run, parent step, and depth fields. It also keeps the
resolved definition graph, effective authority, absolute deadline, and optional invocation identity
used for recovery. These are execution records, not response fields: task run reads project them into
parent and root task links without exposing the frozen internal authority. Every new run has a
non-null `root_run_id`, including a root run, which points to itself.

`workflow_dispatches` is the replay ledger for child workflow tasks. A unique caller key and payload
fingerprint reserve stable task and run IDs before either cross-database effect. The row progresses
through `reserved`, `task-created`, `run-started`, `cancelling`, and `terminal`; reconciliation reads
that state and repeats only the missing transition. Core task IDs are plain cross-database IDs, so
there is no foreign key or transaction spanning the workflow and core databases.

`workflow_schedules` stores the approved project, published graph, typed inputs, limits, timezone,
generation, processing epoch, activation state, and first-check choice. Core's `user_schedules` row
stores only the cadence and `{ scheduleId }` target. `workflow_schedule_occurrences` reserves stable
root task and run IDs before either database effect. Unique request and generation/due keys make
manual replay, catch-up, and timer replay converge on one intent. Deletion retains a workflow-owned
tombstone and its occurrence history after core removes the cadence row.

`workflow_turn_admissions` records each provider turn before dispatch and settles it once with cost
and token usage. Rows are keyed to the root, run, and step. Root run projections sum the whole tree;
child projections sum only that child. A reserved row still consumes the allowance after a crash,
because the provider may have accepted work before the terminal usage event was lost.

## Database plugin: the Postgres pane

The database plugin's pane connects to a Postgres database per task, for browsing and editing the
task's dev database. That connection is not part of acorn's own data root: it is the user's own
database, reached by core's `DataSourceService` over `pg`, and everything the pane shows is re-derived
from it per call rather than cached in `plugins/database.sqlite`.

`resolveTaskDataUrl` (`packages/node-core/src/server/core/data.ts`) resolves the connection URL for a task
without persisting it, trying in order: a committed `.acorn/config.toml [database].url_script`
(run inside the worktree), then `<worktree>/.env`'s `DATABASE_URL`, then `process.env.DATABASE_URL`.
A committed `url_script` is executable content from the checkout, so resolving it goes through the
same repo-config trust gate as other repo-authored run targets (`server/repoConfigTrust.ts`).
Cloning a repo, or checking out a PR that adds the script, must not be enough to run it. A script the
user or the database authored (`dbUrlFromRepo` false) is the user's own input and is not gated.

Every identifier the pane sends to Postgres (schema, table, and column names) is validated against
the live introspected schema before it is quoted, because identifiers cannot be parameterized the way
values can. Values are always parameterized. Arbitrary SQL typed into the editor runs verbatim,
because it is the user's own database and writes are the point. The loaded plugin builds those
pane-specific statements but executes them only through `ctx.core.data`; it never imports `pg`, opens
a raw socket, or receives the resolved URL.

Core's introspected catalog behind table and column completions is cached per task and invalidated on
connect, on disconnect, and after any statement that is not a plain read or write, as a cheap
approximation for "DDL ran through this pane." A stale completion popup is a small bug, but a
visible one, and someone running a migration in the editor above the results grid is exactly who
would hit it.

AI query generation sends the introspected schema, the repo's free-form schema notes
(`projects.db_schema_notes`), and any saved queries picked as examples to whichever backend the reader
picked, a connected model provider or an installed agent CLI.
The schema text is capped at 80,000 characters (`SCHEMA_CHAR_CAP`) and the notes and examples block
at 16,000 (`GENERATE_MAX_CONTEXT_CHARS`), so the two together stay under the model runtime's
100,000-character system prompt limit.

`plugins/database.sqlite` holds the project-scoped saved queries and the task-scoped scratch document
behind the pane's editor. Saved queries outlive any one task worktree because they are written
against a project's schema rather than a task's checkout. The scratch document is task-scoped because
it holds whatever the reader is working on.

Two of the pane's rows are also **palette commands**, under a Database group
(`docs/command-palette-and-shortcuts.md`). Both are task-scoped, and the reason is the boundary above:
saved queries are project-owned, but every route in this plugin reaches them through the task, because
the task is what core resolves a project from. `/v1/p/database/palette/queries` answers that project's
rows in the pane's own order, narrowed by what was typed and matching the name, the note and the SQL —
the SQL because a table name lives nowhere else. Picking one loads it into the editor through the same
path the pane's picker uses; running it is the reader's next keystroke and never the pick's own effect.

`/v1/p/database/palette/generate` is the Generate SQL modal with every choice already made: the first
connected model connection, that provider's own default model, and no worked examples. It validates
the prompt against the modal's own bound, refuses a task-scoped agent token the way the modal's route
does, loads the live schema, generates, **writes the scratch document, and only then answers**. That
ordering is the contract rather than an implementation detail: the success action opens the pane, whose
editor reads the scratch route on mount, so answering first would race the reader to their own result.
Every failure returns before the write, which is what leaves the prompt in the palette field with the
reason under it. Choosing a connection, a model or examples remains the modal's job.

## External-item read model

`issues`, `issue_resources`, `task_links`, and provider `sync_state` rows are deliberately core-owned
shared read models, not an accidental Linear or Rollbar database. The provider plugins own their
remote adapters and write through `ExternalItemStore`; core task context, linked-item resolution,
storage-footprint reporting, and more than one provider consume the same normalized cache. Moving the
tables into one provider would either duplicate the cache or make core join a plugin database, and
both break the one-database-per-plugin boundary.

The integration disconnect cascade in `packages/node-core/src/server/db/cascade.ts` therefore removes
the core rows keyed to the disconnected integration. It intentionally contains only core tables: no
plugin database has a foreign key into `integrations`, so there is no plugin-specific cascade
declaration to execute. Plugin-local rows are independently retained or pruned by their owning plugin.

## Typed data sources: projections, never second stores

A data source owns no core table merely because dashboards or workflows consume it. It projects the
owner's existing store or provider API through the bounded Node runtime described in
[Typed data sources](./data-sources.md). GitHub, Linear, and Rollbar keep their provider-owned
mirrors and credentials; core tasks read core tables; managed sessions read the agents ledger.
Record identity, freshness, connection scope, and completeness remain explicit in the source
contract. The client has no independent fetch authority or record cache.

## Runs: a merged read, and the trigger for ever making it a table

Three parts of the system model "a thing that started, took time, cost money, and ended", in three
files: `workflow_runs` and `workflow_steps` in `plugins/workflows.sqlite`, agent sessions and their
turn ledger in `plugins/agents.sqlite`, and `schedule_runs` in core. One database file per plugin
means no joins, so nothing could list them together, add up what a task cost, or answer "what is
running on this machine".

The answer is a registry, not a table. A plugin
declares a `GET` route that lists its own runs (`ctx.runs.register({ runs })`); core calls each one
with no client attached, parses the answer, stamps who answered, and merges
(`node-core/server/runs/registry.ts`, `@acorn/protocol/runs.ts`). `GET /v1/core/runs` is the merged
read and Settings → Run history draws it. No migration, no ownership move, and neither producer knows the
other exists. A task-confined caller uses this merged route and receives only its task's rows. The
workflow source route is a node-internal aggregation seam and rejects a direct task-confined read.

What the shape costs, stated plainly: the row is display-shaped — id, title, one of five statuses,
started, ended, task, cost, one line of detail — and an owner with a richer vocabulary maps into it
and keeps its own for its own surfaces. Cost is optional, and agent sessions do not report one,
because their cost lives per turn inside `usage_json` and parsing every turn to draw a list is the
wrong trade. A source that cannot answer costs its own rows and nobody else's; the response names it,
so a short list reads as short rather than as complete.

**When to build the core table instead.** Written down here so it is recognized rather than re-argued
when someone reaches for it: **when something outside the owning plugin must cancel a run, or charge
it against a budget shared with another plugin's runs.** Both need a row a stranger can write to and a
lock a stranger can take, and neither is expressible as a merged read. Nothing today needs either:
cancelling happens on the owner's own surface, and every ceiling that exists (`MAX_CONCURRENT_HEADLESS`,
`MAX_FAN_OUT_TASKS`) is one plugin's over its own work.

The cross-plugin resource governor belongs beside that table when it arrives, modeled on
`ProviderRequestScheduler`'s two-level shape — and never before this registry has proved the
vocabulary, because a governor over a read model can only advise.

## Ownership rules

Provider data is a disposable read model. GitHub, Linear, and Rollbar remain the upstream source of
truth; refresh can delete and rebuild local rows. Application-owned state survives provider refreshes.

Machine-scoped entities include workspaces, tasks, notes, memories, terminal metadata, worktrees, and
project configuration. Identity-scoped records use the node's boot-bound opaque owner id. Provider
account changes must not alter the owner's settings, integrations, or saved requests.

The shared `blobs/` directory is content-addressed. It stores immutable patch bodies and their diff
document descriptors by patch digest, and file bodies, attachments, and artifacts by SHA. Plugin rows may retain a blob until the owning record is deleted.
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
plugin migration directories beside the bundled Node artifact, except for a loaded plugin, whose
chain is staged inside its own package by `apps/node/scripts/build-plugin.mjs` and read from there,
because the package is the only copy the loader looks at. http is the one plugin on that path.

Each of the 11 table-owning chains starts with one initial migration. The previous SQL histories and
their one-way data transformations are not an upgrade path into this baseline. Use the recoverable
reset in [local development](./local-development.md) before starting a Node with an older data root.
The reset preserves a private recovery copy and never removes repositories or worktrees.

Native SQLite access is centralized, and both plugin tiers reach it through `ctx.storage.open()`.
Loaded storage connections install a native authorization policy before executing migration history
or plugin SQL. It refuses cross-file attachment and export, limits PRAGMAs and virtual table modules,
and keeps temporary SQL storage in memory. The connection wrapper exposes no policy setter. The
loader's host fallback applies the same policy and refuses arbitrary backup destinations. A runtime
without SQLite authorization support refuses loaded storage rather than opening an unconfined
connection; the bundled Node 24 runtime supports it. See
[Node plugin storage security](./security/node-plugin-security.md#storage) for the boundary and
compatibility contract.
The filename is bound to the plugin id. A loaded plugin opens that handle inside its isolated worker,
whose filesystem grant names only that database, WAL, and SHM paths; a built-in opens it in the host.
Only the source of the chain differs: a loaded plugin's manifest names a directory confined to its
package, and a built-in declares `migrationsModule: import.meta.url` on its `NodePlugin` so the host
walks from there.
`packages/node-core/src/server/plugins/migrations.ts` covers all three runtime layouts.

A built-in's chain lives in one of three places depending on how the node was run: a source checkout
(`plugins/<name>/migrations/`), a built desktop app before packaging
(`apps/desktop/out/migrations/<name>/`, beside core's own chain at `out/migrations/`), or a packaged app
(`<resources>/migrations/<name>/`). `pluginMigrationsFolder` resolves this by walking up from the
plugin's own module URL, never from node-core's, so a plugin can never find node-core's chain by
proximity and adopt the wrong schema. At each level it checks the plugin-scoped candidate
(`migrations/<plugin>/`) before the bare `migrations/` directory, because the built and packaged
layouts place core's chain and a plugin's chain side by side. The walk never crosses the plugin's own
package root, so a missing chain fails rather than silently adopting an ancestor's DDL. A loaded
plugin skips the walk entirely: its manifest names the directory, already confined to its package,
and `pluginMigrationsChain` only validates that a Drizzle chain exists there.

The host opens a built-in's file lazily on first use. For a loaded plugin with migrations, the loader
privately prepares the three exact SQLite paths before starting the worker so it can grant files
without granting the shared `plugins/` directory; the worker still opens the database lazily on first
use. Preparation refuses a linked `plugins/` directory and checks that each state file is regular
before opening it. POSIX hosts also use no-follow and nonblocking flags. Preparation checks the
opened descriptor and, on POSIX hosts, sets its private mode through that descriptor. Windows
preparation retains the directory and regular-file checks but relies on the data root's access
control list for privacy; POSIX mode bits do not restrict Windows access.
Worker and host native opens check existing database, WAL, and SHM files before handing their paths
to SQLite; absent sidecars remain valid. Exact grants include both lexical and canonical spellings
for data-root aliases. These checks do not remove the path replacement race before SQLite opens.
Each tier holds one handle and closes it immediately after that plugin's `dispose()`, so a plugin's
dispose is about the resources the plugin itself owns and a plugin whose only resource was the database
needs no dispose at all. Both tiers use `CoreServices` for core-owned operations. `apps/node/test/integration/plugins/httpLoaded.test.ts` covers what
happens when a loaded plugin's chain grows between versions, where the update applies at the next
boot against a database that already has rows, along with a broken chain failing contained and
uninstall-without-purge keeping the file.

Before applying anything, core and plugin database paths compare every row already recorded in
`__drizzle_migrations` with the corresponding journal entry: its timestamp, its position, and the
SHA-256 of the SQL file. Editing applied SQL, reordering the journal, or removing an applied entry
fails with a recoverable-reset instruction. Existing tables without an applied history fail the same
way. The comparison happens on the same handle before Drizzle migrates, so the database is preserved
unchanged. Once on this baseline, ordinary future migrations still append to each owner's chain.

Drizzle-kit cannot model a virtual table, so a plugin that wants FTS5 search
(`plugins/agents.sqlite`'s `agent_events_fts`) writes the
`CREATE VIRTUAL TABLE` and its triggers by hand into its migration SQL instead of declaring them in
the Drizzle schema. The schema file still declares the backing columns the triggers read, so renaming
one there is a signal to update the migration, but the thing that actually catches a missed rename is
a schema-drift test that opens the migrated database and checks the virtual table's shape against the
schema, because the trigger body is plain SQL text with no type checker over it
(`plugins/agents/src/server/ftsSchema.test.ts` is the pattern to copy).

## Backup and import

`POST /v1/core/backup` snapshots core and plugin SQLite databases with SQLite's online-backup API.
`GET` on the same route returns the suggested destination path. The archive excludes blobs and
worktrees and scrubs credentials, device rows, and other token material. Restore is a manual
operation into a fresh, initialized data root. Before copying archive members, run
`pnpm backup:verify <backup.tar.gz> <target-root>`. It reads the archive manifest without extracting
files and refuses a missing or different `acorn-1` baseline on either the backup or target root.
The archive itself carries `baseline: "acorn-1"` beside its format version.

Archive output is precreated at mode `0600` inside a private `0700` sibling directory on the
chosen destination's filesystem. The archive is renamed over the chosen destination only after
successful completion, so replacement also repairs a permissive prior archive. A failed or
interrupted archive preserves the prior backup and removes partial output. No global umask is
changed. These are POSIX permissions; Windows operators must restrict the destination directory
with an NTFS ACL.

The archive holds `core.sqlite` and every `plugins/*.sqlite`: the workspace and task model, repo
configuration, agent transcripts, notes, memories, and the HTTP client's saved requests. Secrets are
blanked rather than removed, so an `integrations` row survives with empty `encrypted_credentials`. A
restored node still shows that a connection existed and needs re-entering, and a deleted row would
have silently lost the workspace links that point at it. Device rows are deleted outright, because a
device row is a credential's public half and a restored node must re-pair rather than show a list of
machines that no longer have access. Blobs and worktrees are excluded for size rather than risk: the
blob cache is routinely the largest thing in a data root and is refetchable from the provider, and a
worktree is a git checkout whose restore is `git clone`.

There is no runtime configuration importer, and no upgrade path from a pre-baseline database. A
backup remains the supported way to preserve a source before an upgrade. Executable configuration
recovered without a matching `config_acks` row must be reviewed again.

## Retention

Both boot-time sweeps moved onto the scheduler. See [the schedules doc](./schedules.md). The old
argument, that a node nobody restarts is also one nobody accumulates a backlog on, had it backwards:
a node left running for a month pruned nothing at all. The idempotency sweep followed the audit prune
for the same reason. Expired replay rows already read as absent, so it was always space rather than
correctness, and space is what a long-lived node accumulates.

- Idempotency rows: 24 hours, reclaimed by the `core:idempotency-sweep` schedule, daily at 03:05
  node-local.
- Audit rows: 90 days, pruned by the `core:audit-prune` schedule, daily at 03:20 node-local.
- Terminal replay: bounded per session.
- Agent tool calls and file changes: a newer update supersedes the rows before it, and those are
  deleted in the same transaction, so a call keeps two rows
  ([client surfaces](./managed-agents/client-surfaces.md) § The transcript store). Rows stored before
  that are compacted once, in the background after boot. Every other agent event is kept for the life
  of its session, unless its task is archived and the owner set a limit (next item).
- Agent history of archived tasks: kept forever unless the owner picks 30 days, 90 days, or 1 year
  under **Keep agent history for archived tasks** in Settings > Agents > Harnesses and defaults. Past
  the limit, the `agents:archived-history-prune` schedule, daily at 03:50 node-local, deletes each session's events and
  their search rows, turns, requests, attachment references, and artifacts, and the attachment and
  artifact files nothing else uses. The session row stays with a note in place of its transcript. The
  archive date comes from core's `tasks.archived_at`, read through `ctx.core.tasks.archivedBefore`, and a
  restored task has none. The removed history is gone from archive search and from the restored task,
  and nothing brings it back. The owner has to choose this, because both of those are real costs
  ([managed-agents.md § Operations and failure](./managed-agents.md#operations-and-failure) has what
  is kept, what is skipped, and how the work is split into small steps).
- Logs: size and age policy owned by the Node runtime.
- Plugin databases: retained while a plugin is disabled, and deletion is explicit.
- Provider mirrors and blobs: refetchable and prunable according to their cache policies.

Deleting rows does not shrink a database file. The freed pages go on SQLite's free list and new rows
reuse them, so the file stops growing until they are used up. No database here uses auto-vacuum, and
nothing runs a VACUUM. Turning on incremental auto-vacuum takes a full VACUUM first, and a full VACUUM
rewrites the whole file under an exclusive lock, which on the synchronous driver stops the node for its
duration. On a copy of the 1.3 GB agents database, after its first compaction, it took 11 seconds and
brought the file to 852 MB. SQLite also allows a VACUUM to renumber the rowids of a table whose key
is text, and the agents search index finds its rows by rowid
([client surfaces](./managed-agents/client-surfaces.md) § Transcript search). To get the space back,
stop the node and run `VACUUM` on the file.

### What the node reports

Settings > Machines > Storage and memory shows the numbers for the node the settings header's node
switcher names. `GET /v1/core/storage`, device
only, answers `NodeStorageReport` (`@acorn/protocol/api.ts`): the node process's resident memory, the
core database, each plugin database, and the blob cache. A database's size includes its `-wal` and
`-shm` files, because the WAL can be as large as the database between checkpoints. A plugin's
package folder under `plugins/` is not a database and is not counted. Worktrees are left out, because
walking them costs more than the answer is worth. Every size comes from `stat`, and the disk half is
measured at most every 30 seconds, so a page asking every five seconds does not walk the blob cache
each time (`server/storage/footprint.ts`). The same measurement feeds the one line the node logs at
startup. A plugin adds its own numbers to the page through the `core:storage` point; the agents
plugin reports its processes and its attachment and artifact folders
([managed-agents.md § Operations and failure](./managed-agents.md#operations-and-failure)). The page
reports and does not delete: nothing on it prunes a database or the blob cache.

## Task script persistence

Core's `tasks` row carries `script_generation` and `script_history_known`. The migration marks
existing tasks as having unknown history; new tasks start with known, unrequested history.
Core's `task_script_attempts` table holds attempt identity, task, phase, generation, lifecycle
state/reason, nullable terminal link and exit code, timestamps, and a bounded UTF-8 output tail
with availability/truncation flags. It does not store script bodies. The synchronous service
commits process evidence before task invalidations and fences updates by identity and generation.

Attempts survive archive and terminal deletion. Deleting a project deletes its tasks and their
attempts; retained logs therefore follow task lifetime. Status exposes at most 50 summaries,
while explicit attempt selection can read older retained rows. Output is bounded per attempt,
not a general terminal event ledger. See [durable results](./workspaces-and-tasks.md#durable-task-script-results).

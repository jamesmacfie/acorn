# Plugin databases

This page covers the SQLite file each table-owning plugin keeps: what's in each one, how a plugin opens
its handle, and the rules that keep plugin databases independent. Read it before you add a plugin
table. It's part of the [data layer](../data-layer.md).

## Files

These plugins own SQLite files under `<data-root>/plugins/` and a migration chain in their package:

| File | Main data |
| --- | --- |
| `agents.sqlite` | Managed sessions, turns, the event ledger, operation records, the delegation spawn ledger, requests, attachments, artifacts, webhooks, MCP servers, and full-text search |
| `browser.sqlite` | Browser captures and screenshot bytes |
| `changes.sqlite` | Review notes and plugin-local change state |
| `database.sqlite` | Project-scoped saved SQL queries and the per-task scratch document. A loaded plugin |
| `github.sqlite` | The repository and pull request mirror, PR children in provider order, file patch state and digest, freshness and file completeness, viewed files, and pinned repositories |
| `http.sqlite` | Project-scoped requests and variables, with encrypted request fields. A loaded plugin |
| `terminal.sqlite` | Terminal session metadata. PTY output isn't stored here |
| `workflows.sqlite` | Drafts and immutable revisions, publication journals, repository-file drafts and write journals, runs, steps, gates, dispatches, schedule bindings and occurrences, processing scopes, selections, record states, attempts, and committed source boundaries |

Docker, editor, Linear, Rollbar, model providers, preview, and onboarding use core services or provider
registries and keep no file. Notes keep no database either: task, workspace, and global notes are
markdown files under `<data-root>/notes`, written by `plugins/notes/src/server/notes.ts`. Memories are
markdown files under `~/.acorn/memory`, or `<ACORN_DATA_DIR>/memory` when the Node has an explicit data
root ([notes and memory](../notes-and-memory.md)).

### The database plugin

The database plugin's pane talks to the user's own Postgres database, which isn't part of the data root.
Core resolves the task's URL without storing it, from a `db_url_script` (gated by config trust when the
repository authored it), then the worktree's `.env`, then the Node's `DATABASE_URL`. The pane shows
what it reads from that database live, and keeps only saved queries and the scratch document in
`database.sqlite`. AI query generation sends the introspected schema, capped at 80,000 characters by
`SCHEMA_CHAR_CAP`, and the schema notes and example queries, capped at 16,000 by
`GENERATE_MAX_CONTEXT_CHARS`, so together they stay under the model runtime's 100,000-character system
prompt limit. [Database plugin](../database.md) owns the pane.

## Opening a handle

A plugin declares that it owns tables in one line: `migrationsModule: import.meta.url` on a compiled
`NodePlugin`, or `migrations` in a loaded plugin's manifest. It gets its handle from
`ctx.storage.open()`, and never names the file, the data root, or the chain's directory, or closes the
handle. The filename is bound to the plugin id. A loaded plugin opens the handle inside its worker,
whose filesystem grant names only that database, WAL, and SHM. A built-in opens it in the host.
[Migrations](./migrations.md) covers where each chain is found.

Every route a table-owning plugin registers is built by a factory that closes over the handle
`ctx.storage.open()` returned, never a module-level router that reads a handle off the request. The
request environment carries no plugin database handles, so a request can't reach one before that
plugin's migrations ran. Two `startServiceRuntime` instances in one process, as in a test, each build
routers over their own handle.

Each tier holds one handle and closes it right after the plugin's `dispose()`, so a plugin whose only
resource was its database needs no `dispose`.

## Independence

Plugin databases have independent migration chains. There are no cross-database foreign keys, `ATTACH`
queries, or transactions spanning files. A cross-plugin workflow uses IDs, capabilities, events, and
durable operation state rather than joining tables. A plugin's file is kept while the plugin is
disabled, and deletion is explicit.

Some tables carry that rule across databases:

- `agent_spawns` is the agents plugin's authority record for delegation, and its recovery record. It
  stores root and direct-owner IDs, stable child task and session IDs, depth, isolation, provisioning
  state, and an owner-scoped idempotency key. It doesn't mirror the child's runtime state. A worktree
  spawn crosses the agents and core databases through stable IDs and replayable operations.
- `workflow_runs` stores explicit root run, parent run, parent step, and depth, plus the resolved
  definition graph, effective authority, absolute deadline, and optional invocation identity used for
  recovery. Run reads project them into task links without exposing the frozen authority. Every run has
  a non-null `root_run_id`, and a root run points to itself.
- `workflow_dispatches` is the replay ledger for child workflow tasks. A unique caller key and payload
  fingerprint reserve stable task and run IDs before either cross-database effect. A row moves through
  `reserved`, `task-created`, `run-started`, `cancelling`, and `terminal`, and reconciliation repeats
  only the missing step.
- `workflow_schedules` stores the approved project, published graph, typed inputs, limits, timezone,
  generation, processing epoch, activation state, and first-check choice. Core's `user_schedules` row
  stores only the cadence and a `{ scheduleId }` target. `workflow_schedule_occurrences` reserves stable
  root task and run IDs before either effect, and unique request and generation keys make manual,
  catch-up, and timer fires converge. Deleting the core row leaves a workflow-owned tombstone and its
  history.
- `workflow_turn_admissions` records each provider turn before dispatch and settles it once with cost
  and token usage. A reserved row still counts against the allowance after a crash, because the provider
  may have accepted work before the usage event was lost.

## The GitHub mirror

The mirror replaces a pull request's detail, and separately its files, in one `db.batch` each, together
with that resource's `sync_state` row. Every PR child table has a `position` column, the row's
zero-based place in GitHub's order. `review_threads` counts across every comment of every thread, so
one ordering gives both thread and comment order. `pr_files` holds `patch_state` and `patch_key`, the
digest the patch body is stored under. `sync_state` has four nullable columns, `incomplete_cause`,
`received`, `reported_total`, and `upstream_limit`, that only a files resource sets, when GitHub's
3,000-file ceiling cut the list.

The diff viewer's documents are generated data, not tables ([the document](../diff-rendering/document.md#the-document)).
A pull request's segment descriptors are a blob per patch, keyed by the patch digest and the
diff-document version and written beside the patch body. A new segmenter version reads a different key
and cuts again. Segment rows are cut from the patch body on request and never stored. A working tree's
documents live in the Changes plugin's memory and are lost on restart.

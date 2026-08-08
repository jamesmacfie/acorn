# Data layer

The Node is the only owner of authoritative application data. SQLite uses `better-sqlite3` and
Drizzle, with one core database and one database for each table-owning plugin. The owning package
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

`node.json` stores the stable Node ID, certificate metadata, and preferred last-bound port. A root
  is opened by `openDataRoot`, which creates the identity, takes the lock, and refuses an incompatible
  root. Database upgrades are applied by the owning migration chain; backups are explicit archives and
  never mutate their source data.

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

Core table definitions are in `packages/node-core/src/server/db/schema.ts`. `devices` stores only
token hashes. `integrations` stores encrypted provider credentials plus non-secret provider metadata.
`config_acks` stores the exact hash and snapshot of trusted executable repository configuration.

## Plugin databases

These plugins own SQLite files and migrations:

| File | Main data |
| --- | --- |
| `plugins/agents.sqlite` | managed sessions, turns, event ledger, requests, attachments, artifacts, webhooks, FTS |
| `plugins/changes.sqlite` | review notes and plugin-local change state |
| `plugins/database.sqlite` | project-scoped saved SQL queries |
| `plugins/github.sqlite` | repository/PR mirror, PR children, GitHub freshness, viewed files, pinned repos |
| `plugins/http.sqlite` | project-scoped requests/variables, encrypted request fields |
| `plugins/memory.sqlite` | project-scoped derived memory index, proposals, FTS |
| `plugins/notes.sqlite` | task/workspace/global notes and revisions |
| `plugins/terminal.sqlite` | terminal session metadata; PTY output is not persisted there |
| `plugins/workflows.sqlite` | definitions, runs, steps, gates, and trigger state |

Docker, editor, Linear, Rollbar, model providers, preview, onboarding, and the built-in agents
profiles use core services or provider registries without their own database file.

Plugin databases have independent migration chains. There are no cross-database foreign keys,
`ATTACH` queries, or transactions spanning files. A cross-plugin workflow uses IDs, capabilities,
events, and durable operation state rather than joining tables.

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
plugin migration directories beside the bundled Node artifact.

Native SQLite access is centralized. Plugins receive their own migrated plugin handle through the
Node plugin host and use `CoreServices` for core-owned operations.

## Backup and import

`POST /v2/core/backup` snapshots core and plugin SQLite databases with SQLite's online-backup API;
`GET` on the same route returns the suggested destination path.
The archive excludes blobs and worktrees and scrubs credentials, device rows, and other token
material. Restore is a manual operation into a fresh data root.

There is no runtime configuration importer. Legacy data is handled by versioned migrations and their
seeded replay tests; a backup remains the supported way to preserve a source before an upgrade.
Executable configuration recovered without a matching `config_acks` row must be reviewed again.

## Retention

Both sweeps run AT BOOT, not on a timer, and there is no scheduler service. A node that is never
restarted is also one that is never accumulating a backlog worth pruning, and a scheduler for one
range-delete a day is machinery this does not need (`server/audit.ts` states the same). Older design
notes listed a `scheduler` on CoreServices; that was written and deleted, and never shipped.

- idempotency rows: 24 hours, cleaned at boot;
- audit rows: 90 days, pruned at boot;
- terminal replay: bounded per session;
- logs: size/age policy owned by the Node runtime;
- plugin databases: retained while a plugin is disabled; deletion is explicit;
- provider mirrors and blobs: refetchable and prunable according to their cache policies.

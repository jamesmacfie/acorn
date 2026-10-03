# Backup and retention

This page covers how a Node archives its databases, how long it keeps each kind of record, and what it
reports about its own size. Read it before you add data that grows or change what a backup holds.
It's part of the [data layer](../data-layer.md).

## Backup and import

`POST /v1/core/backup` snapshots core and plugin SQLite databases with SQLite's online-backup API, and
`GET` on the same route suggests a destination path. Both are device-only. The archive holds
`core.sqlite` and every `plugins/*.sqlite`: the workspace and task model, repository configuration,
agent transcripts, saved queries, and the HTTP client's saved requests. It carries
`baseline: "acorn-1"` beside its format version.

- **Secrets are blanked, not removed.** An `integrations` row survives with empty
  `encrypted_credentials`, so a restored Node shows that a connection existed and needs entering again.
  A deleted row would lose the workspace links that point at it.
- **Device rows are deleted.** A device row is a credential's public half, so a restored Node must pair
  again rather than list machines that no longer have access.
- **Blobs and worktrees are left out**, for size rather than risk. The blob cache is often the largest
  thing in a root and can be fetched again from the provider, and a worktree is a Git checkout.

Archive output is created at mode `0600` inside a private `0700` sibling directory on the destination's
filesystem, and renamed over the destination only after success, so replacing also repairs a
permissive earlier archive. A failed or interrupted archive keeps the earlier backup and removes partial
output. No global umask changes. These are POSIX modes, so on Windows restrict the destination with an
NTFS ACL.

Restore is a manual step into a fresh, initialized data root. Before copying members, run
`pnpm backup:verify <backup.tar.gz> <target-root>`. It reads the archive manifest without extracting
files, and refuses a missing or different `acorn-1` baseline on either the backup or the target root.
There's no runtime configuration importer and no upgrade path from a pre-baseline database. Executable
configuration restored without a matching `config_acks` row must be reviewed again.

## Retention

Retention runs on the scheduler, not at boot, because a Node left running for a month would otherwise
prune nothing ([schedules](../schedules.md#what-is-registered)). Times are Node-local.

| Data | Kept | Removed by |
| --- | --- | --- |
| Idempotency rows | 24 hours | `core:idempotency-sweep`, daily at 03:05 |
| Audit rows | 90 days | `core:audit-prune`, daily at 03:20 |
| Dashboard measure history | Its own retention | `core:compact-history`, daily at 03:40 |
| Agent history of archived tasks | Forever, or 30 days, 90 days, or one year | `agents:archived-history-prune`, daily at 03:50 |
| Terminal replay | Bounded per session | The terminal plugin |
| Logs | The runtime's size and age policy | The Node runtime |
| Plugin databases | While the plugin is disabled | Explicit deletion only |
| Provider mirrors and blobs | Their cache policies | Refetchable. Nothing prunes the blob cache ([caching](../caching.md#immutable-blob-cache)) |

Agent tool calls and file changes keep two rows each: a newer update replaces the rows before it in the
same transaction ([the transcript store](../managed-agents/transcript-store.md)).
Rows stored before that rule are compacted once, in the background after boot. Every other agent event
is kept for the life of its session.

The owner chooses the archived-history limit under **Keep agent history for archived tasks** in
Settings > Agents > Harnesses and defaults. Past the limit, the prune deletes each session's events and
search rows, turns, requests, attachment references, and artifacts, and the files nothing else uses.
The session row stays, with a note in place of its transcript. The archive date is core's
`tasks.archived_at`, read through `ctx.core.tasks.archivedBefore`, and a restored task has none. The
removed history is gone from archive search and from a restored task, which is why the owner has to
choose it ([operations and failure](../managed-agents/operations.md)).

Deleting rows doesn't shrink a database file. Freed pages go on SQLite's free list for reuse, so the
file stops growing until they're used up. No database here uses auto-vacuum, and nothing runs `VACUUM`.
Turning on incremental auto-vacuum needs a full `VACUUM` first, which rewrites the whole file under an
exclusive lock and stops the Node on the synchronous driver. On a copy of a 1.3 GB agents database it
took 11 seconds and gave 852 MB. `VACUUM` may also renumber the rowids of a text-keyed table, and the
agents search index finds rows by rowid ([transcript search](../managed-agents/transcript-search.md)).
To get the space back, stop the Node and run `VACUUM` on the file.

## What the node reports

Settings > Machines > Storage and memory shows the numbers for the Node the settings header's node
switcher names. `GET /v1/core/storage`, device-only, answers `NodeStorageReport`
(`@acorn/protocol/api.ts`): the Node process's resident memory, the core database, each plugin database,
and the blob cache.

- A database's size includes its `-wal` and `-shm` files, because the WAL can be as large as the
  database between checkpoints.
- A plugin's package folder isn't a database and isn't counted. Worktrees are left out, because walking
  them costs more than the answer is worth.
- Every size comes from `stat`, and the disk half is measured at most every 30 seconds
  (`server/storage/footprint.ts`). The same measurement feeds the line the Node logs at startup.
- A plugin adds its own numbers through the `core:storage` point. The agents plugin reports its
  processes and its attachment and artifact folders.

The page reports and doesn't delete. Nothing on it prunes a database or the blob cache.

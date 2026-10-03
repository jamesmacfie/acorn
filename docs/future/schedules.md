# Schedules not built yet

Date: October 3, 2026. Status: proposals, not started. Moved here from
[schedules.md](../schedules.md), which describes the shipped scheduler.

## Unattended backup

`server/storage/backup.ts` runs only when the backup route is called. A `core:backup` schedule is one
registration away, but it needs a retention policy nobody has asked for. A weekly archive of every
database written forever to one directory is unbounded disk growth. The open question is how many
backups a Node should keep.

## An `agent-run` target

A user schedule target that starts a managed agent session with a prompt. No target kind registers it
in the code. It waits on a headless agent runtime that a schedule could start with no client attached.
Until a kind registers, a row naming it would list inert and never run, like any kind this build
doesn't know.

## Verify before building

- `packages/node-core/src/server/storage/backup.ts` and `routes/security/backup.ts` for the archive
  path and destination handling.
- `packages/node-core/src/server/schedules/index.ts` for how core schedules register.
- `ctx.schedules.registerTarget` in `plugins/workflows/src/node/index.ts` for how a kind registers.

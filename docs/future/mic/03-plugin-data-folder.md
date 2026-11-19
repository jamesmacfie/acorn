# Phase 3: a data folder for each loaded plugin

Date: November 19, 2026. Status: proposed. Depends on nothing.

## Goal

A loaded plugin can ask for one folder on the Node that it may read and write. The voice plugin keeps
its models and engine binaries there. Other plugins can use it for caches.

## The gap

`isolateNodePlugin` in `packages/node-core/src/server/plugins/isolation.ts` gives the worker read
access to its package and write access to its SQLite files, and nothing else. The `files` grant
covers a single regular file named by an environment variable, outside the data root.

A plugin with `exec` can work around this today. A child process sits outside Node's permission
model and can write anywhere. That works, but it makes every download a shell command and leaves
files the host can't see, measure, or remove on uninstall.

## Changes

1. Add `permissions.node.dataFolder: boolean` to the manifest schema in `packages/protocol`.
2. When it's true, create `<dataRoot>/plugin-data/<pluginId>/` before the worker starts, mode `0700`,
   and add it to both `--allow-fs-read` and `--allow-fs-write`. Add both spellings of the path, as
   the database files do, so a symlinked data root still matches.
3. Give the worker its path as `ctx.dataFolder`. Absent when the permission is off.
4. Add a trust prompt line: "Store files in its own folder on this Node". Low risk on its own.
5. On uninstall, delete the folder. On disable, keep it.
6. Show each plugin's folder size on its plugin page in Settings.

## Verify before building

- Whether `plugin-data` clashes with anything under the data root, and whether backups and
  `scripts/verify-backup` should skip it. A 700 MB model doesn't belong in a backup.
- Whether a compiled plugin should get the same folder. Not needed for this plan.
- The package export caps. `@acorn/protocol` and `@acorn/node-core` were at their entry point limits
  in early November 2026. Put new types behind an existing barrel.

## Done when

- A test plugin with `dataFolder: true` writes, reads, and deletes a file in `ctx.dataFolder`.
- The same plugin can't write one level above it.
- A plugin without the permission has no `ctx.dataFolder` and no write grant.
- Uninstall removes the folder.

## Owning pages

Update [permissions](../../plugin-authoring/permissions.md) and
[the node half](../../plugin-authoring/the-node-half.md).

## Checkpoint

Not run.

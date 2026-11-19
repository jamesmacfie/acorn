# Phase 3: a data folder for each loaded plugin

Date: November 19, 2026. Status: built and tested.

`permissions.node.dataFolder` and `ctx.dataFolder` are described in
[permissions](../../plugin-authoring/permissions.md#node-permissions). `isolateNodePlugin` creates
the folder and grants it, and `uninstallPlugin` deletes it. `loader.test.ts` checks that a plugin can
write, read, and delete in its folder but not above it, and that a plugin without the permission gets
neither. `installer.test.ts` checks uninstall.

## Answers found while building

- `plugin-data` clashes with nothing under the data root. Backups copy only `.sqlite` files, so they
  skip it with no change.
- The permission is optional rather than defaulted, like `env` and `files`, so the many test
  fixtures that spell out a full permission block didn't change.
- A compiled plugin doesn't get one. It already runs with the Node's file access.

## What's left

- The plugin page in Settings doesn't show the folder's size yet.

## Checkpoint

Covered by the tests above. Not run by hand in the app.

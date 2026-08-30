# Phase 2: apps

Status: not started. Waits on phase 1.

## Goal

`apps/node/src` has two folders whose names predict their contents: `entries/` for the three build
entries and `composition/` for what both entries share. `apps/desktop/src` loses the empty `app/`
level and its `shell/` folder holds only Tauri bindings. The `mcp` entry belongs to the app that
builds it.

## Why this phase, and why now

The apps are small (8 and 18 source files) and are the composition roots every later phase imports
into. Renaming them first means phases 3 to 5 write their new import paths once. It is also the
cheapest place to practise the move-and-fix-docs loop before node-core's 78 files.

## Scope

### apps/node

1. `git mv src/service src/entries` and `git mv src/service/index.ts` to `entries/service.ts`.
   Move `apps/node/src/server/standalone.ts` to `entries/standalone.ts`.
2. `git mv src/server src/composition`. Move `apps/node/src/service/runtime.ts` and its test into
   `composition/`; it is shared boot code, not an entry.
3. Create `entries/mcp.ts` (new) with the contents of `packages/node-core/src/mcp/main.ts`, importing
   from `@acorn/node-core/mcp/server`. Point `apps/node/vite.config.ts` line 41 at it and delete
   `packages/node-core/src/mcp/main.ts`.
4. Group `test/integration/` per [03-target-layout.md](./03-target-layout.md): `lifecycle/`, `auth/`,
   `pluginSystem/`, `plugins/`. Move `apps/node/test/pluginConfigs.test.ts` into `pluginSystem/`.
   Move `apps/node/test/registerProviders.ts` and `apps/node/test/integration/golden.ts` to
   `test/helpers/`. Rename `test/fixtures/` to `test/__fixtures__/` and fix the comment in
   `packages/node-core/src/main/headless.ts` line 10 to a path that resolves from the repo root.
5. Update `apps/node/vitest.config.ts` include globs. Confirm `vitest list` shows the same test count
   as before the move.
6. Scrub the Electron prose: `apps/node/src/server/standalone.ts` line 1 and
   `apps/node/src/service/runtime.test.ts` lines 51 and 93.

### apps/desktop

1. `git mv src/app/client src/client` and delete `src/app/`. Update `apps/desktop/vite.config.ts`,
   `apps/desktop/index.html`, and `apps/desktop/vitest.config.ts`.
2. Create `src/helper/` and move `apps/desktop/src/shell/helperMain.ts` and
   `apps/desktop/src/shell/helperServer.ts` plus their tests there. Update
   `apps/desktop/vite.helper.config.ts`. The arch rule at `tools/arch/boundaries.test.ts` that
   confines Tauri to `src/shell/` needs no change; the helper never imported Tauri.
3. For each of `App.tsx`, `TaskView.tsx`, `CommandPalette.tsx` in `src/client/`, decide: it stays
   because it wires contributions the composition root owns (write that in the file header), or it
   moves to client-core in phase 5 (add it to that phase's list).
4. Rename `pageContributions.tsx` and `slotContributions.tsx` to `.ts` if they have no JSX; if
   they do, rename `sourceContributions.ts` to match.
5. Rename `apps/desktop/scripts/nodeRuntime.mjs` to `node-runtime.mjs` and fix its callers in
   `apps/desktop/package.json` and the other scripts.

### Docs

Update paths in `docs/shell.md`, `docs/node-distribution.md`, `docs/local-development.md`,
`docs/testing.md`, `docs/mcp.md`, and `docs/architecture-overview.md` (the `src/shell/` sentence
and the composition-root sentences). See [docs-migration.md](./docs-migration.md).

## Out of scope

Changing what either app does. Moving the three desktop components (phase 5). Renaming
`@acorn/desktop-helper` (refused).

## Done when

- `ls apps/node/src` prints `composition entries`.
- `ls apps/desktop/src` prints `client helper shell`.
- `grep -rn "node-core/src/mcp/main" apps` is empty and `packages/node-core/src/mcp/main.ts` is gone.
- `pnpm --filter @acorn/node test` and `pnpm --filter @acorn/desktop test` collect the same counts
  as before, plus the one from phase 0.
- `tools/arch` is green with `service` still in the `side()` list (phase 3 removes it once nothing
  under that name remains).

## Verify before building

- `apps/node/vite.config.ts` line 41 still reaches into `packages/node-core/src/mcp/main.ts`.
- `apps/node/src/service/runtime.ts` still imports `../server/pluginDeps` and `../server/pluginState`.
- `apps/desktop/src/shell/helperServer.ts` still has no `@tauri-apps` import.
- `apps/desktop/src/app/` still has no files of its own.

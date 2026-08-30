# Phase 2: apps

Status: shipped 2026-08-30. Waited on phase 1.

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

1. The old `src/service/index.ts` moved to `entries/service.ts`, and the old
   `src/server/standalone.ts` moved to `entries/standalone.ts`.
2. `src/server/` moved to `src/composition/`, and the old `src/service/runtime.ts` and its test moved
   there too; it is shared boot code, not an entry.
3. `apps/node/src/entries/mcp.ts` (new) holds what `node-core/src/mcp/main.ts` held, importing from
   `@acorn/node-core/mcp/server.ts`. `apps/node/vite.config.ts` points at it and the node-core file is
   deleted.
4. Group `test/integration/` per [03-target-layout.md](./03-target-layout.md): `lifecycle/`, `auth/`,
   `pluginSystem/`, `plugins/`, with `pluginConfigs.test.ts` moved into `pluginSystem/`.
   `registerProviders.ts` and `golden.ts` moved to `test/helpers/`, and `test/fixtures/` moved to
   `test/__fixtures__/`, which is also what the comment in
   `packages/node-core/src/server/headless.ts` line 10 now names, from the repo root.
5. Update `apps/node/vitest.config.ts` include globs. Confirm `vitest list` shows the same test count
   as before the move.
6. Scrub the Electron prose out of the entry, the runtime test, and the two config files.

### apps/desktop

1. `src/app/client` moved to `src/client` and `src/app/` is deleted. Update
   `apps/desktop/vite.config.ts`, `apps/desktop/index.html`, and `apps/desktop/vitest.config.ts`.
2. `helperMain.ts` and `helperServer.ts` plus their tests moved from `src/shell/` to a new
   `src/helper/`. Update `apps/desktop/vite.helper.config.ts`. The arch rule at
   `tools/arch/boundaries.test.ts` that confines Tauri to `src/shell/` needs no change; the helper
   never imported Tauri.
3. For each of `App.tsx`, `TaskView.tsx`, `CommandPalette.tsx` in `src/client/`, decide: it stays
   because it wires contributions the composition root owns (write that in the file header), or it
   moves to client-core in phase 5 (add it to that phase's list).
4. Rename `pageContributions.tsx` and `slotContributions.tsx` to `.ts` if they have no JSX; if
   they do, rename `sourceContributions.ts` to match.
5. The one camelCase script is renamed to `apps/desktop/scripts/node-runtime.mjs`, with its callers in
   the other scripts fixed.

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
- `grep -rn "node-core/src/mcp/main" apps` is empty and the node-core MCP entry is deleted.
- `pnpm --filter @acorn/node test` and `pnpm --filter @acorn/desktop test` collect the same counts
  as before, plus the one from phase 0.
- `tools/arch` is green with `service` still in the `side()` list (phase 3 removes it once nothing
  under that name remains).

## Verified before building

All four held. `apps/node/vite.config.ts` line 41 reached into the node-core MCP entry, the old
`src/service/runtime.ts` imported `../server/pluginDeps` and `../server/pluginState`, the helper
server named no `@tauri-apps` import, and `src/app/` had no files of its own.

## What shipped, and where it differed

Every step landed. Five things are worth knowing before phase 3.

**Step 4 of the node list cost a signature change.** `golden.ts` found its snapshots by its own directory, so moving it
to `test/helpers/` while the snapshots stayed beside their suites broke both readers. `readGolden` and
`writeGolden` now take a full path, and the two call sites pass
`join(import.meta.dirname, '<name>.snapshot.json')`. `apps/desktop/test/client/golden.ts` is untouched:
it still shares a directory with its snapshots, so the duplication the two files always were is now a
duplication with one difference.

**The MCP move left a test pointing across a package line.** `packages/node-core/src/mcp/server.test.ts`
spawns the entry over real stdio, and the entry is in the app now. Rather than move a library test into
an app, the test resolves the app's entry path and keeps its own cwd. The finding this phase closed was
an app reaching into a library for an executable; a test reaching the other way is not the same
problem, but it is worth naming.

**`side()` in `tools/arch/boundaries.test.ts` needed the two new names.** It classifies a file from its
first path segment, and `entries/` and `composition/` fell through to `shared`, which would have
stopped the client/node rule from biting on apps/node at all. Both names are in the node list now, and
`service` stays there until phase 3 as planned.

**`docs/future/structure/01-findings.md` is exempt from the docs path checker now.** It is the dated
record of the tree this programme is moving, so every phase makes more of its citations stale on
purpose — the same argument `docPaths.test.ts` already made for `docs/reviews/`. One line, next to the
existing one. Phase 6 still owns enforcement.

**Step 4 of the desktop list had a false premise.** `pageContributions.tsx` and `slotContributions.tsx`
both hold JSX, so they keep `.tsx` and the convention already covers them. `sourceContributions.ts`
holds none, so renaming it to match would have broken the same rule from the other side. Nothing was
renamed and the stale **Not yet everywhere** line in `docs/conventions.md` is gone.

The three desktop components were decided per file. `App.tsx` and `TaskView.tsx` stay, each with the
reason in its header: they arrange contributions, and the arrangement is what a composition root owns.
`CommandPalette.tsx` moves to client-core in phase 5, beside the `WorkspacePalette.tsx` it mirrors;
[phase-5-client-core.md](./phase-5-client-core.md) carries the detail.

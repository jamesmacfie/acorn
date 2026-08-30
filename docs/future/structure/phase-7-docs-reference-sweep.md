# Phase 7: docs reference sweep

Status: not started. Waits on phase 6. This is the final phase.

## Goal

Every path and every relative link in `docs/` and `docs/future/` points at the tree that exists after
phase 5. The two unstarted programmes (`docs/future/terminal/`, `docs/future/client-plugins/`) are
written against the new tree. `docs/architecture-overview.md` describes the final package
boundaries. This folder is retired.

## Why this phase, and why now

Phases 1 to 6 each fixed the docs they touched, but the checker excuses extension-less paths and
phrases like "the `main/` half", and a rename in phase 3 can invalidate a sentence phase 1 wrote.
One pass at the end, against the finished tree, is the only way to be sure. It is also the phase
the owner named as required: the next work lives in `docs/future`, and it has to start from docs
that are right.

## Scope

### Step 1: the checker

Run `pnpm --filter @acorn/arch-tests test` and fix every `docPaths` failure. With phase 6's root
walk and retired-directory denylist, this catches the rooted paths with extensions and the moved
directory names.

### Step 2: the grep

For each moved or renamed thing, grep `docs/` and rewrite every hit that is not on a line already
marking it as gone. The list, from this programme:

| Retired | Replaced by |
| --- | --- |
| `src/main/` in any package or plugin | `src/server/` (plugins, node-core), `src/` (desktop-helper) |
| `apps/node/src/server/` | `apps/node/src/composition/` |
| `apps/node/src/service/` | `apps/node/src/entries/` |
| `apps/desktop/src/app/client/` | `apps/desktop/src/client/` |
| `apps/desktop/src/shell/helper*` | `apps/desktop/src/helper/` |
| `packages/node-core/src/mcp/main.ts` | `apps/node/src/entries/mcp.ts` (new) |
| `packages/node-core/src/main/core/*/` subfolders | `src/server/core/<name>.ts` |
| `packages/node-core/src/server/plugin/` | `src/server/pluginHost/` |
| `packages/desktop-helper/src/main/` | `packages/desktop-helper/src/<group>/` |
| `client-core/src/ui/` | `client-core/src/kit/` |
| `client-core/src/registries/` | `client-core/src/host/registries/<kind>/` |
| `client-core/src/plugins/` | `client-core/src/host/{frames,chrome,tree,annotations,trust}/` |
| `client-core/src/lib/` | `client-core/src/kit/lib/` |
| `client-core/src/{platform,persistence,styles,highlight,node}/` | `client-core/src/infra/...` |
| every other client-core feature folder | `client-core/src/features/...` |
| `packages/protocol/src/plugin*.ts` | `packages/protocol/src/plugin/*.ts` |
| `packages/plugin-api/src/{node,client,testkit}/index.ts` | bare files |
| `./main/index.ts` subpath | gone |
| `docs/pg.md`, `docs/terminal-and-agents.md`, `docs/state.md`, `docs/release-notes-vnext.md` | phase 1 names |
| `docs/third-party/` | `docs/loaded-plugin-migration.md`, `docs/editor-monaco.md` (new) |
| `docs/plugin-map.html`, `plans/`, `docs/next-review.md` | gone |
| `frame/` as a plugin folder | `tree/` |

Expected volume from the 2026-08-30 survey: about 170 `client-core/src` citations, 19 distinct
`node-core/src/main/*` paths, six `plugins/*/src/main/` paths, two `apps/node/src/*` paths, plus
`docs/future/terminal/*`, `docs/future/client-plugins/*`, `docs/future/compiled-tier.md`, and
`docs/future/split.md`, which cite client-core and plugin internals heavily.

### Step 3: the prose

A path can resolve and the sentence around it still be wrong. Read, in full, the sections the
programme changed most: `docs/architecture-overview.md` sections "Package boundaries" and
"Documentation map"; `docs/plugins.md` sections on the canonical shape, the client half, and the
tree contract; `docs/frontend.md` wherever it describes client-core's folders; `docs/shell.md`
sections on the helper and the bridge; `docs/testing.md` on where tests live;
`docs/plugin-authoring.md` section "The manifest" and the scaffolder's output (the scaffolder in
`packages/create-acorn-plugin/index.mjs` emits a folder layout; it must emit the new one, which is
a code change this phase is allowed because it is the layout).

### Step 4: docs/future

- `docs/future/terminal/` and `docs/future/client-plugins/` name client-core and plugin paths as
  hints. Update the hints and their `docs-migration.md` tables.
- `docs/future/compiled-tier.md` and `docs/future/split.md` describe plugin shapes; rewrite against
  the seven-folder shape.
- `docs/future/README.md`: move `structure/` from the programmes table to the retired-folders
  paragraph, saying where each behaviour went: `docs/conventions.md` (new) owns the naming rules,
  `docs/plugins.md` owns the plugin shape, `docs/architecture-overview.md` owns the package
  boundaries, `docs/README.md` (new) owns the index, `docs/testing.md` owns CI.
- Delete `docs/future/structure/`. `git log --follow` is the record, per the folder rule.

### Step 5: the memory of this programme

Three arch tests and one doc index now hold what this folder held. Nothing else needs to survive.

## Out of scope

Rewriting docs for reasons other than this programme's moves. Re-arguing any refused item.

## Done when

- `pnpm --filter @acorn/arch-tests test` is green.
- For every row in the table above, `grep -rn "<retired>" docs README.md CLAUDE.md` returns only
  lines containing `moved to`, `replaced`, `delete`, or `git history`.
- `ls docs/future/structure` fails.
- `docs/future/README.md` names `structure/` under retired folders.
- The scaffolder's output for a new plugin passes the phase 6 folder-shape rule.

## Verify before building

- Phase 6 is merged: `tools/arch/docPaths.test.ts` walks the root `README.md`.
- The retired-directory denylist exists, or this phase adds it first.
- `packages/create-acorn-plugin/index.mjs` still emits a layout; check which folders.

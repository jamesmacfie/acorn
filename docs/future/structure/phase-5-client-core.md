# Phase 5: client-core

Status: not started. Waits on phase 4.

## Goal

`packages/client-core/src` has four top-level folders, `kit/`, `host/`, `infra/`, `features/`, and
the rule for placing a file fits in one sentence: does a plugin draw with it, does it host plugins,
does it talk to the machine or the node, or is it a product feature. The `@acorn/plugin-api` facade
re-exports from the new paths. The arch rule for the kit has no file-level carve-outs.

## Why this phase, and why now

Client-core is the largest package (516 files) and the one the two unstarted programmes
(`docs/future/terminal/`, `docs/future/client-plugins/`) cite most. It goes after the plugins so the
13 plugin files and 19 app files that deep-import `@acorn/client-core/*` are already in their final
folders and only the specifier changes. Most plugin imports go through `@acorn/plugin-api`, whose 11
entrypoint files are pure re-exports, so the facade absorbs the move for everyone else.

## Scope

One commit per group, `git mv` only, in this order: `infra/` (fewest dependents), `kit/`, `host/`,
`features/`. Each commit also re-points the `packages/plugin-api/src/**` entrypoints that cover the
group, so the tree compiles at every commit.

### infra/

`git mv` `platform/`, `persistence/`, `styles/`, `highlight/`, `node/` into `infra/`. Move
`packages/client-core/src/infra/styles/styles.css` into `infra/styles/`. Move `queries.ts` and `mutations.ts` from
the root into `infra/queries/`. Rename `packages/client-core/src/infra/highlight/messages.ts` to
`messages.ts`. The `window.acorn` rule in `tools/arch/boundaries.test.ts` (around line 556) names
`client-core/src/infra/platform/`; update it.

### kit/

`git mv ui/ kit/`, then inside: `kit/components/` for the `.tsx` files, `kit/tokens/` for today's
`ui/kit/`, `kit/lib/` for the 15 utility `.ts` files plus everything from `lib/`, `kit/diff/` for
`ui/diff/`. Delete `lib/`. `packages/client-core/src/kit/components/primitives.tsx` (1,436 lines) splits by
component family if the split is mechanical; otherwise it moves whole and the split is filed.

Re-point `packages/plugin-api/src/ui/index.ts`, `ui/host.ts`, `ui/tokens.ts`, `ui/diff.ts`,
`ui/editor.ts`, `ui/sdk.ts`, `ui/tree.ts`. Run `packages/plugin-api/src/surface.test.ts`; the
snapshot must not change, because nothing was added or removed.

Rewrite the arch rule "client-core ui/ is pure presentation" (around line 629) as: `kit/` imports
only `kit/` and `infra/highlight/`. The carve-outs for `keys/`, `palette/model.ts`, and
`registries/registry.ts` go away because the components that needed them move to `host/` in the
next commit. If a kit component still needs one, that component is not kit; move it.

### host/

`git mv` `registries/`, `plugins/frames/`, `plugins/chrome/`, `plugins/tree/`,
`plugins/annotations/`, `layouts/`, `keys/`, `palette/` into `host/`. The root files of `plugins/`
(approval, bundles, trust) go to `host/trust/`. Subdivide `host/registries/` (60 files) by what is
registered: `extensionPoints/`, `panes/`, `sources/`, `palette/`, `rail/`, `commands/`. Move
`packages/client-core/src/registries/ProviderHtml.tsx`, `RefPanelBox.tsx`, `RefPanelTaskLink.tsx`
to `host/components/`. Move the three misplaced tests
(`packages/client-core/src/plugins/tree/remoteSolid.test.tsx`, `compiledSlot.test.tsx`,
`twoPaths.test.tsx`) beside their subjects in `host/frames/`. Move `tasks/taskAnnotations.ts` and
`diff/annotationKey.ts` into `host/annotations/` if they are host concerns; leave them if they are
feature-local. Resolve the duplicate basenames: `registries/railMarkers.ts` versus
`tabs/railMarkers.ts`, `registries/sources.ts` versus `tabs/sources.ts`; one of each pair renames to
say what differs.

Re-point `packages/plugin-api/src/client/index.ts`.

### features/

`git mv` `agent/`, `dashboards/`, `diff/`, `editor/`, `integrations/`, `notifications/`, `tabs/`,
`tasks/`, `workspaces/`, `settings/`, `projects/` into `features/`. Fold `configTrust/` and
`modelProviders/` into `features/settings/`. Move `packages/client-core/src/AccountMenu.tsx` into
`features/settings/` under the name its header says it should have. Fix the two cross-folder CSS
imports (`settings/NodesSettings.tsx` importing `../node/nodes.css`,
`packages/client-core/src/plugins/frames/ExtendedPane.tsx` importing `../chrome/extension-points.css`) by moving the
stylesheet to the importer's folder or the importer to the stylesheet's. Rename
`workspaces/useActiveWorkspaceId.ts` to `activeWorkspaceId.ts` with a `create*` export. Rename
`createTaskPath` to `taskPath`.

The seven three-line re-export shims in `dashboards/` (`chart.ts`, `compose.ts`, `format.ts`,
`layout.ts`, `mapping.ts`, `model.ts`, `shaping.ts`) are documented in `docs/dashboards.md`. Either
keep them and say so in a folder comment, or import `@acorn/dashboards-core` directly from the
consumers and delete them. Pick the second unless the import count is over 40.

### Deletions

Delete `packages/client-core/src/Acorn.tsx` and its `Acorn` export from
`packages/plugin-api/src/ui/host.ts` (already marked prune candidate). Confirm
`plugins/github` no longer mounts it; if it does, that is a github change in the same commit.

### The three desktop components

Phase 2 kept `App.tsx` and `TaskView.tsx` in `apps/desktop/src/client/`, and each carries the reason
in its header: they arrange contributions, and the arrangement is the composition root's.

`CommandPalette.tsx` moves. It is registry-driven with nothing desktop-specific in it, and its
sibling `WorkspacePalette.tsx` already sits in client-core's `palette/`; the two overlays being in
different packages is the inconsistency, not the move. It lands in `host/palette/`, beside the
overlay machinery it already imports, and `apps/desktop/src/client/slotContributions.tsx` lazy-imports
it from there. `apps/desktop/test/client/parity.test.ts` reads `App.tsx` and `TaskView.tsx` by
relative path and does not name the palette, so it needs no change.

### The shared packages

- `packages/protocol/src/plugin/` (new) for `pluginContract.ts`, `pluginBridge.ts`,
  `pluginState.ts`, `pluginGrants.ts`, `pluginApiVersion.ts`. Update the five lines in
  `packages/protocol/package.json`; the arch test checks every declared target exists.
- `packages/plugin-api`: rename `src/node/index.ts` to `src/node.ts`, `src/client/index.ts` to
  `src/client.ts`, `src/testkit/index.ts` to `src/testkit.ts`; `src/testkit/client.ts` stays. Update
  `packages/plugin-api/package.json` and `packages/plugin-api/src/entrypoints.test.ts`.
- The 62-name component list: make `packages/plugin-sdk/src/remote/solid.ts` and
  `packages/plugin-api/src/ui/tree.ts` both `export *` from the one host module, with
  `packages/plugin-sdk/src/contract.test.ts` asserting the published `.d.ts` still matches. If
  `export *` is refused by the bundle-size or type-surface reasons the file headers give, keep one
  list and generate the other two as a snapshot the test writes.

### Docs

`docs/frontend.md`, `docs/ui-design.md`, `docs/panes.md`, `docs/command-palette-and-shortcuts.md`,
`docs/plugins.md`, `docs/state-ownership.md` (new), `docs/dashboards.md`, `docs/architecture-overview.md`
cite about 170 `client-core/src/*` paths. The path checker lists the ones with extensions; the
extension-less folder citations (`client-core/src/kit/`, `client-core/src/registries/`,
`client-core/src/plugins/`, `client-core/src/kit/lib/`) need a grep. Fix them here; phase 7 confirms.

## Out of scope

Closing client-core's `./*` export. Changing any component's behaviour. The `dashboards-core`
package (already clean). `create-acorn-plugin`'s embedded bridge copy (deliberate, commented).

## Done when

- `ls packages/client-core/src` prints `features host infra kit` plus the vitest and tsconfig files.
- `packages/plugin-api/src/surface.snapshot.txt` is unchanged except for the `Acorn` removal.
- The kit purity rule in `tools/arch/boundaries.test.ts` has zero file-level carve-outs.
- No folder under `packages/client-core/src` has more than 30 direct files.
- No two files in the package share a basename across folders except `index.ts` and tests.
- `pnpm lint`, `pnpm test`, and `tools/arch` are green.

## Verify before building

- The folder table in [01-findings.md](./01-findings.md) still matches `ls packages/client-core/src`.
- `packages/plugin-api/src/ui/host.ts` still exports `Acorn` and still comments on the three
  registry components.
- `grep -rn "@acorn/client-core/" plugins --include=*.ts --include=*.tsx -l | wc -l` is still about 13.
- `packages/protocol/package.json` still lists `./pluginContract.ts` at the top level.

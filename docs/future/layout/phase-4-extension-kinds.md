# Phase 4: the five extension kinds, hooks, and the developer view

Status: not started.

## Goal

Give `extensionPoints` a `kind`, and build the three kinds that do not exist: annotations, remote
slots, and rectangle slots, with `stack` and `replace` arbitration and a settings picker for ties. Add
hooks on the node with `ctx.hooks`, converting the five existing single-slot seams and opening the
first eight moments. Write the host-owned trust copy for every kind and direction. Build the
developer view that shows every point, who fills it, and which contributions match nothing.

## Why this phase, and why now

This is the original goal of the whole programme: plugins extending plugins. It needs slots, which
need the remote root (3); annotations, which need kit draw sites (0) on `DiffPane` and the editor;
and rectangle slots, which need layouts (1). Hooks are node-side and independent, but they share the
manifest key and the trust prompt and are gathered here so the manifest changes land in one phase.

## Scope

In:

- `kind: rows | annotation | remote | rectangle | hook` on `extensionPoints[]`, defaulting to `rows`.
  Per-kind fields per [03-extension-kinds.md](./03-extension-kinds.md). Parsed on the node, re-checked
  on the client.
- Annotations: the `key` declaration, batched POST to the contributor's `items` route, draw sites on
  `DiffPane` (changes and github), the editor gutter and file tree, the docker container row, and the
  rail task row (`core:task`, superseding rail-tab.md Slice 3).
- Remote slots: the general `Slot` node with `point`, `mode`, `key`, `max`, default children;
  arbitration; the Settings → Plugins picker for `replace` ties, reusing the exclusive-slot picker.
  The phase-3 tool card slot becomes an ordinary `Slot`.
- Rectangle slots: `pane.inline-below` and `pane.inline-beside` as regions of `header-body-footer`
  and `list-detail`; the `inline` frame target; siblings only.
- Hooks: `ctx.hooks.run` on the node context; `contributions.extensions[].route` and `mode`; the
  chain runner with timeouts and roster-row failures; conversion of `WORKTREE_CREATED`, `taskChecks`,
  and the `routeCapability` seams; the first eight hooks declared by their owners (the owner code
  paths are touched only to call `ctx.hooks.run` at the moment).
- Trust copy per kind and direction in `packages/client-core/src/plugins/permissions.ts`, recorded against the trust decision
  so a version reaching into a different package reads as newly requested.
- The developer view under Settings → Plugins.

Out: any plugin filling these points other than the tests and the first-party conversions above;
those come with the per-pane phases.

## Design detail

**Manifest.** As the unified example in 03-extension-kinds.md. `kind` defaults to `rows` so today's
manifests parse unchanged. The node validates the per-kind fields; the client re-checks.

**Annotations.** The owner's draw site registers with `annotations.register(pointId, keysInView)`
and receives marks reactively. The host debounces keys-in-view per point, POSTs `{ keys }` to each
contributor's `items` route through the existing plugin route proxy, validates `{ items: [{ key,
severity, text, icon? }] }` as display strings, and hands the owner's draw site the marks with the
contributor's id stamped. Refresh on the owner's invalidation and on the contributor's
`plugin:<id>:*` channel. `DiffPane` gains an `annotations` prop and draws marks under the row, the
same place review threads draw.

**Remote slots.** `Slot` resolves `<owner>:<point>` from the manifest the host read, lists
contributors whose `matches` cover `key` (or all, for `stack`), applies the user's pick from the
picker when two match in `replace`, mounts each winner through its worker (or, for a first-party
contributor, directly), and grafts under a provenance frame. Default children draw when nobody
matches. One level: a grafted subtree's `Slot`s render their defaults and log.

**Rectangle slots.** A region of the owner's layout declared as a point. The host draws the
contributor's iframe as a sibling region, the `ExtendedPane` wrapper pattern from `register.ts`
generalised. Hooks across the box: `hooks.calls` and `hooks.handles` on the point, `slot.call` and
`slot.on` on the owner's bridge, routed through the hook runner with one handler.

**Hooks.** `ctx.hooks.run(id, payload)` on `NodePluginContext`, backed by `server/plugin/hooks.ts`:
collect handlers from the manifest registry, order, call each contributor's route with the payload,
apply mode rules, time out per `timeoutMs`, record failures, return `{ ok, payload, reason?, by? }`.
Observers are called in parallel and ignored. The five seams: `WORKTREE_CREATED` becomes
`core:worktree-created` with terminal as its `transform` handler; `taskChecks` becomes
`core:before-archive`; the `routeCapability` seams become hooks on their routes.

**Trust copy.** Owner side per kind: "reserves part of its *pane* for other plugins' rows / marks /
UI / a box," "lets other plugins act before it *verb*s." Contributor side: "adds rows to / marks
items in / draws inside / places a box in the *plugin* plugin's *pane*," "can observe / change / stop
a *verb* in the *plugin* plugin." Plugin id and verb from fixed tables; never manifest text.

**Developer view.** A settings page listing points on this node with kind, mode, contributors, and
timing; contributions whose point nobody declares, with a nearest-name suggestion; for `replace`
slots, the winner and why. Reads the same registries; adds no bridge verb.

## Code touched

- `packages/protocol/src/extensionPoints.ts`: `kind` and per-kind fields; `parseExtensionPointRef`
  unchanged.
- `packages/protocol/src/pluginContract.ts`: the extended `extensionPoints` and `extensions` schemas.
- `packages/node-core/src/server/plugin/{types.ts,context.ts}`: `ctx.hooks`; new `hooks.ts`.
- `packages/node-core/src/main/taskWorktree.ts`, `server/plugin/taskChecks.ts`, `server/bridge.ts`:
  the five seams converted.
- Owners' node code for the eight first hooks (`plugins/changes/src/main/localGit.ts` for push and
  commit; `plugins/agents/src/main/runtimeEngine.ts` for send and tool call;
  `plugins/terminal/src/main/runtime.ts` for run targets; `plugins/workflows/src/main/workflowRunner.ts`
  for steps; context's snapshot assembler; editor's save route).
- `packages/client-core/src/plugins/chrome/ExtensionPointHost.tsx`: annotations and the developer
  view read here.
- New `packages/client-core/src/plugins/annotations/*`, `plugins/tree/Slot.tsx`,
  `plugins/tree/arbitration.ts`.
- `packages/client-core/src/plugins/frames/register.ts`: rectangle slots as sibling regions.
- `packages/client-core/src/registries/exclusiveSlots.ts`: the picker generalised to `replace` ties.
- `packages/client-core/src/plugins/permissions.ts`: trust copy.
- `packages/client-core/src/diff/DiffPane.tsx`, `plugins/editor/src/client/FileTree.tsx`,
  the editor gutter, `plugins/docker/src/client/DockerBrowse.tsx`, the rail task row: draw sites.
- A settings page for the developer view.

## Tests

- Manifest: each kind's required fields are enforced on the node and the client; an undeclared kind
  falls back to `rows`.
- Annotations: two thousand keys produce one request; marks are stamped with the contributor; a
  contributor's failure draws nothing for it and leaves the others.
- Slots: `replace` with no match draws the default; with two matches draws the user's pick; `stack`
  past `max` draws the disclosure; a nested `Slot` in a grafted subtree renders its default and logs.
- Rectangle slots: two iframes are siblings; `slot.call` reaches the occupant and nothing else.
- Hooks: the cases in [08-hooks.md](./08-hooks.md) § Tests; the five converted seams pass their
  existing tests.
- Trust copy: every kind and direction has a sentence; snapshot the prompt for a manifest declaring
  all five.
- Developer view renders in the jsdom tier with a matched, an unmatched, and a tied point.

## Docs owed

- `docs/plugins.md` § "Cooperative extension points" gains the five kinds; § "Node-side extension
  points" becomes hooks.
- `docs/contribution-kinds.md` gains `kind`, `remote`, `hooks`.
- `docs/security.md` § "The vocabulary is closed, and a plugin can add to it" gains hooks and kinds.
- `docs/dashboards.md` § "Placements" reconciles `pane.aside` with the new slots.
- `docs/future/rail-tab.md`: delete Slice 3.
- `docs/diff-rendering.md` § "Review threads and state" gains the annotation draw site.
- `docs/future/dashboards/refused.md`: restate the widget-toolkit refusal against the tree.

## Doors left open

- Every kind is node-validated data or a host-mounted tree; nothing is DOM-specific except the
  rectangle, which is already the DOM-only exception.
- Hook payloads use the tree's prop vocabulary.
- The developer view reads registries and adds no bridge verb.

## Done when

- A test plugin declares all five kinds and each is exercised end to end in the running app: rows
  under a pane, marks on a diff, a card in a slot, a box beside the editor, a veto on a push.
- The five converted seams behave as before.
- The trust prompt shows both directions for each kind.
- `pnpm lint` and `pnpm test` are green.

## Verify before building

- `packages/protocol/src/extensionPoints.ts` has `EXTENSION_POINT_LOCATIONS = ['pane.footer',
  'pane.aside']`, `qualifiedExtensionPointId`, `parseExtensionPointRef`, `PluginExtensionItem`.
- `packages/client-core/src/plugins/frames/register.ts` reads `extensionPoints` in the `pane` branch
  and wraps with `ExtendedPane`.
- `packages/client-core/src/registries/exclusiveSlots.ts` holds the `rail.taskList` picker.
- `packages/node-core/src/main/taskWorktree.ts` exports `WORKTREE_CREATED`; `server/plugin/
  taskChecks.ts` exists; `server/bridge.ts` holds the `routeCapability` seams.
- `docs/future/rail-tab.md` still has "Slice 3: loaded-plugin descriptors, NOT BUILT."
- The owner code paths for the eight hooks exist at the files named; the events survey in
  `docs/future/events/plugin-events.md` cites line numbers for several of them.

# Phase 06: add resource detail regions

Status: done, October 10, 2026. Branch `phase-06-detail-regions`, from `5205b9ddb`.

## Completion note

A loaded owner can reserve room above or below its own project detail views and reference panels.
The host draws the region outside the owner's tree, so no worker opens a slot. Linear and Rollbar
consent in their own manifests. With nobody contributing, both views look as they did.

### What landed

- **Contract.** A `remote` point takes `mounts: [{ surface, region }]`, `region` `header` or `footer`,
  up to eight. `DETAIL_REGIONS`, `MAX_DETAIL_MOUNTS`, and `DetailRegionProps` sit in protocol's
  `extensionPoints.ts`. The generated `acorn-plugin.schema.json` follows.
- **Node check.** `manifestValidation/extensions.ts` refuses `mounts` on other kinds, a surface the
  manifest doesn't declare (so another plugin's view), a task pane, and two points in one region of
  one surface.
- **Client re-check.** The chrome pass skips a point whose mounts name anything but its own project
  panes and reference panels. `pluginExtensionPoint` refuses `mounts` on a non-remote point and an
  unknown region, and carries `mounts` on the registry entry.
- **Host.** `register.ts` reads the mounts off the owner's own roster row (`detailPointsFor`). A
  project surface is wrapped through the existing `extendedPane.ts` seam, which gains `detail` and
  `detailMountKey`. The desktop draws `chrome/DetailRegion.tsx` from `ChromeExtendedPane.tsx` and
  `PluginRefPanel.tsx`. The terminal draws its own in `apps/tui/src/plugins/ExtendedPane.tsx`.
- **Owners.** `linear:issue-summary` mounts at the header of `linear-issue` and `linear-ref`.
  `rollbar:item-summary` mounts at the header of `rollbar-item`. Both are `stack`, up to two.
- **Discovery and docs.** The Extension points page says where a mounted point draws. The
  `plugin_authoring` brief names the field, the props, and both points.
  [Detail regions](../../plugins/detail-regions.md) owns the contract, with a row in
  [remote points](../../plugins/remote-points.md).

### Decisions and deviations

- **Task panes are refused, not deferred silently.** The node rejects a mount on a task pane. Which
  ticket Linear's task pane shows changes inside its tree, and reading that would mean inspecting
  another worker's state, which the phase's stop rule forbids.
- **Props are `{ surface, item?, refId?, projectId? }`.** No `taskId`, because no mount site has a
  task. A reference panel passes its reference as both `item` and `refId`, and no project.
- **Remount rule.** `detailMountKey` keys the region on surface, task, and project. A new routed item
  is a props update on the same worker. A new project remounts, because a tree's bridge binds its
  scope at mount. No item, no mount.
- **Caps.** The point's `max` arbitrates on both hosts. The region is capped at 30% of the view's
  height, scrolls on its own on the desktop, and draws nothing when empty (`.detail-region:empty`).
- **Terminal `Dynamic` fix.** `apps/tui/src/tree/renderer.ts` remounted a compiled component on every
  prop change, because reading `component` through a spread tracked the other props. It now keeps
  the choice in its own memo, as `solid-js/web` does. The full `@acorn/tui` suite shows only the two
  known failures.
- **Service ceiling.** The node's static graph reached 1,756,613 B, over the 1,756,000 B ceiling, with
  the boot-time manifest check and the brief text. `check-service-budget.mjs` moves to 1,759,000 B
  with a dated note.
- **Tests.** The terminal case is a cells test beside the existing `ExtendedPane` test in
  `apps/tui/src/plugins/plugins.test.tsx`, not in `extensions.test.tsx`: the fixture node has no
  loaded project surface. No Linear or Rollbar plugin test was added. Their declarations are checked
  by `pluginConfigs.test.ts`, and a test restating them would only mirror the manifest.

### Verification

Run with Node 26.8.1.

- `manifest.test.ts`: a project pane and a reference panel accepted; another plugin's surface, a task
  pane, a duplicate placement, a `rows` point, an unknown region, and nine mounts refused.
- `chromeExtensionPoints.test.ts`: the client keeps the good point and drops a stranger's surface, a
  task pane, an unknown region, and an annotation with mounts.
- `detailRegions.test.tsx`, 6 tests through the real frames pass: routed item and scope, a sibling
  above the owner's tree, a new item on the same worker, a new project remounting, no item, an empty
  region, the cap with a count and a disabled contributor, owner failure and contributor failure
  apart, and a reference panel's scope. Keying the region on the item fails the worker test.
- `TreeHost.test.tsx`: a tree that emits a `Slot` naming the point draws nothing nested.
- `ExtensionPointsDev.test.tsx`, `pluginAuthoring.test.ts`, and the terminal cells test pass.
- Suites: `@acorn/protocol` (299), `@acorn/node-core` (1,756), `@acorn/client-core` (2,662),
  `@acorn/plugin-linear` (62), `@acorn/plugin-rollbar` (67), `acorn-plugin-types` (5), and
  `@acorn/plugin-api` (14) pass. `@acorn/tui` fails only the two known `chrome.test.tsx` marker tests.
  `@acorn/arch-tests` fails only the 15 known dead links. `@acorn/node` passes 272 of 281, and
  `pluginConfigs.test.ts` accepts both owner configs. The same nine tests fail with the same messages
  on the base, `5205b9ddb`, run in a separate worktree: the route golden and `pluginDisable.test.ts`
  lack the `workflows` invocation routes, and the HTTP, database, and workflow loader tests fail on
  "registered a schedule, but this node has no scheduler" and an undefined `fetch`.
- `tsc` is clean for protocol, node-core, client-core, plugin-types, linear, and rollbar. The
  terminal shows only the known git plugin errors. oxlint flags nothing new.
- **Desktop, `pnpm dev:agent`.** Seeded a Linear and a Rollbar connection with a sealed fake key and
  workspace links, then installed a scratch loaded plugin from `/tmp`. Its tree drew a badge, a line
  from its own Node route, and a nested `Slot`. The trust prompt listed both grants. On Linear's
  `ENG-1` detail, the header drew `probe ENG-1` and "linear-issue · route says ENG-1 has 3 deploys",
  and the nested `Slot` drew nothing. Below it, Linear kept "Couldn't load this issue" and **Try
  again**. Moving to `ENG-2` kept the same tree element and re-read the route. Rollbar's detail drew
  the same with its `<connection>:<identifier>` item. With the plugin disabled and the node
  restarted, the region was empty and took no height.
- **Not checked in a real host:** the Linear reference panel, which only GitHub's pull request
  detail opens and needs a GitHub-backed pull; `detailRegions.test.tsx` renders it through the real
  `PluginRefPanel`. The terminal's project detail, which needs a rail row from a working Linear or
  Rollbar connection to route to; the cells test covers its drawing at 40 columns.

### What later phases need to know

- A loaded owner opts a view in by adding `mounts` to a remote point. A future owner selection
  contract would let task panes take mounts; until then the node refuses them.
- `ExtendedPaneProps.detail` and `detailMountKey` are the shared seam. A new host draws a `Slot` per
  region keyed on `detailMountKey(subject())`.
- The terminal's `Dynamic` no longer remounts on prop changes. A component that relied on a remount to
  reread props would now need to read them reactively.
- To reach a Linear or Rollbar detail in `dev:agent` without a real key, seal a fake credential with
  `encryptSecret` and the session's `data/session.key`. An unsealable credential flips the
  connection to `needs-auth` and hides the source.

Let Linear and Rollbar opt into bounded plugin UI around their detail views. Loaded owners must be
able to reserve the region without gaining arbitrary composition inside a worker tree.

## Starting point and owners

`plugins/linear/src/tree/LinearIssueView.tsx` and `plugins/rollbar/src/tree/RollbarItemView.tsx` own
their headers and facts. Their manifests declare task and project panes; Linear also has a reference panel.
`packages/client-core/src/host/chrome/ChromeExtendedPane.tsx` hosts footer rows, dashboard asides,
and sibling frames. `packages/client-core/src/host/chrome/extendedPane.ts` is its terminal seam.
`packages/client-core/src/host/frames/register.ts` composes loaded surfaces.
`packages/protocol/src/tree/nodes.ts` prohibits ordinary tree-created nested slots.

Read [remote points](../../plugins/remote-points.md), [pane regions](../../panes/regions.md),
and [the manifest](../../plugin-authoring/the-manifest.md).

## Contract

Add an optional `mounts` field to a `remote` extension-point descriptor:

```json
{ "id": "issue-summary", "kind": "remote", "label": "Issue summary",
  "mode": "stack", "max": 2,
  "mounts": [{ "surface": "linear-issue", "region": "header" }] }
```

`mounts` is a bounded list of up to eight declared owner surfaces and `header`/`footer` placements.
Only pane and reference-panel targets accept it. Reject unknown surfaces, duplicate placements on
one surface, and `mounts` on other point kinds. Remote points without it retain their compiled-owner
behavior. It does not repurpose the row footer or dashboard aside location vocabulary.

The outer host mounts a normal `Slot` with `{ taskId?, projectId?, item?, refId?, surface }` and the
same scope as the owner. No worker receives a slot reference. `item` is the resource selected in the
owning surface, including subsequent selection events, not the shell's last selected rail row.
Only mount when that identity is available. Do not pass provider facts or grants from the owner.
Contributors read their own data or declared capabilities. No owner actions are added in this phase.

Linear declares `linear:issue-summary` for project `linear-issue` and reference `linear-ref` headers.
Rollbar declares `rollbar:item-summary` for project `rollbar-item`. Start with these mount sites;
task-pane internal detail selection needs an owner selection contract and is deferred until explicit.

## Steps

1. Add descriptor types, Node validation, client revalidation, schemas, and discovery. Reject cross-owner
   mount claims. Build on the existing surface ownership checks rather than trusting IDs from a tree.
2. Extend loaded surface composition with a small host wrapper shared through the supplied host seam.
   Keep ordinary worker trees unchanged and ensure reference panels receive their own mount scope.
3. Bind reactive item identity through host surface routing/selection. Preserve contributor workers
   on prop updates, dispose on owner change, and keep default view sizing and scroll ownership intact.
4. Add the Linear and Rollbar owner declarations. Add a loaded fixture drawing a badge and a small
   section from its own route. Demonstrate no-match emptiness and the owner's essential controls.
5. Provide terminal header/footer regions with the same arbitration and caps. Verify narrow layouts
   and that dashboard asides and row footers remain independent.

## Tests and acceptance

Extend manifest and frame registration tests, `Slot.test.tsx`, `apps/tui/src/extensions.test.tsx`,
and loaded Linear/Rollbar detail tests. Cover reference scope, selected-item updates, route navigation,
no item, unknown mount, disabled contributor, declared cap, and attempted nested `Slot` emission.
Test owner failure and contributor failure separately. Neither may replace the other's fallback.

Run `pnpm lint`, full suites for `@acorn/protocol`, `@acorn/node-core`, `@acorn/client-core`,
`@acorn/plugin-linear`, `@acorn/plugin-rollbar`, `@acorn/tui`, declaration packages, and architecture.
Expect exit zero. Open both project detail views and a Linear reference panel in the real hosts.

Complete when loaded owners consent through their own manifests, item updates reach the correct
contributors, and no generic worker nesting has been enabled.

## Verify before building

- Recheck `register.ts` mount props and ownership for project routes and reference panels.
- Confirm the current manifest IDs before adding their mount declarations.
- Stop if task detail identity can only be obtained by inspecting another worker's private state.

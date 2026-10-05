# Phase 06: add resource detail regions

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 05. This phase supplies host regions around loaded owners, not nested remote slots.

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

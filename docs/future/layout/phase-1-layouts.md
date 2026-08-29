# Phase 1: six host-owned layouts

Status: shipped, 2026-08-29. `docs/panes.md` § Layout model owns the behaviour now.

## Goal

Implement the six layouts in [05-layouts.md](./05-layouts.md) as host components, let a pane
contribution declare one and fill its regions, and fold the arranging components that exist today
(`ListDetail`, `DocumentOverFrame`, `SplitHandle`, `DocumentTabs`, the wizard chrome) into them. No
pane moves in this phase; the layouts exist and one pane (notes, the smallest `list-detail`) proves
them.

## Why this phase, and why now

Layouts are made of kit nodes (phase 0) and are where regions live. Regions are the focus groups
phase 2 needs and the places phase 4 puts slots. Doing layouts before focus means focus attaches to a
structure that already exists rather than being retrofitted onto six pane-specific arrangements.

## Scope

In:

- `client-core/src/layouts/`: `Single`, `ListDetail`, `HeaderBodyFooter`, `Tabs`,
  `DocumentOverFrame` and `FrameBesideDocument`, `StackSplit`, `Wizard`. Each is a Solid component
  taking region components (direct path) and, from phase 3, region trees (remote path).
- `PaneContribution` gains `layout` and `regions`. `paneRegistry` renders layout, then regions.
- The manifest `frames[].layout` key widens from `document-over-frame` to the six names, and
  `frames[].regions` is added. Parsed on the node (`protocol/pluginContract.ts`) and re-checked on
  the client (`frames/documentSurfaces.ts` becomes `frames/layouts.ts`).
- Persisted per-pane layout state (selected tab in `tabs`, split position in `list-detail` and
  `stack-split`) moves into the host under the pane id, session-only as today.
- Notes moves to `list-detail` as the proof.

Out: focus behaviour (phase 2), slots in regions (phase 4), every other pane (phases 5 to 8), the
narrow and terminal projections (documented, not built).

## Design detail

**Region contract.** A region is `{ name, component | tree, focusGroup: true }`. The layout owns
padding, dividers, and the drag handle; a region's component fills the rectangle it is given and
never reads its size. A missing required region throws at registration.

**`list-detail`.** Existing `ui/ListDetail` moves and becomes the layout. `list-header` and
`list-footer` are optional regions. The list width token stays.

**`header-body-footer`.** New. Body scrolls; header and footer do not. `header-body` is the same
component with no footer.

**`tabs`.** The layout, distinct from the `Tabs` node. Persists the selected tab per pane; owns the
`⌘1`..`⌘9` in-pane chord from phase 2.

**`document-over-frame` and `frame-beside-document`.** `frames/DocumentOverFrame.tsx` becomes the
layout; the beside variant is the same component with the axis flipped by name, not a prop. The
document region is `editor/DocumentSurface` as today. The frame region takes a component (compiled),
a tree (phase 3), or a rectangle.

**`stack-split`.** `SplitHandle` and `ui/split.ts` fold in. The terminal drawer is the consumer
(phase 6).

**`wizard`.** New. Steps from `steps: [{ id, label }]` and `current`; the host draws the indicator
and back and next; the step region is the plugin's.

**Manifest.**

```json
"frames": [{
  "target": "pane", "id": "issues", "label": "Issues",
  "layout": "list-detail",
  "regions": { "list": "remote:./dist/list.js", "detail": "remote:./dist/detail.js" }
}]
```

Until phase 3, a loaded plugin's region value may only be the existing frame bundle (the whole pane
is one region, `single`), so no loaded plugin changes here.

## Code touched

- New `packages/client-core/src/layouts/`: one file per layout, plus `index.ts`, `regions.ts` and
  `state.ts`. `DocumentSplit.tsx` holds both `document-over-frame` and `frame-beside-document`,
  because the axis is the only difference and the name carries it.
- New `packages/protocol/src/paneLayouts.ts`: the layout names and each one's region set, read by the
  manifest parser, the client's roster re-check, and the pane registry.
- `packages/client-core/src/registries/panes.ts`: `PaneLayoutContribution`, and a `PaneRegistry`
  subclass whose `register` turns a declared layout into a component.
- `packages/client-core/src/plugins/frames/register.ts`: the `pane` branch reads `layout` and
  `regions` and builds a region per entry.
- `documentSurfaces.ts` under `packages/client-core/src/plugins/frames/` became `layouts.ts`, and
  `documentRegionFor` became `paneLayoutFor`.
- `packages/client-core/src/plugins/frames/DocumentOverFrame.tsx`: deleted, replaced by the layout.
- `packages/protocol/src/pluginContract.ts`: `layout` enum, `regions` record, and the cross-field
  check that a layout has the regions it names.
- `plugins/notes/`: `notesModel.ts` is new and holds what the three regions share;
  `NotesPane.tsx` is three region components.
- `plugins/database/acorn-plugin.config.mjs`: the one manifest that declared a layout.

## Tests

- Each layout renders in the jsdom `hosts` project with placeholder regions; region order and
  presence are asserted.
- A layout with a missing required region throws at registration.
- The manifest parser rejects a `layout` outside the set and a `regions` key the layout lacks, on
  the node and again on the client.
- Notes' existing tests pass against the layout version.

## Docs owed

- `docs/panes.md` § "Layout model" states the two layers; § "Contributions" documents `layout` and
  `regions`.
- `docs/third-party/monaco.md` § "The template vocabulary" and § "document-over-frame, concretely"
  fold into 05-layouts.md, with a pointer left behind.
- `docs/frontend.md` § "Registries and plugins" notes layouts.

## Doors left open

- Each layout's narrow and terminal projections are in 05-layouts.md before it lands.
- No layout reads the window width; breakpoints are style tokens.
- No layout exposes a pixel to a plugin.

## Done when

- The layouts exist, tested, and notes renders through `list-detail`.
- `frames[].layout` accepts the layout names on the node and the client.
- `pnpm lint` and `pnpm test` are green.

## What came out differently

- **Eight names, seven components, not six layouts.** The prose said six and then listed seven
  sections; `single`, `list-detail`, `header-body-footer`, `tabs`, `document-over-frame`,
  `frame-beside-document`, `stack-split` and `wizard` is what shipped. `header-body` is
  `header-body-footer` with no footer, which is why it is not a name.
- **One props type for every layout**, not one per layout. The remote root in phase 3 and the
  registry both build these props without knowing which layout they are building for, so a layout
  reads the fields it has regions for and ignores the rest. Regions arrive as thunks, so `tabs`
  mounts one panel and `wizard` mounts one step.
- **A pane can hide a region.** Notes collapses its library, which the layout has to do rather than
  the pane, and it is the same move every narrow projection makes on selection. Notes' collapse
  toggle moved into the note toolbar, because hiding the list column takes its header with it.
- **The manifest shape changed rather than widened.** `layout: { template, document }` became
  `layout: "<name>"` plus `regions`, where a region is `"frame"` or
  `{ "kind": "document", ... }`. One manifest declared the old shape and moved with it. The trust
  gate, the key claims and `surfaceAction` all ask "does this pane have a `frame` region?" now
  instead of naming a template.
- **`ui/ListDetail`, `ui/DocumentTabs`, `ui/split.ts` and `ui/Drawer.tsx` stayed put.** The layouts
  use them; ten plugins still use `ListDetail` directly, and moving those is phases 5 to 8's job.
  Phase 9 deletes what is left over.
- **`layouts/state.ts` is the per-pane state**, module-level and session-only, generalising the
  height signal the composed database pane held. `list-detail` gained a drag handle it did not have.

# Phase 1: six host-owned layouts

Status: not started.

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

- New `packages/client-core/src/layouts/*.tsx`, one file per layout, plus `layouts/index.ts` and
  `layouts/regions.ts`.
- `packages/client-core/src/registries/panes.ts`: `PaneContribution.layout`, `regions`; the render
  path.
- `packages/client-core/src/plugins/frames/register.ts`: the `pane` branch reads `layout` and
  `regions`; `documentRegionFor` generalises.
- `packages/client-core/src/plugins/frames/documentSurfaces.ts`: becomes `layouts.ts` with the
  six-name check.
- `packages/protocol/src/pluginContract.ts`: `layout` enum, `regions` record.
- `packages/client-core/src/ui/primitives.tsx` (`ListDetail`), `ui/split.ts`, `ui/DocumentTabs.tsx`,
  `ui/Drawer.tsx`: moved or folded.
- `plugins/notes/src/client/NotesPane.tsx`: the proof.

## Tests

- Each layout renders in the jsdom `hosts` project with placeholder regions; region order and
  presence are asserted.
- A layout with a missing required region throws at registration.
- The manifest parser rejects a `layout` outside the six and a `regions` key the layout lacks, on
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

- The six layouts exist, tested, and notes renders through `list-detail` with no visual change
  beyond divider placement.
- `frames[].layout` accepts the six names on the node and the client.
- `pnpm lint` and `pnpm test` are green.

## Verify before building

- `packages/client-core/src/plugins/frames/DocumentOverFrame.tsx` and `documentSurfaces.ts` exist and
  `register.ts` calls `documentRegionFor` in the `pane` branch.
- `packages/client-core/src/registries/panes.ts` holds `PaneContribution`.
- `packages/protocol/src/pluginContract.ts` has the `layout` key on frame surfaces with
  `document-over-frame` as its only value.
- `plugins/notes/src/client/NotesPane.tsx` is a `ListDetail` with a `Toolbar` and a `Markdown` or
  `textarea` toggle, as the survey saw.

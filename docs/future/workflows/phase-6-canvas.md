# Phase 6: the canvas

Status: SHIPPED. Waited on phases 3 and 4.

## Goal

The editor and the run pane can show the graph as a picture: cards on a grid, edges as curves, a
selected card driving the inspector, and in the editor, edges authored by dragging from a port. In
the terminal client the same node draws the indented list the editor already has.

## Why this phase, and why now

A five-node graph reads fine as a list. A twelve-node one with two joins does not. The canvas is
last because everything it needs, the draft model, validation, rename, and the run model, was built
and tested for the list, and because it is the one piece that needs a kit admission.

## Scope

In: a kit `Graph` node with a DOM projection and a cell projection; the editor's `Graph | JSON` tabs
gaining Graph; the run pane's graph view of a run; positions in device preferences.

Out: free-form drawing, groups, a minimap, edge labels.

## Design detail

**Why a kit node.** Plugin client code may not emit raw DOM or SVG. The rule exists so the terminal
client can draw every plugin surface, and a canvas is exactly what it cannot draw. The kit admits a
node when two surfaces need it and both projections are written before it lands. The editor and the
run pane are the two.

**The node.**

```ts
type GraphNode = { id: string; label: string; detail?: string; glyph?: string; tone?: Tone; selected?: boolean }
type GraphEdge = { from: string; to: string }
type GraphProps = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  positions?: Record<string, { x: number; y: number }>   // absent → laid out
  onSelect?(id: string): void
  onConnect?(from: string, to: string): void            // present → ports are drawn
  onDisconnect?(from: string, to: string): void
  onMove?(id: string, position: { x: number; y: number }): void
  ariaLabel: string
}
```

**DOM projection.** `packages/client-core/src/kit/components/data/Graph.tsx` (new). proliferate's
geometry, copied rather than re-derived (`references/proliferate/apps/packages/product-client/src/domain/workflows/graph-layout.ts`):
200 by 92 cards on a 22 px grid, rank gap 60, lane pitch 236, a vertical cubic curve from the bottom
port to the top port, and the edge's remove affordance at the midpoint of the longest stretch no
card covers. Pan by dragging the background, zoom anchored at the pointer between 0.35 and 1.5, fit
on mount and on a node count change unless the viewport was held. Edges in one SVG under the cards,
`aria-hidden`; every card a real button so the graph reads as a list. Layout is deterministic from
the edges when `positions` is absent; a given position wins for its node.

**Cell projection.** `apps/tui/src/kit/` gains the `Graph` entry in its component table, drawing the
indented list phase 3 already draws with the same rows and the same selection. `onConnect` is a
picker on the selected row. The reachability property covers it as it covers every node.

**Editor.** The header's `Graph` tab mounts `Graph` over the draft, with ports on. New nodes from
the Add menu appear detached at the next free rank. Positions from `layoutPrefs.ts`, written on
`onMove` after 400 ms. Backspace deletes the selected card. The list column stays visible beside the
canvas on wide layouts and collapses on narrow ones, which is the `list-detail` layout's own rule.

**Run pane.** A `Graph` over the run's nodes with `tone` from status and no ports; selecting a card
selects the node in the detail column. A view toggle in the list header switches between rows and
graph, remembered per device.

## Code touched

- `packages/client-core/src/kit/components/data/Graph.tsx` (new), `packages/client-core/src/kit/tokens/support.ts`
  (the row), `packages/protocol/src/tree/nodes.ts` (the node's props in the tree vocabulary),
  `packages/plugin-api/src/ui/index.ts` (the export).
- `apps/tui/src/kit/ui.ts` and the component table beside it: the cell projection.
- `plugins/workflows/src/client/editor/WorkflowEditor.tsx`, `GraphView.tsx` (new).
- `plugins/workflows/src/client/runs/RunPane.tsx`, `RunGraph.tsx` (new).
- `docs/ui-design.md` § The closed kit: the admission.

## Tests

- `Graph.test.tsx` (jsdom, `hosts` project): deterministic layout for a diamond; a given position
  overrides; selecting a card calls `onSelect`; the edge remove control sits on the longest uncovered
  stretch; no `class` prop anywhere (the kit's rule).
- The terminal reachability property includes `Graph` with no exception.
- `plugins/workflows/src/client/editor/draft.test.ts` (new in phase 3): connect through the canvas is the same
  operation as through the picker, so no new cases; one test that a position survives a rename.

## Docs owed

`docs/ui-design.md` § The closed kit and § Every node at 80 by 24 (the node, both projections);
`docs/workflows.md` § Authoring (the graph view); `docs/tui.md` § What a plugin loses here (nothing,
because the projection is the list).

## Doors left open

- Groups and a minimap, when a graph outgrows one screen.
- Edge labels carrying a `decide` verdict.

## Done when

- The owner's first workflow draws as two roots joining into one, in both hosts, and an edge can be
  added by dragging on the desktop and by the picker in the terminal.
- A running graph in the run pane recolours a card within one `step-changed` frame.

## Verify before building

- The kit still refuses a `class` prop and the arch rule still refuses raw DOM under `plugins/`.
- `packages/client-core/src/kit/tokens/support.ts` still lists every node with its `dom` and `tui`
  columns; `docs/ui-design.md` § The closed kit still states the two-consumer admission rule.
- `references/proliferate/apps/packages/product-client/src/domain/workflows/graph-layout.ts` still
  holds the geometry constants named above.

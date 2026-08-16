# Dashboards: the backlog

**Everything left in this folder is unbuilt, and most of it is gated.** Dashboards shipped in two
rounds — typed collections, user-composed panels, cross-source mapping, the kanban board and the Home
placement on 2026-08-12; then the drag-and-resize grid, the chart view, the task-pane placement, the
row-action risk tier, user-invented panel fields and person monograms on 2026-08-16. The owning doc
for how the system behaves is [`docs/dashboards.md`](../../dashboards.md), with the contribution
vocabulary in `docs/plugins.md § Descriptors`. This folder holds what remains, plus `refused.md` — the
guardrails on what deliberately does *not* get built.

The pre-build design record that used to live here — the seven-system prior-art survey, the
2026-08-12 snapshot of acorn's machinery, and the collection/composition design files — served its
purpose and was retired on 2026-08-16, as were `grid-layout.md` and `charts.md` once they were built.
All of it is in git history: `git log --follow -- docs/future/dashboards`. The reasoning that still
constrains future work was folded into `docs/dashboards.md`, the remaining deliverable files and
`refused.md`; nothing you need to build from is only in history.

## The invariant every item must hold

**Everything user-composed lives host-side against one typed contract; plugins are providers of
well-described records and get zero say over pixels.** Cross-source composition, new view kinds,
new placements, layout geometry — all client machinery over the same node↔client contract, so the
contract never grows to chase a use case. Two recorded exceptions, one built and one not: the row
action's `risk` tier is an additive optional field that shipped, and write-back's per-field mutation
contract is a genuine wire change, a protocol version event, and gated (`write-back.md`).

## The work items

| File | Deliverable | Gate |
| --- | --- | --- |
| [`placements.md`](./placements.md) | Rail-source side panels, then plugin-hosted regions under the host-drawn-region rule. | Regions must ride the shipped extension-point contract. |
| [`dynamic-collections.md`](./dynamic-collections.md) | Run-once-and-pin with schema-drift detection, then the discovery route. | Both gated on the database plugin's saved-query case being wanted. |
| [`write-back.md`](./write-back.md) | Board-drag write-back over designated write values. | Gated on real usage of read-only boards. |

The one seam worth knowing across them: the grid's per-scope `layouts` key and its narrow-window
collapse already carry the placements `placements.md` adds, and the grid's header-only drag rule is
what keeps board-card drag unambiguous when `write-back.md` lands.

## Smaller items

Each is small, independent, and can ride along with any of the above.

- **A grouped bar chart.** The chart view splits a `line` into series from an enum but a `bar` into
  nothing, because splitting a bar chart by a second enum is a *third shape* rather than a knob. Build
  it as one — `chart.ts` already buckets per series, and the layout is the only new arithmetic.
  *Done when* a bar chart can carry a series split, the editor offers it only where two enums exist,
  and an old client renders the definition as the ungrouped bar rather than nothing.
- **Per-placement column counts.** `COLS` is a constant in `layout.ts`, not config, and deliberately
  so — config for a value that never changes is config nobody reads. A rail-source side panel or a
  narrow plugin region may be the first surface that genuinely wants six. *Done when* a placement can
  declare its column count, existing rects survive the change, and Home is untouched.
- **Drag between placements.** With two surfaces there is now somewhere to drag *to*. The answer is a
  menu action ("Move to…") before it is a drag, and `placePanel`/`unplacePanel` already do the work.
  *Done when* a panel can be moved from Home to the task pane without recomposing it, keeping its
  definition and taking a fresh rect at the destination.

## Reading order for a fresh session

1. [`docs/dashboards.md`](../../dashboards.md) — what exists and the decisions it embodies.
2. [`refused.md`](./refused.md) — what not to build, with the revisit condition for each.
3. The item's own file. Every file ends with a **verify before building** list: paths and claims
   rot, and each file was verified against the tree on the date it states — budget a re-verify
   pass, not a rewrite.

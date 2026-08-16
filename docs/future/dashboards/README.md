# Dashboards: the backlog

**Everything in this folder is unbuilt.** What the system does today is
[`docs/dashboards.md`](../../dashboards.md), with the contribution vocabulary in
`docs/plugins.md § Descriptors`. This folder holds what is left, one deliverable per file, plus
`refused.md` — the guardrails on what deliberately does *not* get built.

Design material that was built, and the pre-build design record it came from, is not kept here. It is
in git history: `git log --follow -- docs/future/dashboards`. The reasoning that still constrains
future work has been folded into `docs/dashboards.md`, the files below and `refused.md`; nothing you
need to build from is only in history.

## The invariant every item must hold

**Everything user-composed lives host-side against one typed contract; plugins are providers of
well-described records and get zero say over pixels.** Cross-source composition, new view kinds, new
placements, layout geometry — all client machinery over the same node↔client contract, so the
contract never grows to chase a use case. One item in this backlog is allowed to break that, and it
is named: write-back's per-field mutation contract is a genuine wire change and a protocol version
event (`write-back.md`).

A corollary that the UX-redesign items below lean on hard: the **plugin contract** and the
**core node↔client contract** are two different things. Measure history (`measure-history.md`) adds a
core route and a node table — that is the host growing its own machinery, and it is allowed. Nothing
in this folder adds a field to `@acorn/protocol/collections.ts` except write-back, which says so.

## The accepted UX redesign, and its build order

An interactive design prototype was accepted on 2026-08-17 (claude.ai artifact "Dashboards,
Redrawn", `https://claude.ai/code/artifact/a083c868-fc3a-4a61-a89c-d837df0fa495` — private to the
account; the specs below stand alone without it). It commits to three things: panel creation becomes
a staged **wizard with a live preview**; the drag gesture gets a **dot lattice, a soft slot and real
motion**; and stat panels earn **deltas and sparklines**. Each is specced in its own file, and they
are **not independent** — there is foundation work with no pixels in it that must land first.

Build in this order. **The scheduler comes first**: measure history is sampled by the node on a
schedule ([`docs/future/cron/`](../cron/README.md)), so the cron engine and its `collection-sample`
target — including the two seams it names, node-side collection reads and the shared measure
pipeline — precede everything trend-shaped here. Phases 1 and 2 may run in parallel with phase 0;
nothing else may be reordered.

| Phase | What | File | Why it is first |
| --- | --- | --- | --- |
| pre ✅ | The scheduler: engine, declarations, the `collection-sample` target and its two seams — all four cron phases are built | [`../cron/`](../cron/README.md) | The node-side sampler is what makes measure history gapless; it accrues samples today with no client open. |
| 0 | Model keys + codec + pure derivations; the `tabs` list; the measure-history store (fed by cron); the series-colour decision; the `source` panel-local field | `measure-history.md`, `wizard.md § Foundation`, `charts.md`, `tabs.md § data model` | Everything later renders from these. Building UI first means rebuilding it when the shapes land. |
| 1 | Grid gesture + panel chrome restyle | `ux-refresh.md` | Pure presentation; touches no data. Parallel-safe with phase 0 and the cron work. |
| 2 | The panel wizard; the tab bar | `wizard.md`, `tabs.md` | The wizard needs phase 0's derivations; the tab bar needs only the `tabs` key and is otherwise independent. |
| 3 | Stat trend + delta rendering; chart growth (legend, grouped bar, source split, sparkline mark) | `measure-history.md § Display`, `charts.md` | Needs the history store accruing samples and the series-colour decision made. |

## The work items

| File | Deliverable | Gate |
| --- | --- | --- |
| [`ux-refresh.md`](./ux-refresh.md) | The grid gesture and panel chrome restyle. | None — accepted design, phase 1. |
| [`wizard.md`](./wizard.md) | Staged panel creation with a live preview, over the same generated editor. | Phase 0 derivations must exist first. |
| [`tabs.md`](./tabs.md) | Multiple named dashboards on Home — a tab is a `home/<tabId>` placement scope; the bar appears only past one tab. | The `tabs` model key (phase 0) before the bar. |
| [`measure-history.md`](./measure-history.md) | The measure-history store and the stat delta/sparkline it feeds; sampled by the scheduler's `collection-sample` target. | Waits on [`../cron/`](../cron/README.md) phases 1–3. |
| [`charts.md`](./charts.md) | Chart growth: series identity colours, legend, grouped bar, source split, the sparkline mark. | Series-colour decision (phase 0) before any of it renders. |
| [`placements.md`](./placements.md) | Rail-source side panels, then plugin-hosted regions under the host-drawn-region rule. | Regions must ride the extension-point contract. |
| [`dynamic-collections.md`](./dynamic-collections.md) | Run-once-and-pin with schema-drift detection, then the discovery route. | Both gated on the database plugin's saved-query case being wanted. |
| [`write-back.md`](./write-back.md) | Board-drag write-back over designated write values. | Gated on real usage of read-only boards. |

Two seams across them, both already load-bearing in the code:

- The grid's per-scope `layouts` key and its narrow-window collapse already carry the placements
  `placements.md` adds, so a new surface needs a renderer and no storage work.
- The panel grid claims **only the panel header** as its drag surface, which is what keeps board-card
  drag unambiguous when `write-back.md` lands. Do not take the body for anything else.

## Smaller items

Each is small, independent, and can ride along with any of the above.

- **Per-placement column counts.** `COLS` is a constant in `layout.ts`, not config, and deliberately
  so — config for a value that never changes is config nobody reads. A rail-source side panel or a
  narrow plugin region may be the first surface that genuinely wants six. *Done when* a placement can
  declare its column count, existing rects survive the change, and Home is untouched.
- **Drag between placements.** With more than one surface there is somewhere to drag *to*. The answer
  is a menu action ("Move to…") before it is a drag, and `placePanel`/`unplacePanel` already do the
  work. The accepted design seats it in the panel overflow menu, as a submenu listing surfaces —
  and, with `tabs.md`, each Home tab — with the current one checked. *Done when* a panel can be
  moved from Home to a task pane or another tab without recomposing it, keeping its definition and
  taking a fresh rect at the destination.
- **A screen-reader data table inside a chart.** The chart's accessibility floor is a labelled SVG
  with a tooltip per mark, and the full data one view flip away in `table`. *Done when* a chart
  exposes its own rows without the flip, and without a second rendering path for cells.

(The grouped bar chart, previously listed here, grew real display questions and moved to
[`charts.md`](./charts.md).)

## Reading order for a fresh session

1. [`docs/dashboards.md`](../../dashboards.md) — what exists and the decisions it embodies.
2. [`refused.md`](./refused.md) — what not to build, with the revisit condition for each.
3. The build-order table above, then the item's own file. Every file ends with a **verify before
   building** list: paths and claims rot, so budget a re-verify pass, not a rewrite.

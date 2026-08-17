# Dashboards: what remains

**The accepted 2026-08-17 redesign is built, end to end** — the scheduler beneath it
([`docs/schedules.md`](../../schedules.md)), the measure history it feeds, the grid gesture, the
wizard, Home tabs, the chart growth, and both panel-region placements. Behaviour lives in
[`docs/dashboards.md`](../../dashboards.md) (with the extension-point half in
`docs/plugins.md § Cooperative extension points`), and the per-item design records — reasoning,
deviations, landmines — live where this folder has always retired them: **git history**,
`git log --follow -- docs/future/dashboards`. The shipped files were `ux-refresh.md`, `wizard.md`,
`tabs.md`, `measure-history.md`, `charts.md` and `placements.md`; each ended its life stating where
its behaviour moved, so history is navigable file by file.

This folder now holds only what is **not built**, one deliverable per file, plus `refused.md` — the
guardrails on what deliberately does not get built. Nothing you need in order to finish is anywhere
else; this README is the path.

## The invariant every item must hold

**Everything user-composed lives host-side against one typed contract; plugins are providers of
well-described records and get zero say over pixels.** It held through the whole redesign — the only
core-contract growth was measure history's node table and read route, which is the host's own
machinery — and exactly one remaining item is licensed to break it: write-back's per-field mutation
contract is a genuine wire change and a protocol version event (`write-back.md`).

## The path to done, in order

### 0. The verification pass — before any new code

Everything UI-shaped shipped **unrendered by any test**, by construction: vitest here runs in node
with no Solid plugin, and a worktree cannot run the app. One session in the running app clears the
recorded debt list:

- the drag: lattice, soft slot, lift, neighbours gliding — does it read as a chain reaction;
- the wizard: all four steps, the cold self-describing collection, the tab select, "New dashboard…"
  creating at commit;
- the tab bar: create, inline rename, arrows/Home/End, armed delete, the device-local active tab
  surviving a reload;
- the stat trend: sparkline and delta on a real panel, the "collecting since…" cold state;
- charts: legend wrap at one-cell width, the three `--viz-series` colours across the style packs
  (light and dark);
- placements: a rail-source side panel beside a real source, a `pane.aside` beside a real frame, at
  honest widths — and whether twelve collapsed columns feel cramped there (see smaller item 1).

This pass also starts the clock on write-back's usage gate: board usage cannot be observed until
the boards are being used.

### 1. [`project-database.md`](./project-database.md) — the taskless connection

**Ready to build the moment the saved-query demand is declared** — its gate is the owner wanting
SQL-backed panels, nothing technical. Three decisions are made and verified against the code: a
panel names a *project* and the node resolves the same layered URL lookup against the main
checkout; a repo-authored `url_script` never runs unattended without project-addressable consent
(refuse, never prompt); column types come off `dataTypeID` via a closed OID table with
`enum`/`person`/`link` never inferred. Its own build order is internal: connection → types → then
the file below.

### 2. [`dynamic-collections.md`](./dynamic-collections.md) — run-once-and-pin, then discovery

Part 1 (run, pin, drift, re-pin) builds on `project-database.md` and nothing else. Part 2 (the
discovery route) stays gated on part 1 — it enumerates a set that cannot exist until saved queries
run, and building an unconsumed wire contract first would be the "unused rule nobody has checked"
mistake on purpose.

### 3. [`write-back.md`](./write-back.md) — board-drag mutation

Gated on **real usage of read-only boards**, so the mutation contract is designed against observed
boards rather than imagined ones. This gate cannot be met by deciding; it is met by time after the
verification pass puts boards in front of people. The seams it needs are all in place and stated in
the file: the reserved `writeValue` round-trips, the panel body is gesture-free, and the risk-tier
confirmation is the consent machinery it reuses.

### Smaller items, any time

- **Per-placement column counts** — *its trigger has now fired*: `pane.aside` regions and
  rail-source side panels exist and are the narrow surfaces the item predicted. If the verification
  pass finds twelve collapsed columns cramped there, do this next: a placement declares its column
  count, existing rects survive, Home untouched.
- **"Move to…" across surfaces** — half done: Home tabs work. What remains is the task pane and
  regions as destinations, blocked on one recorded question: should Home be able to aim at a
  placement nobody is looking at? (The wizard answered no for itself; the menu should answer
  deliberately, not inherit.)
- **A screen-reader data table inside a chart** — the chart exposes its own rows without the flip
  to `table`, with no second rendering path for cells.
- **`core:backup`** (lives in [`../cron/engine.md § migration`](../cron/engine.md)) — one
  `scheduler.register` block behind one product decision: how many backups should a node keep?

## Reading order for a fresh session

1. [`docs/dashboards.md`](../../dashboards.md) — what exists and the decisions it embodies.
2. [`refused.md`](./refused.md) — what not to build, with the revisit condition for each.
3. This path, top to bottom. Every remaining file ends with a **verify before building** list;
   paths and claims rot, so budget a re-verify pass, not a rewrite — the last verify pass is what
   caught `project-database.md`'s gap before it became an improvised semantic.

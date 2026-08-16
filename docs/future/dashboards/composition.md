# Composition: panels, mapping, and views

Design notes from the dashboards session (2026-08-12). This file is the host side: how typed
collections (`data-contract.md`) become user-composed panels. Nothing in this file touches the wire
contract — that is the invariant to protect (`README.md`), and nothing in the build did either.

> This is the design record. The host side is `packages/client-core/src/dashboards/` and the owning
> doc is [`docs/dashboards.md`](../../dashboards.md). Everything below exists except charts and
> write-back, both of which are unscheduled work — see `README.md § Still unscheduled`.
> Notes marked **As built:** describe where the system differs from this file, so nothing here is implemented twice.

## The four layers of a panel

A **panel** is a self-contained definition with four layers, each owned by a different party. The
survey's third pattern (`prior-art.md`) is three layers; the mapping layer is acorn's addition,
forced by the cross-source requirement.

| Layer | Owner | Contents |
| --- | --- | --- |
| **queries[]** | plugin (meaning), user (choice) | One or more collection references `(pluginId, collectionId)` + declared params. Opaque to the host beyond the schema. |
| **mapping** | host, declarative | Per source: field mapping onto panel-local fields; **value mapping** for enum fields; **derived fields** (the user-invented enum). |
| **shaping** | host, declarative | Filter, sort, group-by, limit, visible-field projection — generic, identical for every collection. |
| **view** | host, per view kind | Which view (table, list, stat, board) and its options ("compact rows", "show headers"). |

Why the layering matters: it is what lets a user flip a panel from table to board without losing
their filters, and swap a source without losing the layout. Retool is the cautionary tale for
collapsing the layers into "any JSON plus a program" (`prior-art.md`).

Shaping runs **client-side over the returned rows as the baseline**; declared server-side params
are an optimization a collection may offer, never a requirement. This keeps the plugin obligation
minimal and the semantics identical everywhere.

**As built, with one ceiling this table does not show.** Once the mapping layer engages — more than one
source, or user-declared columns — **a panel's fields are the five ROLES and nothing else**. A role is
the only thing two independently-written collections agree about, so it is the only thing the host can
align without asking; github's `repo` and linear's `identifier` are both useful and neither has a
panel-local home. The upgrade path, if someone wants a mixed column no role describes, is a
user-invented panel field with a per-source picker — the same matrix the editor already draws, one row
longer. Also shipped differently: **group-by lives in `shaping`, not in the view**, which is what makes
flipping a board to a table and back keep the grouping the way it keeps the filters.

## Views are derived from schema, not chosen from a widget menu

The Notion insight (`prior-art.md`): **kanban is not a component — it is group-by over a field
with finite values.** A board's columns are the values of the grouped enum (native or derived).
The same logic gates every view:

| View | Requires | Notes |
| --- | --- | --- |
| stat | any collection | a count or aggregate over the (filtered) rows |
| list | any collection | title-role field leads if present |
| table | any collection | columns = projected fields, rendered per type |
| board | an `enum` field (native or derived) | columns = enum values; per-column sort/filter fall out of shaping |
| chart (later) | `number` (+ usually `datetime`) | defaults inferred from types, the Observable Plot principle |

The panel editor only offers views the schema supports and only offers group-by over
finite-valued fields — **misconfiguration is made unrepresentable rather than validated**, the
survey's fourth pattern.

## The motivating scenario, end to end

The personal todo board from `README.md`: columns `Todo / Doing / Waiting / Done`, populated by
GitHub PRs and Linear issues.

1. **Queries**: two entries — github's `pulls-mine`, linear's `issues-mine`.
2. **Mapping**: the user defines a **derived enum field** `my-status` with their four values.
   Per source, a value mapping: github `review-requested → Doing`, `approved → Waiting`,
   `merged → Done`, …; linear `In Progress → Doing`, `Done → Done`, …. Field roles let the host
   pre-fill most of this ("both collections have a status-role enum") for the user to edit.
   Unmapped values need a **declared destination**: a catch-all column, or hidden — never
   silently dropped.
3. **Shaping**: group-by `my-status`; sort within columns by the `updated`-role field (datetime is
   datetime everywhere, so cross-source sorting is well-defined); optional filters per the usual.
4. **View**: board. Each card renders its source's fields per type, with a **provenance badge**
   from the host's stamp, and its click action routed to the owning plugin's declared verb.

Note what did *not* happen: no plugin changed, no wire format grew, neither plugin knows the other
exists. **Cross-source composition is a client feature, not a wire feature** — the property to
protect in review when someone proposes "just let the plugin send its own board".

## The generated editor

The schema does triple duty (survey pattern 2): one declaration drives validation, the persisted
shape, and the *generated* editor. No panel settings UI is ever hand-written — hand-written
editors drift from their schemas. The internal vocabulary for the editor's inputs is
**selectors** (HA's word): typed, data-aware config inputs — "pick a collection" (grouped by
plugin), "pick a field of type enum", "pick a value of that field", "map these values onto those".
Each selector knows the schema it draws from, so the editor's choices are always valid by
construction. Selectors are also where plugin-hosted placement constraints bite
(`placements.md`): a constrained placement just narrows what the selectors offer.

## The persisted model

- **Versioned from day one.** Grafana's decade of schemaVersion migrations — and its current
  ground-up model rewrite — is the recorded cost of deferring (`prior-art.md`). acorn already has
  the discipline in `persistedState` (versions + codecs); the dashboard model uses the same
  posture even though it is host-owned config rather than a persisted-state slice.
- **Panel definitions persist independently of any surface; placements reference them** — the
  Perses layouts-reference-panels precedent. This is the cheap-now/expensive-later call:
  embedding panel config inside a "home dashboard" blob works until panels need to live in a
  second place (`placements.md`), and then it is a migration. Reference from day one.
- **Panel and dashboard definitions live on the owning node, in its per-user prefs store — never
  in device localStorage.** A user builds a board once and every client that pairs with that node
  renders it, and the agent can read it through `/v2` like everything else. This is the
  state-ownership rule (`docs/state.md § Scope rules`): state follows the resource
  it describes. The device's query cache stays the offline read fallback, as for every other
  node-backed read.
- Scoping is per-user-per-node (placement scope keys are in `placements.md`). A panel referencing
  a collection whose plugin is disabled or gone renders as an inert "source unavailable" panel and
  survives — the pane-layout unknown-ids rule applied here. User compositions are never
  collateral damage of toggling a plugin.

**As built,** it is the `core.dashboards` slice (`dashboards/persist.ts`): one `app`-scoped blob holding
panels by id and placements by scope key, version 1, codec hand-written and tolerant like every other
slice. Two extensions of the retain-inert rule the design named only for collections: a **view kind
this build cannot draw** is also retained and rendered inert rather than coerced, so a definition
written by a newer client round-trips through an older one; and a mixed panel degrades **per source**
rather than as a whole, going inert only when nothing resolves.

## Write-back: deferred, with the constraint recorded

Dragging a card between board columns means mutating the underlying field. v1 is **read-only**
(`refused.md`), but the mapping design must not paint us in:

- The hard part is not the mutation verb; it is that **value mappings are many-to-one and
  therefore not invertible**. GitHub `merged` and `closed` may both map to `Done`; dropping a
  card on `Done` has no unique answer.
- The eventual answer: a designated **write-value per (source, column)** in the mapping config,
  with drag disabled wherever none is set. So the mapping config's persisted shape should be a
  per-(source, column) record able to grow a `writeValue` field — not a bare value→column lookup.
- Mutation itself would need a declared per-field mutation contract on the collection (and all
  the trust questions that come with writes). None of that is designed here; only the storage
  shape is reserved.

## Verify before building

- The shared components a panel renders with: `Card`, `Table`, `EmptyState`, `StatusDot` and `Meter`
  all shipped and are on `@acorn/plugin-api/ui`. Build views on them rather than around them. Only
  `skeleton` was never built — a row-shaped loading shimmer; `EmptyState busy` covers whole-pane
  loading, which was most of the need.
- Whether `dataviz`-style chart infrastructure exists yet anywhere in the tree before designing
  the chart view (deliberately "later" here).
- The pane-layout inert-survival mechanism (`tasks/layout.ts`, `persistedState.ts`) — the
  "source unavailable" behavior mirrors it.
- Whether the query-key/persisted-cache conventions moved (`node/fleet.ts`, `node/fanout.ts`) —
  panel queries live inside them, and the persisted-cache buster gotcha applies to panel data.
- The context-menu contract that has since shipped (`docs/plugins.md § Context menus`) — panel
  rows and panel chrome should declare theirs through it, not invent one.

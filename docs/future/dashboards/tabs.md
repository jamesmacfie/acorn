# Tabs: multiple dashboards on Home

**The data model is BUILT (phase 0); the tab bar is not.** Behaviour for what shipped is in
[`docs/dashboards.md § Persistence`](../../dashboards.md); this file keeps the reasoning and owns the
unbuilt half — the bar, the verbs and the wizard's tab dimension (`README.md § build order`). One
sentence of design: **a tab is a home placement scope with an `ownerId`**, and everything else falls
out of machinery that already exists.

## The data model: no new concepts, one new list — SHIPPED

`persist.ts` carries it: `DashboardTab`, the `tabs` key on `DashboardState`, the codec with its two
caps, `homeTabScope`/`homeTabIdOf`, the `homeTabs` derivation, and the `setHomeTabs`/`removeHomeTab`
store actions. Tested in `persist.test.ts § home tabs`. Two notes for whoever builds the bar:

- **`homeTabs` always offers the default tab**, whether or not it holds panels — one line past the
  spec's literal "`tabs` ∪ orphaned keys", because the bare scope has no delete and must never become
  unreachable through a name list going missing.
- **Create, rename and reorder are all `setHomeTabs`** — names and order are the whole of what the
  key holds, so there is one write rather than three actions. `removeHomeTab` is separate only because
  it also drops the placement list and the geometry, and refuses the default tab.

The scope key already carries the segment (`persist.ts § placementScopeKey`):
`(surface, ownerId?, projectId?)`. The task pane and plugin regions already use `ownerId`; Home
just never has. So:

- A tab **is** the scope `{ surface: 'home', ownerId: <tabId> }` → key `home/<tabId>`. Its panels
  are ordinary placements, its geometry ordinary `layouts` entries. `PanelGrid` already takes a
  scope; rendering a tab is handing it a different one.
- **The default tab is the bare `home` scope** — id `''`, which `placementScopeKey` already
  collapses (trailing empties drop). Every existing blob is therefore a valid one-tab state with
  zero migration, and a user who never adds a tab never has one.
- Panel definitions stay surface-free and shared: the same panel can be placed on two tabs at two
  sizes, exactly as it can on Home and in the task pane today. Tabs multiply *placements*, never
  definitions.

What is genuinely new is names and order — one additive top-level key on the slice:

```ts
// persist.ts § DashboardState — additive, sibling of panels/placements/layouts
tabs?: Array<{ id: string; name: string }>
// id ''       = the bare home scope (the default tab)
// array order = display order
// absent, or length ≤ 1 → no tab bar; Home renders exactly as today
```

Codec rules, the usual posture: parse tolerantly (string id including `''`, non-empty name,
duplicates dropped keeping the first), cap **8 tabs** with names ≤ 60 chars — a person with nine
dashboards has a navigation problem tabs cannot fix. No version bump: additive, and both
degradation directions are defined below.

### Survival rules

- **The renderer derives the tab list as `tabs` ∪ orphaned `home/*` placement keys.** A
  placement scope that exists in `placements` but has no `tabs` entry renders as a recovered tab
  named "Untitled" (appended after the named ones). This single rule is simultaneously the
  old-client-write recovery and the partially-written-blob defence — placements are never
  collateral damage of a name list going missing.
- **The old-client ceiling, on the record** (same shape as `layouts`): an old client that *writes*
  the slice serialises only what it parsed, so `tabs` is dropped — names and order are lost, while
  every `home/<tabId>` placement, its panels and its geometry survive, and the recovery rule above
  resurrects them as Untitled tabs on the next new-client render. An old client *rendering* shows
  only the bare `home` scope (its renderer asks for exactly that key) — other tabs' panels are
  invisible there, intact, and return with a new client. Losing names and keeping compositions is
  the right way round.
- **Deleting a tab unplaces; it never deletes definitions.** Removing the tab removes its `tabs`
  entry, its placement list and its `layouts` entry; every definition survives in the library and
  on any other surface. The action is armed (arrangement and geometry are real work), with copy
  that says what survives: "Panels stay in your library and on other tabs." The default tab is not
  deletable — it is the bare scope, and "delete" of it would just be "empty it".

## UX

- **The bar exists only when there are two or more tabs.** One dashboard renders today's Home,
  pixel for pixel — no bar, no "1 of 1" chrome. The bar appears when the second tab is created and
  disappears when it goes; the feature costs nothing until used.
- **Placement:** the bar replaces the "Panels" section-header line, in the same position — tabs
  *are* the heading when there are several. The Add-panel button keeps its right-aligned seat on
  the same row. The active-tasks list above is untouched; tabs scope the panel area only.
- **Creating:** a ghost `+` at the row's end creates "New dashboard" with the name immediately in
  an inline rename (select-all), because a tab named "New dashboard" forever is what happens when
  rename is a separate trip.
- **Per-tab verbs** live in a small overflow on the active tab (and context-menu on any):
  Rename · Move left / Move right · Delete (armed). Reorder is menu-first, keyboard-operable by
  construction — the field-projection precedent.
- **The wizard's Place step** (`wizard.md`): when more than one tab exists, choosing Home offers
  the tab (default: the one you launched from), plus "New dashboard…" inline. "Move to…" on a
  panel lists tabs as destinations alongside the task pane — `placePanel`/`unplacePanel` already
  do the work.
- **Active tab is device view-state, not model state**: remembered per device (the rail-selection
  posture), never written to the node blob — which tab you were reading is not part of the
  composition. Mind the device-pref write-order gotcha if it lands as a device pref.

## UI and accessibility

Standard ARIA tabs, no invention: the bar is `role="tablist"` (`aria-label="Dashboards"`), each
tab `role="tab"` with `aria-selected`, the grid container `role="tabpanel"` labelled by the active
tab. Roving tabindex; **Left/Right arrows** move selection (activation on focus — switching is a
cheap, local render), **Home/End** jump, rename opens on **Enter** on the active tab's affordance
or F2. Visually: quiet text tabs in the section-header's own type scale, active tab in full ink
with a 2px accent underline, inactive muted with a hover wash; the `+` ghost matches the
Add-panel button's vocabulary. No counts in tabs — a tab is a name, not a stat.

Keyboard chords (e.g. cycling tabs from anywhere on Home) are deliberately not specced here: if
one is wanted it goes through the existing chord registry, not a tab-local listener.

## What this deliberately does not do

- **No per-tab settings** — refresh, columns and everything else stay per-panel or per-placement;
  a tab is a named scope, not a container with behaviour.
- **No tabs in the task pane** — the pane is one glanceable board beside work (`placements.md`
  settled per-pane keying); if someone wants more there, the `projectId` segment and this same
  mechanism exist, and the request should be argued then.
- **No syncing of the active tab across devices** — view state, per device, above.
- **No tab-level sharing/export** — out of scope with the rest of dashboards.

## Done when

- ~~The `tabs` key round-trips with the codec rules; the renderer derives named + recovered tabs;
  an old-client write loses only names/order, proven by a round-trip test.~~ Done.
- With one tab, Home is pixel-identical to today. Creating a second shows the bar; deleting back
  to one removes it.
- Create, inline-rename, reorder and armed delete all work, delete unplacing without touching
  definitions; the default tab is not deletable.
- The full ARIA pattern holds: arrows, Home/End, roving tabindex, `tabpanel` labelling — and
  every gesture the grid supports works identically inside any tab.
- The wizard places into a chosen tab; "Move to…" moves a panel between tabs keeping its
  definition and taking a fresh rect at the destination.
- The measure sampler needs no change: "placed in at least one scope" already counts any tab
  (`measure-history.md § Sampling`).

## Verify before building

- `persist.ts` — `placementScopeKey`'s empty-segment collapsing (the `''`-id default rests on
  it), the parser's treatment of unknown top-level keys on read and write (both ceilings above),
  and `panelsAt`/`layoutAt` taking arbitrary scopes.
- `Home.tsx` — where `HOME_PLACEMENT` is passed and where the "Panels" `SectionHeader` renders;
  the bar takes that seat.
- The wizard's Place step shape (`wizard.md`) and the "Move to…" submenu item (`README.md §
  smaller items`) — both grow a tab dimension.
- The chord registry, if a cycling shortcut is ever asked for.
- Device view-state conventions (rail-selection restore) for the active-tab memory.

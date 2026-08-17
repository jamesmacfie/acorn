# Tabs: multiple dashboards on Home

**SHIPPED.** Behaviour lives in [`docs/dashboards.md`](../../dashboards.md) — the model under
§ Persistence, the bar and its verbs under § Placements. This file keeps the reasoning: why a tab is
not a new concept, what the survival rules are defending against, and the four things it deliberately
does not do. One sentence of design: **a tab is a home placement scope with an `ownerId`**, and
everything else falls out of machinery that already exists.

Two notes for whoever touches it next, neither of them in the behaviour doc:

- **The creation door is in the wizard, not on Home.** The bar owns a `+`, but the bar only exists
  past one dashboard, and "one dashboard renders today's Home pixel for pixel" is a hard commitment.
  So the wizard's Place step always offers "New dashboard…", and it creates the tab at COMMIT rather
  than when the option is picked — the wizard's promise is that nothing is written until the last
  step, and a half-abandoned wizard leaving an empty dashboard behind would break it.
- **The bar is built once, in `Home.tsx`, and only conditionally handed to the grid.** Rebuilding it
  when the tab list changes would discard the inline rename that is *causing* the tab list to
  change. Solid props are lazy getters, so a stable element is still a reactive one.

## The data model: no new concepts, one new list

`persist.ts` carries it: `DashboardTab`, the `tabs` key on `DashboardState`, the codec with its two
caps, `homeTabScope`/`homeTabIdOf`, the `homeTabs` derivation, and the `setHomeTabs`/`removeHomeTab`
store actions. Tested in `persist.test.ts § home tabs`; the bar's own arithmetic — create, rename,
reorder as pure list transforms — is `homeTab.ts`, tested in `homeTab.test.ts`. Two notes:

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

## UX and accessibility

Behaviour is [`docs/dashboards.md § Placements`](../../dashboards.md); the reasoning behind it is one
line each. The bar exists only past one tab, because a feature should cost nothing until it is used.
It takes the section-header seat rather than a row of its own, because tabs *are* the heading when
there are several. Creating drops straight into rename, because a tab called "New dashboard" forever
is what happens when naming it is a second trip. Reorder is menu-first — Move left / Move right —
which is keyboard-operable by construction, the field-projection precedent. Delete is armed and its
copy says what survives, because arrangement is real work and the copy is the only place a person
learns their definitions are not at risk. And the ARIA is the standard tablist with nothing invented:
`ui/Tabs.tsx` was not reused only because a tab here carries an inline rename input and an overflow
trigger, neither of which can live inside a `<button role="tab">`.

No counts in tabs — a tab is a name, not a stat. Keyboard chords (cycling tabs from anywhere on Home)
are deliberately unspecced: if one is wanted it goes through the existing chord registry, not a
tab-local listener.

## What this deliberately does not do

- **No per-tab settings** — refresh, columns and everything else stay per-panel or per-placement;
  a tab is a named scope, not a container with behaviour.
- **No tabs in the task pane** — the pane is one glanceable board beside work (`placements.md`
  settled per-pane keying); if someone wants more there, the `projectId` segment and this same
  mechanism exist, and the request should be argued then.
- **No syncing of the active tab across devices** — view state, per device, above.
- **No tab-level sharing/export** — out of scope with the rest of dashboards.

## What shipped, and the one seat left empty

`persist.ts` holds the model; `homeTab.ts` the pure list verbs and the `core.home-tab` device slice;
`DashboardTabs.tsx` the bar. `PanelGrid` grew two optional props — a `heading` that replaces "Panels"
and, with it, keeps the header row on an empty placement, and the `tabpanel` wiring — so it is still
a component that draws one placement rather than one that knows about Home. The measure sampler
needed no change: "placed in at least one scope" already counts any tab
(`measure-history.md § Sampling`).

**"Move to…" lists tabs only.** Moving a panel to a *task pane* is the same two calls at a different
destination and is still the smaller item it always was (`README.md § smaller items`) — aiming at a
pane from Home puts a panel where nobody is looking, which is the argument the wizard's Where control
already makes. When someone wants it, `moveTargets` in `PanelGrid.tsx` is the one line that grows.

# Phase 9: the terminal client's keystroke

Status: **shipped 2026-09-03, with one half refused.** The focus store is indexed and asks `stopsIn`
once per move, the footer's hints are cached against the five things that move them, typing is a layer
at its own tier and the engine's active-key cache is on (`activeKeyCacheBlockers` 48 → 0 during
ordinary navigation), the rail and the shell hand `<For>` stable rows, `markersFor` sorts once per
registry change, the trace writes through a stream and carries a step count, and the diff pane windows
(5,303 renderables → 376 at 5,000 lines). **The `virtual` opt-ins did not ship** and the reason is in
[refused.md](./refused.md) § `virtual` opted in at the long-list sites in cells. Numbers in
[measurements.md](./measurements.md) § 2026-09-03 — phase 9.

## Goal

A key press in `acorn` does work proportional to the depth of the focus tree, not to the number of
renderables in the region. The footer computes its hints once per focus change. A list of two hundred
rows draws the rows that fit. This is [decisions.md](./decisions.md) decision 7, and
[tui-analysis.md](./tui-analysis.md) items 5 to 12 are the read behind it. It is held to the five
rules in [docs/tui.md](../../tui.md) § Keys and focus: fix a cost by naming the mechanism, never by
adding a settle step or a second keymap.

## Why this phase, and why now

`apps/tui/src/keys/regions.ts` is 1,071 lines and holds the focus model in three arrays: `groups`,
`parents`, `containers`. A move calls `stopsIn(box)`, a recursive walk of the region's subtree, and
for every child in the walk asks `groups.some(...)`, `parents.find(...)`, `containers.find(...)`, and
`isPanel(child)`, which calls `panels()` on every parent, and `panels()` in
`apps/tui/src/kit/grouping.tsx` allocates a fresh array each time. `moveStop` calls `stopsIn` twice
per key. Writing focus walks parents three more times, and the settle pass that follows may walk the
subtree twice more. None of this is wrong; it is O(nodes × regions) where O(depth) would do, and the
two-hundred-row lists below are what make the difference visible.

The footer makes it worse. `apps/tui/src/chrome/Footer.tsx` calls `activeHints()` in
`apps/tui/src/chrome/bindings.ts` during render, which calls `engine.getActiveKeys()` twice.
`@opentui/keymap` 0.5.9 caches active keys only while no registered layer, command, or binding
carries a runtime matcher, and this host puts `active: () => !typing()` on every bare-key intent
binding (`packages/client-core/src/kit/keys/keymapHost.ts`), on every resolved keybinding
(`apps/tui/src/keys/commandLayer.ts`), and on the column moves (`apps/tui/src/keys/install.ts`). One
such layer turns the cache off for the process. So each footer render collects every active layer
twice. The keymap has no way to toggle a layer; register and unregister are the only verbs.

Lists build every row. `Rows` in `apps/tui/src/kit/showing.tsx` is the only windowed list, and its
`virtual` prop is passed at three sites. The pull-request list, notes, changes, context, docker, and
the agents sidebar build one renderable per row. `DiffPane` in the same file says "There is no virtual
window here" and builds one `<text>` per diff line inside nested `<For>`s, then rebuilds an annotation
key string over every row per render. The rail hands `<For>` a fresh `.map()`ed array on every task
change, so every row renderable is destroyed and rebuilt, and `markersFor` in
`packages/client-core/src/host/registries/rail/railMarkerFeed.ts` copies and sorts the marker
registry per row per render.

## Scope

In:

- Indexes in `regions.ts`: a `Map<Renderable, Group>` for groups, a `WeakMap` for parents and
  containers, and a `Set` of panel renderables maintained by `grouping.tsx` when panels register, so
  `isPanel` is one lookup. `panels()` returns the stored array. `regionsInScope()` caches its sorted
  result until a region registers or unregisters.
- `stopsIn` once per move: `moveStop` computes the stop list and passes it to `walkStops`.
- `activeHints()` memoized on `(focusedRenderable, openOverlays, typing)`, so `getActiveKeys()` runs
  once per change rather than per render, and once rather than twice.
- The typing gate as a layer. The `active: () => !typing()` matchers go; instead a "typing" layer
  that shadows the bare keys is registered when an input takes focus and unregistered when it
  leaves. Each edge bumps the keymap's `cacheVersion` once, and `activeKeyCacheBlockers` returns to
  zero, so the engine's own cache holds between edges. The command layer's `active` on resolved
  keybindings follows the same rule where it expresses a typing gate; where it expresses something
  else, that something else becomes a layer too or stays as the one measured exception.
- `Rail.tsx` and `Shell.tsx` hand `<For>` stable objects (memoize the mapped rows by id) or use
  `<Index>`, which keeps the row renderable and swaps its data. `markersFor` sorts once per registry
  change behind a memo.
- `virtual` opted in at the long-list sites: the pull-request list, notes, changes, context, docker,
  the agents sidebar. Not defaulted; `virtual` changes the box's flex so the list grows into its
  panel, and a short list would stretch.
- `DiffPane` in cells windowed the way `Rows` is: one `ScrollViewport` whose content is the rows that
  fit plus overscan, with the file headers kept as anchors. Annotation keys rebuilt when the diff
  data changes, not per render.
- `ACORN_TUI_KEYS_TRACE` writes through an async appender so a trace does not measure itself.
- A step counter in `regions.ts`, incremented per node visited in any walk, exposed to the test
  harness behind the same flag the trace uses.

Out: the reconciler's per-element patch and per-child closure (tui-analysis.md item 8), measured
first with the counter and acted on only if they show. The rectangle's per-key intercept, which is
the contract. Any new settle step. Any change to the DOM host's `Rows` default (refused.md).

## Design

**Indexes are maintained at registration.** `registerRegion` writes the map and its cleanup deletes
the key; the same for parents and containers. `stopsIn` becomes a walk that does four map lookups per
node. The arrays that ordering depends on (`ordered()`) stay arrays but are rebuilt only when the
registry changes, behind a version counter.

**Hints are a memo.** `activeHints` becomes `createMemo` over the three signals it reads, and the
footer reads the memo. The `getActiveKeys()` call with and without metadata collapses to one call with
metadata, from which the plain list is derived.

**Typing is a layer, not a matcher.** `keymapHost.ts` keeps its intent bindings without `active`. A
`typingLayer` at the tier just above them binds the bare keys to a no-op that returns `false`,
letting the input's own handler take them, and is registered by the composer and the inputs on focus
and unregistered on blur. This is the same shape as the modal's key claim in
`docs/tui.md` § Traps: a scope, not a swallow.

**Windowing in cells is a slice.** The diff pane keeps its rows as data and renders `rows.slice(from,
from + fit + overscan)` under the viewport, moving `from` on scroll the way `Rows` does. File headers
are rows too, so an anchor is a row index. Focus stops inside the window are the only stops, which is
what the walk sees anyway once the window exists.

## Code touched

- `apps/tui/src/keys/regions.ts`, `apps/tui/src/kit/grouping.tsx`, `apps/tui/src/keys/stops.ts`.
- `apps/tui/src/chrome/bindings.ts`, `Footer.tsx`, `Rail.tsx`, `Shell.tsx`.
- `packages/client-core/src/kit/keys/keymapHost.ts`, `apps/tui/src/keys/commandLayer.ts`,
  `apps/tui/src/keys/install.ts`, `apps/tui/src/kit/asking.tsx` (the composer registers the layer).
- `packages/client-core/src/host/registries/rail/railMarkerFeed.ts`.
- `apps/tui/src/kit/showing.tsx`: `DiffPane`, and the `Rows` call sites in the plugin panes that opt
  in (each is a one-prop change in the plugin's client file).

## Tests

- `regions.test.ts`: a move in a 200-row region visits under `depth × 4` nodes per the counter;
  registration and cleanup keep the maps and the arrays in agreement.
- `keys.test.tsx`: after focusing an input, the engine reports `activeKeyCacheBlockers === 0` (read
  through the engine's stats) and a bare key reaches the input; after blur, the same key moves focus.
- `chrome.test.tsx`: the footer recomputes hints once per focus change (spy on `getActiveKeys`); a
  `tasks:changed` that reorders two tasks keeps the other rows' renderables.
- `reachability.test.tsx` still walks every stop on every surface with the four invariants holding.
  This is the property suite that says the indexes did not change the model.
- The pane suite at 80 by 24 for the diff pane with `ACORN_FIXTURE_PATCH_LINES` large: the first
  screen matches and the renderable count is bounded by the viewport.

## Docs owed

`docs/tui.md` § Focus regions: the indexes; § The five key groups: typing is a layer; § Scrolling
viewports: the diff pane windows; § Seeing what the keys did: the step counter. `docs/ui-design.md`
§ Every node at 80 by 24 if `Rows`'s terminal column changes.

## Done when

- A key press in a 200-row list visits under `depth × 4` nodes, per the counter.
- The footer recomputes hints once per focus change.
- The keymap's active-keys cache is on during ordinary navigation.
- The diff pane at 5,000 lines holds a bounded number of renderables and scrolls at the frame rate the
  rail scrolls at.
- `reachability.test.tsx` and `invariants.test.ts` are green unchanged.

## Verify before building

- Confirm `regions.ts` still holds arrays and `stopsIn` is still called twice per move. Read at
  `17a9acdf`.
- Confirm `@opentui/keymap` at the pinned version still blocks its cache on any matcher and still has
  no layer toggle. A newer version may change the typing design.
- Confirm `Rows`'s `virtual` still swaps the box's flex before opting a site in; if that changed, the
  default question reopens.
- Read `docs/tui.md` § Keys and focus in full first. Every change here must name the rule it serves.

### What that turned up, 2026-09-03

- **`regions.ts` was still 1,071 lines and still held the three arrays**, and `moveStop` still asked
  `stopsIn` twice — once to decide whether it owned the stop and again inside `walkStops`. Both true
  as written.
- **The keymap still blocks its cache on any matcher and still has no layer toggle**, and the counter
  is still global. It has no public stats API either, so the test that reads
  `activeKeyCacheBlockers` goes through the `keymap-extension-context` symbol and says so.
- **The phase's own sketch of the typing layer was wrong on the mechanism.** It said the layer should
  bind the bare keys "to a no-op that returns `false`, letting the input's own handler take them". A
  handler returning `false` is not handled, so dispatch carries straight on to the layer the shadow
  was meant to shadow. The spelling that works is `cmd: () => true` with `preventDefault: false`:
  handled inside the keymap, and the key still escapes to the focused renderable.
- **Removing the matcher from `registerIntentLayer` would have changed the desktop**, because that
  function is shared and the DOM host has no shadow. It is behind a `shadowsTyping` the terminal's
  installer passes; the desktop keeps its matchers and the same win is available to it later.
- **The typing shadow needed a tier, and there was no number between the collection's 40 and a stop's
  41.** `STOP` moved to 42 and the shadow is 41. That placement is the design rather than an accident:
  every layer that reaches a focused field from outside sits at or below it, and the two tiers above
  it are bound to an exact renderable by focus. `tiers.test.ts` now names eleven tiers and asserts the
  order.
- **The command layer's `enabled` on each command was a second blocker** the scope did not mention,
  and it alone would have kept the cache off. It is filtered where the layer is built.
- **`Rows`'s `virtual` still swaps the box's flex, and the prop is shared with the DOM host.** So it
  is never a one-prop change in a plugin's client file, the pull-request list already sets it, and the
  other five named sites cannot take it. See [refused.md](./refused.md).
- **The footer's cache needed a fifth key the scope did not name.** Memoising on
  `(focusedRenderable, openOverlays, typing)` is unsound on its own: a control mounting registers a
  layer and adds a key without any of the three moving, and the footer then keeps a stale list for the
  rest of the run. The engine does have a signal for it — its `state` event, which fires on focus
  changes and on layer registration — and the cache reads it as a revision counter.
- **The panel set could not be written beside the panels.** The scope asked `grouping.tsx` to maintain
  a set of panel renderables. Written there it is a second answer to "is this a panel" beside the
  strips' own `panels()` getters, and the region suite's fakes — which mark parents without going
  through the kit — proved it can disagree. It is derived from those getters and rebuilt when
  `panelsChanged()` says they moved.

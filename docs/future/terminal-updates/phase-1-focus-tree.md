# Phase 1: one focus tree, one settle pass, no shell in the keys module

Design, 2026-09-02. Not started. Depends on phase 0 only in that its tests press controls; the
refactor itself stands alone. Land it before phase 2, because phase 2 adds rules to the tree this
phase draws.

## Goal

`apps/tui/src/keys/regions.ts` describes the five levels in [focus-model.md](./focus-model.md) and
nothing else. The shell's knowledge arrives through one installed topology object. Every deferred
focus decision runs inside one settle pass. Parent stops are a general role with a recorded
parent-to-panels relation, not two `WeakSet`s of tab strips. Behaviour is unchanged for every
existing test.

## Why

[analysis.md](./analysis.md) findings 2, 3, 6, and 8. The module is correct case by case and
unreadable as a whole, and the class of bug the shell keeps finding is a race between two of its
six deferred decisions. This phase is the one place the programme spends a refactor, and it is
spent on the module every later phase edits.

## Requirements

### The topology

1. `regions.ts` exports `setTopology(topology | null)` beside `setPaneCycler`, and the shell calls
   it once from `chrome/Shell.tsx`. The type:

   ```ts
   type Topology = {
     /** Where Escape goes from the top of a main region. Null means "return false". */
     home: (region: RegionRef) => RegionRef | null
     /** The region that takes the keys when the screen first has regions. */
     opensOn: () => RegionRef | null
   }
   ```

2. `moveBack` asks `topology.home(current)` when the focused stop has no parent stop. The literals
   `'chrome'`, `'browse'`, and `'panes'` do not appear in `regions.ts`.
3. `moveColumn` picks the destination column's first region by declared order alone. The test
   `group.order >= 0` is deleted. The chrome keeps its negative orders, which already sort first.
4. The `opensHere` option is deleted. `regionFocus` no longer decides who opens the screen; the
   settle pass asks `topology.opensOn()` once, when the first region registers and nothing is
   focused. `chrome/Rail.tsx` moves its `menuOpens()` logic into the topology it hands the shell.
5. `column`, `enterMainOnActivate`, and `pickOnEnter` stay as region options. They are facts about a
   region a layout or the chrome declares, not facts about the shell, and each is read in one place.

### Parent stops

6. `markTabStop(node, entry)` and the two `WeakSet`s are replaced by
   `markParent(node, panels: () => Renderable[])`. A parent stop is focusable, and `panels()` returns
   the renderables whose subtrees it owns. `Tabs` calls it with its `TabPanel` boxes; phase 3 decides
   how a `Tabs` without `entry` finds them. `Sections` and the `tabs` layout keep passing their
   panels.
7. `parentOf(node)`: the nearest marked parent, by walking up from `node` and, at each ancestor,
   asking every parent registered in the same region whether that ancestor is one of its panels. A
   `WeakMap<Renderable, Renderable>` from panel box to parent, written by `markParent`, makes this a
   walk up with a lookup per step.
8. `moveBack` from a stop goes to `parentOf(stop)` if any, else to `topology.home(region)`. From a
   parent stop it goes to `parentOf(parent)` if any, else home. The reading-order backward scan for
   an entry strip is deleted.
9. `enterParent(parent)`: focus the first stop of the active panel, by the same entry rule a region
   uses (first parent stop, else first collection row, else first stop, else the panel box). `Tabs`
   binds `↓`/`j` to it in place of `moveFocusFrom(element, 1) || moveRegion(1)`. The pane strip in
   `chrome/PaneRow.tsx` is not a parent, so its `↓` keeps `moveRegion(1)`.
10. Region entry is: first parent stop, else first collection item, else first stop, else the box.
    The four-step `firstStop` becomes this three-step one plus the box. A filter `Tabs` with no
    panels is a plain stop and no longer needs a special case to lose to the rows below it.

### The settle pass

11. `regions.ts` exports `scheduleSettle()`. It queues `settleFocus()` at most once per turn with a
    single `queueMicrotask`, guarded by a boolean. This is the only `queueMicrotask` in
    `apps/tui/src/keys/` and there are none in `apps/tui/src/kit/`.
12. `settleFocus()` runs the five steps in [focus-model.md](./focus-model.md) § The settle pass in
    that order and nothing else. Each step is a named function of at most fifteen lines.
13. The six call sites in [analysis.md](./analysis.md) finding 3 become synchronous writes to the
    store plus `scheduleSettle()`:
    - `regionFocus` registers and schedules. Step 2 opens the screen.
    - `markItem` cleanup marks the region provisional if its focused row is going and schedules.
      Step 1 re-enters.
    - `takeFocus` records `previous` synchronously and schedules. Step 4 lands in the overlay on the
      first settle after open and restores on the first settle after close.
    - `collection.ts` § `attach` drops its effect. Step 3 claims a provisional region when a row
      exists, and step 1 re-lands after a refetch destroyed the row. Rows arriving after a query is
      the ordinary case, so `Rows` calls `scheduleSettle()` from its `ref` and from its items memo.
    - `showing.tsx` § `Rows` window effect becomes: after the window moves, if the container has
      focus and the active row is drawn, focus the row, synchronously.
14. `provisional` stays, as one boolean, written by `enter` and read by step 3. `opened` is deleted;
    step 2 checks `focusedRenderable() === null`.
15. Identity: `itemsByIdentity` stays and is the only way a region remembers a row. `group.last`
    becomes `lastIdentity` for items and a `WeakRef`-free `last` for plain stops. `replaceFocusable`
    becomes a `scheduleSettle()`.

### Boundaries

16. `regions.ts` imports nothing from `chrome/` or `kit/`. `tools/arch/boundaries.test.ts` gains the
    rule if it does not already refuse the import.
17. The public surface of `regions.ts` after this phase, and nothing more: `focusedRenderable`,
    `focusWithin`, `focusedRegion`, `regionFocus`, `registerRegion`, `noteFocus`, `focusRenderable`,
    `markItem`, `markParent`, `parentOf`, `enterParent`, `moveRegion`, `moveColumn`, `moveBack`,
    `movePane`, `activationEntersMain`, `takeFocus`, `scheduleSettle`, `setPaneCycler`,
    `setTopology`, `_resetRegions`. `claimIfProvisional`, `replaceFocusable`, `markTabStop`, and
    `moveFocusFrom` are deleted, the last replaced by phase 2's `moveStop`.

## Design notes

**Why a microtask and not a frame event.** OpenTUI's renderer emits per frame, but a test renderer
under `flush()` may render several times before a frame, and a settle that waits for a frame waits
for the wrong thing. Solid commits synchronously and the renderables exist at the end of the current
task, which is exactly when a microtask runs. One microtask, not six, is the whole change.

**Why keep `pickOnEnter` on the region.** The alternative is a `Rows` prop, and a kit prop ripples
into every plugin list on both hosts. A region option is this host's and touches two call sites in
the chrome.

**Why `parentOf` is a lookup and not a tree walk to the strip.** A `Tabs` strip is a sibling of its
panels, not an ancestor. Walking up from a stop never reaches it. The panel box is what the walk
reaches, and the map from panel to parent is the missing edge.

**What happens to the tests.** `apps/tui/src/keys/regions.test.ts` builds fake renderables and calls
the module directly. Every case in it should pass unchanged except the ones that call
`markTabStop` or `claimIfProvisional`; rewrite those to `markParent` and to `scheduleSettle` plus an
awaited microtask. `spatial.test.tsx`, `sections.test.tsx`, `browse.test.tsx`, `workspaceFocus.test.tsx`,
and `chrome/chrome.test.tsx` must pass without edits. They are the behaviour this phase promises to
preserve.

## Files

- `apps/tui/src/keys/regions.ts`: most of the phase.
- `apps/tui/src/keys/collection.ts`: drop the `attach` effect; call `scheduleSettle`.
- `apps/tui/src/kit/showing.tsx` § `Rows`: the window effect; `scheduleSettle` on mount and on items.
- `apps/tui/src/kit/grouping.tsx` § `Tabs`, `Sections`: `markParent`, `enterParent`.
- `apps/tui/src/layouts/Tabs.tsx`: pass panels to `markParent`.
- `apps/tui/src/chrome/Shell.tsx`, `apps/tui/src/chrome/Rail.tsx`: build and install the topology;
  delete `opensHere`.
- `apps/tui/src/chrome/PaneRow.tsx`: the strip is not a parent; confirm `↓` still cycles.
- `tools/arch/boundaries.test.ts`: the import rule.

## Tests

- `regions.test.ts`: `parentOf` finds a strip through its panel; `moveBack` from a stop in a panel
  lands on the strip and from the strip lands on `topology.home`; `home` returning null makes
  `moveBack` return false; `settleFocus` with a destroyed focused row re-enters by identity; two
  `scheduleSettle` calls in one turn run one settle.
- A grep test in `apps/tui/src/renderGuard.test.ts` or in `apps/tui/src/invariants.test.ts` (new):
  `queueMicrotask` occurs once under `apps/tui/src/keys/` and zero times under
  `apps/tui/src/kit/`. This is invariant 5.
- Every existing shell test passes unchanged.

## Acceptance

- Requirements 1 to 17 hold.
- `regions.ts` is under 350 lines. The number is a smell threshold, not a rule; if it is over,
  say what earned the lines.
- `pnpm lint` and `pnpm --filter @acorn/tui test` are green.

## Doc moves when it ships

`docs/tui.md` § Focus regions is rewritten from [focus-model.md](./focus-model.md) § The five levels
and § The settle pass. `docs/command-palette-and-shortcuts.md` § Focus and typing, the two terminal
paragraphs, shrink to a pointer at `docs/tui.md`. This file shrinks to a pointer.

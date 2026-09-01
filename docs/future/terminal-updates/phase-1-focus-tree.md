# Phase 1: one focus tree, one settle pass, no shell in the keys module

Shipped 2026-09-02. [docs/tui.md](../../tui.md) § Focus regions owns the behaviour, and
[docs/command-palette-and-shortcuts.md](../../command-palette-and-shortcuts.md) § Focus and typing
points at it. [focus-model.md](./focus-model.md) still holds the target the later phases build
towards.

`apps/tui/src/keys/regions.ts` now describes the five levels and nothing else: `setTopology` carries
the shell's arrangement, `markParent`/`parentOf`/`enterParent` carry the parent-stop relation, and
`scheduleSettle` queues the one deferred decision. `apps/tui/src/invariants.test.ts` (new) holds the
keys folder to one `queueMicrotask` and the kit to none, and `tools/arch/boundaries.test.ts` refuses
an import from `keys/` into `chrome/` or `kit/`.

## Where the design changed, and why

Five requirements did not survive contact. Phase 2 reads this list, not the requirements they
replace.

1. **The topology has a third member, `skips`.** Requirement 3 deleted `moveColumn`'s `order >= 0`
   test and left the first crossing into main landing on the pane strip, which `spatial.test.tsx`
   pins as landing in the pane. A number the chrome chose is the wrong way to say "this is chrome";
   a predicate the shell installs is the right one, and it deletes the number.
2. **`home` returning null means the column edge, not `false`.** From a rail region `moveColumn(-1)`
   is already `false`, so the shell's Escape layer still clears a notification; from a main region
   with nothing above it, falling to the column keeps the behaviour the literals used to give. The
   alternative was to have the shell name the rail region to return to, and the answer to that is
   `lastByColumn`, which is the keys module's.
3. **`moveFocusFrom` survives.** Requirement 17 deleted it and requirement 9 replaced the `Tabs`
   Down binding with `enterParent`, but a strip with no panels — GitHub's Open/Closed filter — still
   has to reach the field and the rows below it. The binding is
   `enterParent(element) || moveFocusFrom(element, 1) || moveRegion(1)`. Phase 2's `moveStop` takes
   the middle term.
4. **`focusedItem` and `stopsIn` stay exported.** Requirement 17's list omits both, and both have a
   live caller outside the module: the footer asks whether the keys are on a row
   (`chrome/bindings.ts`), and a `Menu`'s open list walks its own stops (`keys/stops.ts`).
   `firstStop` did go — it is `entryStop` and it is internal.
5. **`parentOf` scans registered parents instead of reading a `WeakMap`.** Requirement 7's map from
   panel box to parent needs the panels at `markParent` time, and a strip's panels mount after its
   own `ref` runs and change with its tabs. The parents are a list of `{ node, panels() }` and the
   walk asks each one per ancestor, which for the handful of strips on a screen is cheaper than
   keeping a map correct.

`regions.ts` is 332 lines of code and 212 of comment against the 350 the acceptance asked for. The
comment half is what earned the total: every rule in it has the bug it prevents written beside it.

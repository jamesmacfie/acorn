# Phase 6: the properties, the footer, and the docs

Design, 2026-09-02. Not started. Last, because it asserts what the other phases built, but its
first two tests can be written early and left red as the programme's own progress bar.

## Goal

The eight invariants in [focus-model.md](./focus-model.md) § The invariants are tests over the pane
roster, not scenarios per bug. The footer says what the key under the caret does. `docs/tui.md` and
`docs/command-palette-and-shortcuts.md` describe the build. This folder is deleted.

## Why

[analysis.md](./analysis.md) findings 10, 11, and 12. The suites read the right instrument and pin
the right things one case at a time, which is how a class of bug gets fourteen fixes. A property over
every pane at two sizes catches the fifteenth before a reader does.

## Requirements

### The harness

1. `apps/tui/src/harness.tsx` gains two helpers on the returned screen:
   - `caret(): Promise<{ region: RegionRef | null; text: string }>`: the focused region and the
     text of the caret line, or of the focused control's own line.
   - `reach(text, steps = 40): Promise<boolean>`: presses Tab, then `↓`, then `→`, then Enter on a
     parent stop, in a fixed breadth-first order, until the caret line contains `text` or the budget
     is spent. This generalises `caretOn` in `spatial.test.tsx`.
2. A test-only export from `regions.ts`, `_allStops(): Renderable[]`: every visible focusable
   renderable on screen, by the same `stopsIn` walk phase 2 wrote, applied to every region.

### The properties

3. **Reachability** (invariant 1), `apps/tui/src/reachability.test.tsx` (new): for each first-party
   pane in the roster, and for each browse source in the fixture, at 80 by 24 and 120 by 40, every
   renderable in `_allStops()` is reached by `reach()` within the budget. The test names the pane, the
   size, and the label of the first stop it could not reach.
4. **Acting** (invariant 2): the coverage test phase 0 added to `kit.test.tsx` stays, and this file
   checks that every `NODE_FOCUS` entry with a `stop`, `collection`, or `conditional` role has a
   behaviour case by name.
5. **One caret** (invariant 3): after every press in the reachability walk, the frame holds at most
   one `›` and at most one control drawn in the accent-focused form. Read the spans, not the
   characters, because the focused form is a tone.
6. **Bounded Escape** (invariant 4): from every stop reached in requirement 3, count parent stops
   above it with `parentOf`, press Escape that many times plus one, and assert `focusedRegion()` is
   a rail region and the caret line is the row that was active in that region when the walk left it.
7. **One deferred decision** (invariant 5) and **no `super+`** (invariant 7): the grep tests phases 1
   and 3 added, kept in `apps/tui/src/invariants.test.ts` (new in phase 1).
8. **No corpse** (invariant 6): after every press in the walk, `focusedRenderable()` is attached and
   visible. One assertion in the walk loop.
9. **Footer truth** (invariant 8): after every press in the walk, every key the footer names is in
   `engine.getActiveKeys()` at the focused renderable.

### The footer

10. `apps/tui/src/chrome/bindings.ts` chooses its word from what has focus, read off the region
    store: on a row `enter open`; on a plain stop `enter press`; on a parent stop `j enter` and
    `h/l tab`; on a viewport with no stops `j/k scroll`; on a plain stop inside a panel `j/k move`;
    inside a field `ctrl+enter send · esc back`; on a `Select` `enter open`. The words are a table
    in that file, one row per focused kind, and the test in requirement 9 reads them.
11. The cheat sheet (`?`) lists the same hints with the `detail` sentence each, unchanged in
    mechanism.

### The docs

12. `docs/tui.md` §§ Keys and focus, Focus regions, Collections, Scrolling viewports, Navigation,
    and What a plugin loses here are rewritten from [focus-model.md](./focus-model.md) and the
    shipped phases, in the present tense, describing the build. The five levels, the five key groups,
    the settle pass, and the invariants land there as the owning text.
13. `docs/command-palette-and-shortcuts.md` § Focus and typing keeps the shared rules and reduces
    the terminal paragraphs to a pointer at `docs/tui.md` § Keys and focus.
14. `docs/ui-design.md` § Every node at 80 by 24 is checked line by line against `kit.test.tsx`'s
    behaviour cases. Any sentence a case does not cover gets a case or loses the claim.
15. `docs/testing.md` § Test layers gains the reachability and invariants files.
16. `docs/future/README.md` moves this folder to the retired list with one sentence per phase
    saying where its behaviour went, and the folder is deleted in the same commit.

## Design notes

**Why properties and not more scenarios.** A scenario pins one path. The bugs in the fourteen commits
were each a path nobody wrote a scenario for. The walk visits every stop on every pane at two sizes,
and a new pane or a new control joins the property the day it lands.

**Why the walk is breadth first with a fixed key order.** So a failure is reproducible by hand: the
message says "pane `pr`, 80 by 24, could not reach `[Merge]` in 40 presses", and a person can press
the same 40 keys.

**Budget.** The roster is eight panes and four sources at two sizes, each walked once. Each press is
about 100 ms under the harness. Expect a minute on a warm worker. If that is too slow for the suite,
the walk runs once per pane at 80 by 24 in the default suite and at 120 by 40 behind an environment
flag, and CI runs both.

## Files

- `apps/tui/src/harness.tsx`: `caret`, `reach`.
- `apps/tui/src/keys/regions.ts`: `_allStops`.
- `apps/tui/src/reachability.test.tsx` (new), `apps/tui/src/invariants.test.ts` (new if phases 1
  and 3 did not create it).
- `apps/tui/src/chrome/bindings.ts`: the word table.
- `docs/tui.md`, `docs/command-palette-and-shortcuts.md`, `docs/ui-design.md`, `docs/testing.md`,
  `docs/future/README.md`.

## Acceptance

- Requirements 1 to 16 hold.
- The reachability test passes for every pane and source at both sizes with no exclusions. A pane
  that needs an exclusion is a finding, and the finding is fixed rather than excluded.
- `pnpm lint`, `pnpm --filter @acorn/tui test`, and `pnpm --filter @acorn/arch-tests test` (the
  docs path check) are green.
- The folder is gone.

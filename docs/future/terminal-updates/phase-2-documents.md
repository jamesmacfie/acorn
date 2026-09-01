# Phase 2: stops inside scrolling content

Design, 2026-09-02. Not started. Depends on phase 0 (there are stops to move between) and phase 1
(`parentOf` and the settle pass exist).

## Goal

Inside a panel or a document viewport that holds stops, `↓`/`↑` and `j`/`k` move between stops in
reading order and reveal each one. Page keys, Home, and End scroll the viewport regardless. A
viewport with no stops keeps arrows for scrolling. Escape from any stop climbs one level. A reader
can reach every control in the pull-request Details, Labels, Checks, Reviewers, and Comments panels
without a pointer, and can still read a long description.

## Why

[analysis.md](./analysis.md) findings 6 and 7. Phase 0 puts stops inside documents for the first
time, and today's `focusStops` walk has one rule for them: a viewport is a stop only while empty.
That leaves "what do the arrows do in a document with one button" undecided, and a decision made in
the component that hits it first would be a special case. [focus-model.md](./focus-model.md) § The
five key groups decides it once; this phase builds it.

## Requirements

1. `regions.ts` exports `moveStop(delta: 1 | -1): boolean`. From the focused stop it finds the
   stops of the enclosing panel (the nearest ancestor that is a parent's panel, else the region box)
   in reading order, and focuses the adjacent one. At an edge it returns `true` and does nothing:
   an edge is a wall, as it is on a tab strip. It returns `false` only when the focused thing is not
   a stop it knows.
2. Reading-order stops of a box, `stopsIn(box)`: depth first over visible, non-destroyed
   renderables; a parent stop counts once and its panels are not descended into; a collection
   container counts once as its active row; a `ScrollViewport` is transparent when it holds a stop
   and is itself a stop otherwise; a `focusable` renderable counts and is not descended into.
   This is today's `focusStops` with the collection rule added and the parent rule generalised.
3. The `next`/`prev` intents are bound at priority 40 in `focus` mode on every plain stop by
   `pressable`, calling `moveStop`. A collection's own `next`/`prev` answer first because focus is on
   its row, not on a plain stop. A `ScrollViewport` that is a stop keeps its scroll bindings from
   `apps/tui/src/kit/scrolling.tsx`.
4. `pageNext`, `pagePrev`, `first`, and `last` are bound at priority 30 in `focus-within` mode on
   every `ScrollViewport`, scrolling by half a page and to the ends. A collection inside the viewport
   answers them first at 40, which is right: Home in a list goes to the first row.
5. Every focus move reveals: `noteFocus` already calls `scrollChildIntoView` on every enclosing
   `ScrollBoxRenderable`. Confirm it runs for `moveStop` and for `enterParent`.
6. Escape from a stop goes to `parentOf(stop)`, else `topology.home(region)`. Escape from a
   `Textarea` or `Input` is the same move; `dismiss` is typing-exempt so it fires inside a field.
   Nothing is submitted on Escape.
7. A `Fold` header is a stop and its children are in reading order after it while open. A closed
   fold's children are not stops. `↓` from an open fold's header lands on its first child; `↓` from
   its last child lands on whatever follows the fold. Escape from inside a fold goes to the panel's
   parent strip, not to the fold header: a fold is not a parent stop, because it does not own a
   panel the reader switches between.
8. A `Card` with `onPress` is a stop and its children are in reading order after it. A `Card` without
   one is transparent.
9. `Timeline` and `Timeline.Turn` are transparent; the cards and composers inside them are the stops.
   `focusRoles.ts` says `Timeline` is a collection, and on the DOM it roves over turns. On this host a
   turn is a `Card` and cards are stops or transparent by requirement 8; roving over turns is not
   built. Record the deviation in `docs/tui.md` when this ships, beside `Grid`'s.
10. `Log` is a stop: a viewport of lines with no controls, which is what requirement 2 already makes
    it when drawn inside a `ScrollViewport`. Confirm it draws inside one.
11. `DiffPane` is transparent, its viewport is a stop while it holds no per-line control, and a
    per-line control (phase 5 may add one for `github:diff-line`) is a stop in reading order.

## Design notes

**Why arrows move and page keys scroll.** A footer can say `j/k move · pgdn scroll` and both words
are true everywhere. The hybrid where `↓` scrolls until the next stop is visible is refused in
[refused.md](./refused.md) § Scroll-then-jump.

**Why edges are walls.** Letting `↓` at the last stop bubble to the region tier would make it cross
regions, which Tab already does and which surprised readers when the strip did it. `↑` at the first
stop of a panel does not climb to the strip either: Escape does, and one key per direction is the
rule the strip already keeps.

**Text between stops.** A long description with a `CopyButton` at the top and nothing else: `↓`
from the strip lands on the button, `↓` again is a wall, and the description is read with `pgdn`
and the wheel. A description with no control at all: `↓` lands on the viewport and scrolls. Both are
what the footer will say.

**What `stopsIn` costs.** A walk of the panel subtree per keypress. A pull request's Comments panel
is a few hundred renderables. If a measurement shows a walk over a thousand-row `Rows` is slow,
`Rows` marks its container so the walk takes the active row and skips the children; requirement 2
already asks for that.

## Files

- `apps/tui/src/keys/regions.ts`: `moveStop`, `stopsIn`, the Escape rule.
- `apps/tui/src/keys/stops.ts` (new in phase 0): bind `next`/`prev`.
- `apps/tui/src/kit/scrolling.tsx`: page keys at 30; drop `up`/`down`/`j`/`k` from the viewport's
  own bindings when it is not a stop, which requirement 2 decides at walk time. The simplest form: the
  viewport keeps its bindings and `moveStop` is tried first by priority; a viewport that is not a stop
  never has focus, so its bindings never fire.
- `apps/tui/src/kit/grouping.tsx`: `Fold` children order; `Card` transparency; `Timeline`.
- `apps/tui/src/kit/showing.tsx`: `Log`, `DiffPane`.

## Tests

- `apps/tui/src/kit/scrolling.test.tsx`: a viewport with two buttons and a paragraph between them:
  `↓` lands on the second button and the frame shows it revealed; `↓` again does nothing; `pgup`
  scrolls back so the first button is visible while focus stays on the second.
- `apps/tui/src/sections.test.tsx` or a new `apps/tui/src/pullControls.test.tsx` (new): the worked
  example in [focus-model.md](./focus-model.md) § Worked example, press for press, asserting
  `focusedRegion()` and the caret line after each.
- `regions.test.ts`: `stopsIn` on a fixture tree with a parent, a collection, a viewport with a stop,
  and a viewport without one returns the expected order.

## Acceptance

- Requirements 1 to 11 hold.
- The worked example passes as written, at 100 by 32.
- Every existing test passes.

## Doc moves when it ships

`docs/tui.md` § Scrolling viewports is rewritten from [focus-model.md](./focus-model.md) § The five
key groups, rows Move and Page. The `Timeline` deviation lands beside `Grid`'s in
`docs/command-palette-and-shortcuts.md` § Focus and typing. This file shrinks to a pointer.

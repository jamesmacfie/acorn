# Phase 2: stops inside scrolling content

Shipped 2026-09-02. [docs/tui.md](../../tui.md) § Focus regions owns the reading-order walk and
§ Scrolling viewports owns the split between the arrows and the page keys.
[docs/command-palette-and-shortcuts.md](../../command-palette-and-shortcuts.md) § Focus and typing
carries the `Timeline` deviation beside `Grid`'s.

`apps/tui/src/keys/regions.ts` grew `moveStop` and a `stopsIn` with four rules instead of three: a
parent's panels are skipped, a collection counts once as the row its caret is on, a viewport is
transparent while it holds a stop, and anything else focusable counts once. `pressable` binds
`next`/`prev` on every stop, and `ScrollViewport` splits its keys in two — the arrows stay on the
viewport's own focus layer, the page group moves to a focus-within layer so it reaches a reader
standing on a control halfway down the panel.

## Where the design changed, and why

Four requirements did not survive contact.

1. **The `Tabs` Down binding keeps `moveFocusFrom`.** Requirement 1 walls at an edge and the phase
   asked for `moveStop` in that binding, which makes the `moveRegion(1)` term after it dead. The
   task-pane strip is a region of one stop whose Down edge has to reach the pane below it, which
   `sections.test.tsx` and `controls.test.tsx` both pin. So the two walks are both live and the
   difference between them is the whole reason: `moveStop` is the reader-facing one and walls,
   `moveFocusFrom` is a strip's and falls through.
2. **`next` and `prev` are bound at the stop's own priority, 41, not at 40.** The reason for 40 was to
   let a collection answer first from a row. It answers first anyway: a row is not a `pressable`, so
   it carries no stop layer, and `moveStop` returns false for a row and for anything else the walk
   does not own. A second layer one number lower would buy the same answer and one more layer per
   control on screen.
3. **A `Card` with `onPress` is one stop and its children are not walked.** Requirement 8 asked for
   the children in reading order after it, which contradicts requirement 2's rule for a focusable
   node. Requirement 2 wins, because the alternative is a walk that descends into every control on
   screen to find the handful of nodes that are both a stop and a container. No first-party pane draws
   a pressable card with controls in it; the pull request's conversation cards take no press, so the
   reply composer inside one is reachable. The loss is written down in
   [docs/tui.md](../../tui.md) § What a plugin loses here.
4. **`moveStopIn` stays in `apps/tui/src/keys/stops.ts`.** The phase asked for it to be generalised
   into `moveStop`. It is four lines, its caller is an open `Menu`, and it differs in both of the
   things that matter: the box is handed to it rather than derived from focus, and landing on the
   first stop when focus is outside the list is what an overlay wants and what a panel does not.

Requirements 5, 6, 7, 9, 10 and 11 needed no code. `noteFocus` already reveals through every enclosing
scrollbox; Escape already climbs through `parentOf`; a `Fold`'s children are siblings drawn after its
header, so reading order is already header then contents; `Timeline` and its turns are plain boxes;
and `Log` and `DiffPane` both draw inside a `ScrollViewport` that becomes the stop where they hold no
control of their own.

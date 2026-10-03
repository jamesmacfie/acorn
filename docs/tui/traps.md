# Terminal dialogs and rectangles

This page covers how dialogs and entered PTY rectangles hold the keys in the terminal client. It's
part of [the terminal client](../tui.md).

## Traps

A trap is a scope. `apps/tui/src/keys/regions.ts` keeps a stack of them. The bottom is the screen,
and a `Modal` or an open `MenuList` pushes its own box while it's drawn. Every question the store
answers is answered inside the top scope: which regions are on screen, which stops a walk can see,
where Tab goes, and where Left goes. Nothing behind the top scope exists for the keys, so a key with
nothing to reach does nothing. It's a stack because a `Menu` inside a `Modal` is a second scope, and
closing it must leave the dialog holding the keys.

`keys/trap.ts` has one layer, for `dismiss` at tier 60. It's global, because a layer bound to a target
only fires with focus inside it, and Escape has to close the dialog from anywhere. The palette's own
arrows sit one tier above it.

A trap can't be a swallow, a layer that claims every intent except `dismiss`. A swallow has to name
every key it claims, and any key it misses leaks. One once missed Tab, which this host adds to
`nextRegion`, so Tab walked the keys onto a rail row behind the trust prompt. A scope names nothing.

Two rules follow. The command layer's bare keys, `w`, `p`, `;`, `n`, `q`, and `?`, fire only at the
screen's own depth, so pressing one in a dialog doesn't open a picker over it. Chords work at every
depth. And the footer asks the store, not the engine, whether the region Tab is live, so it shows `tab
region` only while more than one region is in scope.

`Modal` calls `pushScope` from its box's `ref` and pops it in `onCleanup`. So a dialog takes the keys,
lands them on its first stop by being drawn, and gives them back to the node that had them when it
closes. A plugin's dialog gets this from the kit.

## The Rectangle contract

A rectangle is one tab stop from outside. Enter hands the keys inside, and Escape takes them back. A
`pty` rectangle owns its keys through an intercept above every layer, because a layer answers keys it
can name and a rectangle answers all of them. `PtyRectangle` registers the intercept and consumes what
it takes. Keys reach the emulator through `encodeKey` (`apps/tui/src/kit/ptyKeys.ts`), because
headless xterm has no keyboard.

Being entered is a fact about the screen, not a stored flag. A rectangle is entered while you've
pressed Enter since its box last lost the keys, the box has the keys, and the box is visible all the
way to the root. The intercept checks all three when a key arrives. The store's focus signal clears
the stored Enter. A flag would go stale, because `visible` is per node: hiding an ancestor leaves the
rectangle's box reporting itself visible, and a hidden rectangle would take every key in the app,
`Ctrl+C` included.

The footer asks the same question of every mounted rectangle, instead of counting entered ones,
because two can be mounted at once, such as a terminal pane beside a Docker exec.

Escape alone leaves. A second Escape within 400 milliseconds goes back in and sends one Escape, which
is how you reach vim's normal mode. The first press doesn't wait to see if a second follows, so leaving
has no delay. Leaving moves the keys through `focusRenderable`, so the rectangle's region sees them
return.

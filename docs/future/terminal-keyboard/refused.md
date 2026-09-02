# Terminal keyboard: refused

What this programme decided not to do, and why, so a later session argues with the reasoning rather
than with silence. Dated 2026-09-02 with the rest of the folder.

## A second keymap, `useKeyboard`, or `onKeyDown` in a node

`@opentui/solid`'s `useKeyboard` is `renderer.keyInput.on('keypress')`: global, unscoped, and it
runs after the keymap engine has had the key. `onKeyDown` fires only on the focused renderable
itself, never on a container. Neither can express "inside this dialog" or "in this region". The
keymap's layer model can, and the whole app is on it. `docs/tui.md § What must never happen` stands.

## Building on OpenTUI's `Select` and `TabSelect`

They are single-slot widgets with their own key tables (`up`/`k`, `down`/`j`, `return`), opt-in
wrapping, no Home/End/PageUp/PageDown, no roving focus across a mixed tree, and no notion of a
region. The kit already owns collections on both hosts through `collectionIntents.ts`, and a
plugin's `Rows` works the same on the desktop. Adopting them would be a second collection model for
one host.

## Porting the DOM's `trap.ts`

The desktop contains Tab inside a modal by walking focusable elements. Here a trap is a scope, and
a scope makes the walk unnecessary: nothing outside it is in the universe the walk sees.

## Waiting for an OpenTUI release

0.5.10's release notes touch images, markdown streaming, and native symbols. 0.5.7 to 0.5.9 touch
nothing about focus or keys either. There is no traversal or focus manager coming that this
programme should wait for, and the layer model it builds on has been stable across those releases.

## Column wrap

Left from the rail does not go to main. Right from the rightmost region does not go to the rail.
The retired `terminal-updates/` programme refused this and the reasoning holds: a key that jumps
across the whole screen from an edge is a surprise, and Tab already cycles.

## Keeping "a tab edge is a wall"

The retired programme made Left on the first tab of a strip do nothing, because letting it bubble
"made the first tab unexpectedly throw the reader back into the rail". This programme reverses
that, on the user's decision on 2026-09-02, because it was one of five different meanings for the
same key. The rule is now one sentence: Left with nothing to the left goes one column left, in every
control. The surprise the old rule guarded against is smaller than the inconsistency it caused, and
the footer says `column` when that is what the key will do.

## A settle step, a flag, or a priority for a new case

The baseline's `settleFocus` grew from one step to seven this way, each a correct fix. The next
focus bug is fixed by finding which of the five rules in [design.md](./design.md) it breaks, not by
adding a step. If a rule is wrong, change the rule and its test.

## Distinguishing `selected` from focus in the cell buffer

Invariant 3's lit-control half stays unchecked. `selected` draws `role="match"` and focus draws
`strong` and `accent`, and an active tab label draws the same, so a span count cannot tell them
apart. Making them distinguishable is a `kit/roles.ts` question with desktop parity to think about,
and it is out of this programme's scope.

## Replacing the reconciler's `nextTick` deferral

`kit/reconciler.ts` defers destruction to `process.nextTick` for Solid's `Suspense`
(`docs/tui.md § Destroy on disposal`). The baseline's settle pass depends on that ordering by
accident. After rule 3 nothing in focus depends on it, and it stays for the reason it was written.

# Phase 1: one owner of the keys

Status: not started. Waits on phase 0's spike 1. Independent of phase 2 and worth shipping alone.

## Goal

After this phase there is exactly one answer to "what has the keys" in the terminal client, and it is
a value the region store holds. OpenTUI's renderer still paints, and its own notion of focus is still
there, but nothing reads it. The keymap engine stays, shared with the desktop, and reads focus from
the store through a host adapter of ours instead of from the renderer. The navigation fault class in
[review.md](./review.md) § 2d ends here, before the painter changes, because it was never a painting
fault.

## Why this phase, and why now

The region store in `apps/tui/src/keys/regions.ts` is a good model wearing the wrong mechanism.

The model is five levels (screen, column, region, parent stop, stop), a scope stack for dialogs, a
landing pass that decides where the keys go when their holder is gone, and a topology the shell
installs so the keys module never names a chrome id. That model is what lazygit's context stack and
rainfrog's `Focus` enum are, and it is right. [tui.md](../../tui.md) § Focus regions is its
specification and none of it changes here.

The mechanism is: "Focus is OpenTUI's focus and the renderer owns it, so the store is a view of the
renderer's `focused_renderable` event." Every navigation bug the client has shipped a fix for is a
consequence of that sentence:

- The renderer changes focus on its own on a click, a blur, and a destroy. The store hears about it
  through an event and catches up. Between the change and the catch-up the two disagree.
- `visible` is a property of one renderable, so the renderer will happily keep focus on a descendant
  of a hidden box. The store has to walk the parents itself (`onScreen`, `regions.ts` around line
  122) and the two hide sites (`apps/tui/src/kit/scrolling.tsx`, `apps/tui/src/chrome/Shell.tsx`)
  have to ask for a landing pass because nothing else will.
- `blur()` refuses a node that is no longer `focusable`, so the flag must never be cleared while the
  node holds the keys, which is why `apps/tui/src/invariants.test.ts` pins the exact set of files
  allowed to write it and `apps/tui/src/keys/stops.ts` blurs before clearing.
- `Renderable.y` is stale for a node that did not exist in the previous frame, so a reveal on a fresh
  row scrolls by the wrong delta, and the store installs a second reveal on the renderer's `frame`
  event to correct it (`regions.ts` around line 453).
- The keymap engine's host adapter (`@opentui/keymap/src/opentui.js`, `getFocusedTarget`) returns
  `renderer.currentFocusedRenderable`, so a layer whose target is a node the *store* thinks has the
  keys does not fire if the *renderer* disagrees. Invariant 9 in the reachability suite exists to
  catch this, and it is the invariant that has failed most often.

Each fix above is correct and each is a patch over a disagreement that should not be possible. Making
the store the owner removes the disagreement, and with it the second reveal, the flag dance, and the
two hide-site calls. `regions.ts` gets shorter, not longer.

This phase comes before the painter because it does not depend on the painter. OpenTUI's renderer
becomes a thing that draws boxes where told and, for the duration of this phase, draws a cursor in an
input we tell it to. Whether that last part works is spike 1's question.

## Scope

In:

- **A keymap host adapter of ours.** `@opentui/keymap`'s `Keymap` takes a `KeymapHost<Target, Event>`
  with thirteen members (`metadata`, `rootTarget`, `isDestroyed`, `getFocusedTarget`,
  `getParentTarget`, `isTargetDestroyed`, `onKeyPress`, `onKeyRelease`, `onFocusChange`, `onDestroy`,
  `onTargetDestroy`, `onRawInput`, `createCommandEvent`). `apps/tui/src/keys/keymapHost.ts` (new)
  implements it: `getFocusedTarget` returns the store's focused node, `onFocusChange` subscribes to
  the store's signal, `onKeyPress` and `onKeyRelease` prepend to `renderer.keyInput` as the OpenTUI
  adapter does, `getParentTarget` reads `.parent`. `apps/tui/src/keys/install.ts` builds
  `new Keymap(ourHost)` instead of `createDefaultOpenTuiKeymap(renderer)` and keeps the three addon
  registrations (`registerDefaultKeys`, `registerEnabledFields`, `registerMetadataFields`).
- **The store owns focus.** `focusRenderable` in `regions.ts` sets the signal and does not call
  `renderer.focus()`. The `focused_renderable` listener in `installRegions` goes. Clicks: a
  `mousedown` listener on the renderer hit-tests to the nearest node the store considers a stop
  (the renderer already resolves the clicked renderable; the store walks up from it) and calls the
  store's own focus. Nothing else may move focus, and the grep in `invariants.test.ts` that pins one
  `.focus()` call becomes a grep for zero.
- **Typing without the renderer's focus.** When the focused node is an `InputRenderable` or
  `TextareaRenderable` and the bare-key rules say the key types, the dispatcher calls
  `node.handleKeyPress(event)` directly and marks the event handled. `isTyping` in
  `packages/client-core/src/kit/keys/keymapHost.ts` already takes a host predicate; this host's
  predicate becomes "the focused node is an input". If spike 1 found the cursor draws only under the
  renderer's own focus, the store mirrors its value to `renderable.focus()` in one place, after it
  has decided, and that mirror is documented as paint state. Nothing reads it back.
- **The rectangle asks the store.** `apps/tui/src/kit/rectangle.tsx` reads `focusedRenderable()` and
  `onScreen` already. Its `disarmOnBlur` hook on the renderer's blur event becomes a subscription to
  the store's signal.
- **Hiding tells the store.** `visible={false}` is set in two places today and each calls
  `scheduleSettle`. Those two calls stay in this phase (there is no tree of ours yet to hook), but
  `onScreen` stops trusting `renderable.visible` on the focused node alone and walks the parents as
  it does today. In phase 2 the walk is over our tree and the two calls move into `setProperty`.
- **Deletions.** The second reveal on the `frame` event, replaced by one reveal after the settle
  pass, because the settle pass runs after Solid has committed and the renderer's layout has run for
  the current frame under the test harness's `flush`; if a real terminal still shows stale geometry,
  the reveal stays and is marked for phase 2, where layout and reveal are in the same frame by
  construction. The `focusable` write discipline: `pressable` sets the flag once and never clears it,
  since nothing refuses a blur any more. Tier 41 (`STOP`) collapses to 40 if the engine's tie-break
  no longer matters once the store, not the reconciler, orders the walk; if the engine still breaks
  ties by registration, the tier stays with its comment.
- **Invariant 9 rewritten.** From "renderer and store agree" to "the focused node is attached and on
  screen". The other ten keep their wording.

Out: any change to a kit component's drawing. Any change to the intents, the tiers' meanings, or
[tui.md](../../tui.md) § The five key groups. The typing-gate-as-a-layer change from
[performance.md](../../performance.md) § 2026-09-03 — phase 9;
it composes with this phase but is measured work and stays there. Replacing the keymap engine itself,
which is refused below.

## Design

**Why keep the engine.** `@opentui/keymap` is pure TypeScript with no native code, the desktop uses
its HTML adapter through the same `packages/client-core/src/kit/keys/keymapHost.ts`, and every layer
in `apps/tui` registers through the shape it defines. Both hosts on one engine is how the two
adapters cannot drift, which [testing.md](../../testing.md) § Test layers relies on with its twin
`keys.test.tsx`. What is wrong is not the engine but where it asks for focus, and that is one method
on a host adapter. Writing the adapter is about a hundred lines; writing a dispatcher is a week and a
second set of semantics to keep in step with the desktop. The engine's known costs (the active-key
cache turning off under runtime matchers, the registration-order tie-break) are performance phase 9's
to measure and fix, and both are fixable inside the engine's own API.

**The store is the truth; the renderer is told.** Today `focusRenderable` asks the renderer and
reports what the renderer did. After this phase it decides and, at most, tells the renderer for the
cursor's sake. The direction of every arrow flips: store to renderer, never renderer to store. The
single writer rule in `invariants.test.ts` already exists and gets stricter.

**Clicks are hit tests, not focus events.** The renderer resolves which renderable was under a
`mousedown`. The store takes that renderable, walks up to the nearest thing it recognises as a stop,
a collection row, or a region frame, and focuses that through its own `focusRenderable`. If nothing
above the click is any of those, the click focuses nothing, which is the pointer rule
[tui.md](../../tui.md) § What the TUI never does already states: pointer input is limited to focusing
a clicked stop and scrolling.

**`onScreen` keeps its walk and loses its exception.** It already walks the parents because the
renderer's `visible` is per node. The change is that the focused node's *own* `visible` and
`focusable` are no longer consulted as a fast path: alive means `!isDestroyed`, on screen means every
ancestor up to the root is visible. In phase 2 this becomes a walk over our tree with the same shape.

**What the harness sees.** `apps/tui/src/harness.tsx` and `apps/tui/src/kit/render.tsx` drive
`mockInput.pressKey`, which emits `keypress` on `renderer.keyInput`, which our host adapter listens
to. Nothing in the harness changes. The reachability suite's invariant 9 is the only test whose
assertion changes.

## Code touched

- `apps/tui/src/keys/keymapHost.ts` (new): the `KeymapHost` implementation.
- `apps/tui/src/keys/install.ts`: build the engine from our host; the trace intercept reads the
  store, not `renderer.currentFocusedRenderable`; the typing hand-off to `handleKeyPress`.
- `apps/tui/src/keys/regions.ts`: `focusRenderable` decides; `installRegions` drops the
  `focused_renderable` listener and the `frame` reveal, adds the `mousedown` hit test; `onScreen`
  loses its own-node fast path.
- `apps/tui/src/keys/stops.ts`: `pressable` no longer blurs before clearing, because it no longer
  clears.
- `apps/tui/src/kit/rectangle.tsx`: `disarmOnBlur` subscribes to the store.
- `apps/tui/src/keys/tiers.ts`: tier 41, if the tie-break stops mattering.
- `apps/tui/src/invariants.test.ts`: the `.focus()` grep becomes zero; the `focusable =` file list
  shrinks.
- `apps/tui/src/reachability.test.tsx`: invariant 9.

## Tests

- `apps/tui/src/keys/keys.test.tsx`: every existing case, unchanged, green. It is the twin of the
  desktop's and the proof the engine still dispatches the same way.
- `apps/tui/src/reachability.test.tsx`: green with invariant 9 rewritten, at 80 by 24 and with
  `ACORN_TUI_WIDE`.
- New in `apps/tui/src/keys/regions.test.ts`: a click on a row focuses the row through the store and
  the renderer's `currentFocusedRenderable` is never read (spy on the getter); hiding the focused
  node's ancestor and running the settle pass lands the keys somewhere on screen with no `blur` call;
  a node that loses `focusable` while focused is left by the next settle pass.
- New in `apps/tui/src/kit/kit.test.tsx`: typing into a focused `Input` updates its value with the
  renderer's focus on a different renderable, which is spike 1's result as a regression test.
- `apps/tui/src/browseSlow.test.tsx`: green, because the destroy race is unrelated to this phase and
  must stay fixed.

## Docs owed

[tui.md](../../tui.md) § Focus regions: the paragraph beginning "Focus is OpenTUI's focus and the
renderer owns it" is replaced by the store-owns-it rule; the "second reveal" paragraph under
§ Scrolling viewports goes or is marked as pending phase 2; § The adapter says the engine is built
from this host's own `KeymapHost`. [testing.md](../../testing.md) § Test layers: invariant 9's
sentence. [command-palette-and-shortcuts.md](../../command-palette-and-shortcuts.md) § Focus and
typing if its wording names the renderer.

## Done when

- `grep -rn "currentFocusedRenderable\|\.focus()" apps/tui/src --include='*.ts' --include='*.tsx'`
  outside tests returns only the one cursor mirror, or nothing.
- The reachability suite is green at both sizes with invariant 9 rewritten.
- The `frame`-event reveal is deleted, or is present with a comment naming phase 2 and the terminal
  it was still needed on.
- `regions.ts` is shorter than 1,071 lines.

## Verify before building

- Spike 1's answer is written in [phase-0-baseline-and-spikes.md](./phase-0-baseline-and-spikes.md).
  If `handleKeyPress` needs the renderer's focus, this phase folds into phase 3 and the entry in
  [phases.md](./phases.md) says so.
- Confirm `@opentui/keymap`'s `KeymapHost` still has the thirteen members listed above; read
  `src/types.d.ts` in the installed package.
- Confirm `packages/client-core/src/kit/keys/keymapHost.ts` still takes the typing predicate from
  the host and still types the engine as `Keymap<Target, Event>` with the pair widened. Read at
  `9e5d90ca`.
- Confirm `installRegions` in `regions.ts` still installs exactly two renderer listeners
  (`focused_renderable` and `frame`), so deleting them is deleting all of them.
- Read [tui.md](../../tui.md) § Keys and focus in full first. Every change here must name the rule it
  serves.

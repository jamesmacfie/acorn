import { onCleanup } from 'solid-js'
import type { KeyEvent, Renderable } from '@opentui/core'
import { keymap, keysFor } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { INTENTS, type Intent } from '@acorn/client-core/kit/keys/intents.ts'

// A trap, in a terminal.
//
// `client-core/kit/keys/trap.ts` contains Tab inside a modal by walking focusable DOM elements. There
// is nothing to walk here and it is not ported. What a terminal modal is instead is two key layers:
// one that answers `dismiss` above everything, and one that swallows the intents which would
// otherwise drive what is behind it (docs/future/terminal/05-keys-and-focus.md § Traps).
//
// Both are global rather than bound to the overlay's box, and that is the point: a layer with a
// target only fires when focus is inside it, and a trap has to fire when focus is anywhere.

/** The trap tier: `dismiss`, above every layer in the app. A rectangle is the only thing above this,
 *  and it gets there by consuming keys before dispatch rather than by holding a layer (./install.ts). */
export const TRAP_PRIORITY = 60

/**
 * Where the swallow sits: above a pane's own layer at 30, below a collection's at 40.
 *
 * Phase 2 put the swallow at the trap's own tier and said a collection inside the overlay would still
 * answer its own arrows "because its layer is focus-within on itself and this one swallows only what
 * got past it". That is not how the engine works — priority decides, not locality — so a list drawn
 * inside a `Modal` could not be activated at all: Enter reached the swallow first. Phase 4 found it
 * with the quit confirmation, which is a list inside a modal and nothing else.
 *
 * Below 40 is the fix, and it costs nothing: a collection *behind* the overlay does not fire anyway,
 * because its layer is focus-within and the overlay took the focus.
 */
const SWALLOW_PRIORITY = 35

/** Everything but `dismiss`: an intent that reaches this layer is one no collection inside the
 *  overlay claimed, so letting it through would drive a pane the reader cannot see. */
const SWALLOWED: readonly Intent[] = INTENTS.filter((intent) => intent !== 'dismiss')

/**
 * A global layer above the trap, for an overlay that drives a list of its own.
 *
 * The palette is the one that needs it and the reason is the same one the desktop's
 * `createOverlayPalette` has its own arrow handling for: a palette is a text box you steer with the
 * arrows, and the kit's collection is a list you steer with bare keys — which stop firing the moment
 * something is being typed into, which in a palette is always. So the arrows are bound here, above
 * both of the trap's layers, and the palette keeps its own cursor.
 */
export function overlayKeys(bindings: readonly { key: string; cmd: () => boolean }[]): void {
  const engine = keymap<Renderable, KeyEvent>()
  if (!engine) return
  onCleanup(engine.registerLayer({ priority: TRAP_PRIORITY + 1, bindings }))
}

/**
 * Give an open overlay the keys until it closes.
 *
 * Called from the overlay's own setup; the caller's reactive scope owns the teardown, which is what
 * closing it is.
 */
export function trapKeys(dismiss: () => void): void {
  const engine = keymap<Renderable, KeyEvent>()
  if (!engine) return
  const keys = keysFor()
  onCleanup(engine.registerLayer({
    priority: TRAP_PRIORITY,
    bindings: keys.dismiss.map((key) => ({ key, cmd: () => { dismiss(); return true } })),
  }))
  onCleanup(engine.registerLayer({
    priority: SWALLOW_PRIORITY,
    bindings: SWALLOWED.flatMap((intent) => keys[intent].map((key) => ({ key, cmd: () => true }))),
  }))
}

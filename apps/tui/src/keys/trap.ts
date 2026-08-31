import { onCleanup } from 'solid-js'
import type { KeyEvent, Renderable } from '@opentui/core'
import { keymap, keysFor } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { INTENTS, type Intent } from '@acorn/client-core/kit/keys/intents.ts'

// A trap, in a terminal.
//
// `client-core/kit/keys/trap.ts` contains Tab inside a modal by walking focusable DOM elements. There
// is nothing to walk here and it is not ported. What a terminal modal is instead is a key layer: it
// sits above every pane and collection layer, answers `dismiss`, and swallows the intents that would
// drive what is behind it (docs/future/terminal/05-keys-and-focus.md § Traps). The overlay stack in
// phase 4 does the same thing for the palette.
//
// Global rather than bound to the overlay's box, and that is the point: a layer with a target only
// fires when focus is inside it, and a trap has to fire when focus is anywhere. A collection *inside*
// the overlay still answers its own arrows, because its layer is focus-within on itself and this one
// swallows only what got past it.

/** The trap tier, above the collection tier at 40. A rectangle is the only thing above this, and it
 *  gets there by consuming keys before dispatch rather than by holding a layer (./install.ts). */
export const TRAP_PRIORITY = 60

/** Everything but `dismiss`: an intent that reaches this layer has already passed whatever the
 *  overlay drew, so letting it through would drive a pane the reader cannot see. */
const SWALLOWED: readonly Intent[] = INTENTS.filter((intent) => intent !== 'dismiss')

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
    bindings: [
      ...keys.dismiss.map((key) => ({ key, cmd: () => { dismiss(); return true } })),
      ...SWALLOWED.flatMap((intent) => keys[intent].map((key) => ({ key, cmd: () => true }))),
    ],
  }))
}

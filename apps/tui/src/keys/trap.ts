import { onCleanup } from 'solid-js'
import type { KeyEvent, Renderable } from '@opentui/core'
import { keymap, keysFor } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { OVERLAY_OWN, TRAP } from './tiers'

// A trap, in a terminal.
//
// `client-core/kit/keys/trap.ts` contains Tab inside a modal by walking focusable DOM elements.
// There is nothing to walk here and it is not ported. What a terminal modal is instead is a scope:
// the box goes on the region store's stack while it is drawn, and every question the store answers
// is answered inside it, so there is nothing behind the dialog for a key to reach
// (../keys/regions.ts § Scopes, docs/tui.md § Traps). Which leaves one layer here, for the key that
// closes the thing.
//
// It was two. The second bound every intent but `dismiss` to a handler that returned true, and that
// cannot work: a swallow has to name every key it swallows, and the moment its table differs from
// the table something else binds, the difference is a key that leaks. That is exactly how Tab got
// out. This file read `keysFor()`, where `nextRegion` is `f6` alone, while ./install.ts binds
// `hostKeysFor()`, which adds `tab` for this host. So the one key the footer advertised walked the
// keys onto a rail row behind the plugin trust prompt, and the swallow then ate everything but
// Escape. A scope names nothing and has nothing to leak (docs/tui.md § Traps).
//
// The layer is global rather than bound to the overlay's box, and that is the point: a layer with a
// target only fires when focus is inside it, and Escape has to close the dialog from anywhere.

/**
 * A global layer above the trap, for an overlay that drives a list of its own.
 *
 * The palette is the one that needs it and the reason is the same one the desktop's
 * `createOverlayPalette` has its own arrow handling for: a palette is a text box you steer with the
 * arrows, and the kit's collection is a list you steer with bare keys — which stop firing the moment
 * something is being typed into, which in a palette is always. So the arrows are bound here, above
 * the dismiss layer, and the palette keeps its own cursor.
 */
export function overlayKeys(bindings: readonly { key: string; cmd: () => boolean }[]): void {
  const engine = keymap<Renderable, KeyEvent>()
  if (!engine) return
  onCleanup(engine.registerLayer({ priority: OVERLAY_OWN, bindings }))
}

/**
 * Answer `dismiss` above everything while an overlay is open.
 *
 * Called from the overlay's own setup; the caller's reactive scope owns the teardown, which is what
 * closing it is. Containing the keys is the scope's job and the box's own `ref` does it
 * (../kit/grouping.tsx).
 */
export function trapKeys(dismiss: () => void): void {
  const engine = keymap<Renderable, KeyEvent>()
  if (!engine) return
  onCleanup(engine.registerLayer({
    priority: TRAP,
    bindings: keysFor().dismiss.map((key) => ({ key, cmd: () => { dismiss(); return true } })),
  }))
}

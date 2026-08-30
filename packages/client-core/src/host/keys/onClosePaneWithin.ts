import { onCleanup, onMount } from 'solid-js'
import { desktopExtras } from '../../infra/platform'

// Cmd/Ctrl+W → close the focused thing *inside* a surface. The shell takes the accelerator as a menu
// item so it never closes the window, and pings the renderer; each subscriber acts only when it is
// the one with focus, so the editor's file tab and the terminal drawer's session tab can share the
// chord without colliding. Call during component setup.

/**
 * The general form: `active` says whether this subscriber is the focused one.
 *
 * A pane drawn entirely from kit nodes has no element of its own to test containment against, and
 * minting a raw one just to hold a ref is the shape the closed kit exists to stop. What it does have
 * is the host's own answer — `focusedPane(taskId)` — so the seam asks for a predicate and lets the
 * caller decide which question answers it.
 */
export function onClosePaneWhen(active: () => boolean, fn: () => void): void {
  onMount(() => {
    const off = desktopExtras()?.onClosePane(() => {
      if (!active()) return
      fn()
    })
    onCleanup(() => off?.())
  })
}

/** Containment against an element the caller already holds. `el` is a getter because refs are
 *  assigned after mount. */
export function onClosePaneWithin(el: () => HTMLElement | undefined, fn: () => void): void {
  onClosePaneWhen(() => !!el()?.contains(document.activeElement), fn)
}

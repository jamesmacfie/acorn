// Focus traps: the Tab containment a `Modal` or an open `Menu` needs, plus the restore that goes
// with it.
//
// The containment half was `ui/focus.ts`'s `trapOverlayFocus` and moves here unchanged; the restore
// is new. An overlay that traps focus and then drops it on the body leaves the next Tab starting at
// the top of the page, which is the bug every one of these grew separately
// (docs/future/layout/07-focus-and-keys.md § Focus is a property of the tree: focus returns to the
// opener on dismiss).

import { onCleanup } from 'solid-js'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

const focusableIn = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')

/** Cycle Tab within `root`. Does nothing for any other key. */
export function trapTab(event: KeyboardEvent, root: HTMLElement): void {
  if (event.key !== 'Tab') return
  const focusable = focusableIn(root)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Remember what had focus when a trap opened and put it back when the trap goes.
 *
 * Called from a component's setup, so the caller's scope owns the restore. The element is checked
 * for being in the document first: the thing that opened the overlay is often a row that the
 * overlay's own action removed.
 */
export function restoreFocusOnCleanup(): void {
  const opener = document.activeElement
  onCleanup(() => {
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
  })
}

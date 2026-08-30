import { onCleanup } from 'solid-js'
import { trapTab } from '../../keys/trap'

// Dismissal plumbing for modal surfaces: Escape, backdrop click, and Tab focus containment. See
// docs/ui-design.md § Chrome and overlays for why this exists and why the overlay palettes don't
// use it.

export type Dismissable = {
  /** Backdrop element's onClick. */
  onBackdropClick: () => void
  /** Dialog element's onClick: stops a click inside from reaching the backdrop. */
  onContainerClick: (event: MouseEvent) => void
  /** Dialog element's onKeyDown: Escape to dismiss, Tab to cycle within. */
  onKeyDown: (event: KeyboardEvent) => void
}

// An overlay's own key handler only sees Escape while focus is inside it, and focus falls back to
// the body whenever the focused child unmounts. So every overlay also watches the document, and the
// topmost mounted one wins, which lets a stack of them unwind one press at a time.
const escapeStack: Array<{ live: () => boolean; dismiss: () => void }> = []

export function createDismissable(opts: {
  onDismiss: () => void
  /** The dialog root, for the focus trap. Omit `trapFocus` to skip trapping entirely. */
  container?: () => HTMLElement | undefined
  /** Which gestures dismiss. Defaults to both. A confirm dialog may want `['escape']` only. */
  on?: readonly ('escape' | 'backdrop')[]
  /** Default true when `container` is supplied. */
  trapFocus?: boolean
}): Dismissable {
  const on = opts.on ?? (['escape', 'backdrop'] as const)
  const trap = opts.trapFocus ?? !!opts.container

  if (on.includes('escape') && typeof document !== 'undefined') {
    // `live` keeps a torn-down overlay out of the running: a ref stays pointing at its old element,
    // so an overlay that is no longer in the document must not answer for the one that is.
    const entry = { live: () => (opts.container ? !!opts.container()?.isConnected : true), dismiss: () => opts.onDismiss() }
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (escapeStack.filter((e) => e.live()).at(-1) !== entry) return
      event.preventDefault()
      entry.dismiss()
    }
    escapeStack.push(entry)
    document.addEventListener('keydown', onDocumentKeyDown)
    onCleanup(() => {
      document.removeEventListener('keydown', onDocumentKeyDown)
      escapeStack.splice(escapeStack.indexOf(entry), 1)
    })
  }

  return {
    onBackdropClick: () => {
      if (on.includes('backdrop')) opts.onDismiss()
    },
    onContainerClick: (event) => event.stopPropagation(),
    onKeyDown: (event) => {
      if (on.includes('escape') && event.key === 'Escape') {
        event.preventDefault()
        opts.onDismiss()
        return
      }
      const root = trap ? opts.container?.() : undefined
      if (root) trapTab(event, root)
    },
  }
}

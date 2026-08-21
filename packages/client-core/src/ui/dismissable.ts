import { trapOverlayFocus } from './focus'

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
      if (root) trapOverlayFocus(event, root)
    },
  }
}

import { trapOverlayFocus } from './focus'

// Dismissal plumbing for modal surfaces: Escape, backdrop click, and Tab focus containment.
//
// This was hand-written at nine call sites, and inconsistently — SettingsModal, willPhase and the
// two Database modals had the full pattern; ConfigTrustDialog, PromoteToTaskModal, TabRail,
// LinearBrowse and RollbarBrowse had a backdrop click and nothing else, so Tab walked straight out
// of the dialog into the page behind it and Escape did nothing.
//
// The overlay PALETTES (⌘K, ⌘P, workspace) deliberately do not use this: createOverlayPalette
// already owns their dismissal, plus focus restore and single-active-overlay coordination.
//
// Markup stays at the call site. This is a hook returning handlers, not a component.

export type Dismissable = {
  /** Backdrop element's onClick. */
  onBackdropClick: () => void
  /** Dialog element's onClick — stops a click inside from reaching the backdrop. */
  onContainerClick: (event: MouseEvent) => void
  /** Dialog element's onKeyDown — Escape to dismiss, Tab to cycle within. */
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

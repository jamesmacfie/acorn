import { createEffect, createSignal, onCleanup, onMount, type Accessor } from 'solid-js'
import { commandRegistry } from '../registries/commands/commands'
import { keybindingRegistry } from '../registries/commands/keybindings'

// Shared interaction plumbing for the overlay palettes (Cmd+K command palette, Cmd+P file palette,
// `/` changed-file finder): open/query/selection signals, local up/down (clamped) / Enter / Esc
// handling, and input focus ownership. The overlay markup stays in each component. This is a hook
// returning the shared signals/handlers, not a framework.

/**
 * What `PaletteSurface.tsx` draws, and the least it needs to draw it.
 *
 * Two things satisfy it. `createOverlayPalette` below, which owns its own query and cursor, is what
 * the file finders and the workspace picker still use. The command palette's is a view over the
 * shared session instead (./paletteView.ts), because the query and the cursor there belong to a frame
 * and a pop has to restore them — which is not something a hook holding two signals can do.
 */
export type PaletteView = {
  open: Accessor<boolean>
  query: Accessor<string>
  sel: Accessor<number>
  /** Row hover handler. Moves the selection without touching the query. */
  setSel: (index: number) => void
  /** Input handler. Updates the query and resets the selection to the top. */
  setQuery: (query: string) => void
  /** Close the overlay and clear query + selection. Also the backdrop-click handler. */
  close: () => void
  setInputRef: (el: HTMLInputElement) => void
  /** Local overlay navigation handler; attach to the dialog root. */
  onKeyDown: (event: KeyboardEvent) => void
  /** Keep clicks inside the dialog from dropping keyboard ownership to the document body. */
  onDialogMouseDown: (event: MouseEvent) => void
}

export type OverlayPalette = PaletteView & {
  /** Open the overlay and focus its input (registered via setInputRef). */
  show: () => void
}

// Only one overlay open at a time: opening one dismisses whichever other is open. Module-scoped
// (single-window app) so the independent instances coordinate without a shared store.
let activeClose: (() => void) | null = null

/**
 * The host half of an overlay: which element had focus before it opened, who gets it back, and which
 * overlay is the open one.
 *
 * Split out of `createOverlayPalette` so the command palette's view can have it without also taking
 * the query and cursor signals it does not want. There is one implementation of "give the keyboard
 * back" in the app and this is it; a second would be a second set of the rules below, which are all
 * about a case somebody hit.
 */
export type OverlayFocus = {
  /** Becoming the open overlay: dismiss any other, remember where focus was, take the input. */
  claim: () => void
  /** Giving it up: stop being the open one and hand focus back where it came from. */
  release: () => void
  setInputRef: (el: HTMLInputElement) => void
  onDialogMouseDown: (event: MouseEvent) => void
}

export function createOverlayFocus(close: () => void): OverlayFocus {
  let inputRef: HTMLInputElement | undefined
  let prevFocus: HTMLElement | null = null // element focused when we opened (e.g. the code editor)

  return {
    claim: () => {
      // Close any other open overlay first (it restores its own prevFocus), then capture ours, so the
      // element we return to on dismissal is the real pre-overlay one, not the other palette's input.
      if (activeClose && activeClose !== close) activeClose()
      activeClose = close
      prevFocus = document.activeElement as HTMLElement | null
      queueMicrotask(() => inputRef?.focus())
    },
    release: () => {
      if (activeClose === close) activeClose = null
      // Return focus to wherever it was before we grabbed it, so Esc / backdrop / re-toggle dismissal
      // doesn't strand keyboard focus on <body>. Skip if that element is gone: a pick that navigated
      // or opened a file unmounted it, and that action's own focus target wins.
      const prev = prevFocus
      prevFocus = null
      if (prev?.isConnected && prev !== document.activeElement) prev.focus()
    },
    setInputRef: (el) => {
      inputRef = el
    },
    onDialogMouseDown: (event) => {
      // Preserve native caret placement and text selection in the input itself. Palette chrome,
      // empty-state rows, and result buttons should leave typing/navigation owned by the input.
      if (event.target === inputRef) return
      event.preventDefault()
      inputRef?.focus()
    },
  }
}

export function createOverlayPalette(opts: {
  /** Stable command/keybinding id for the overlay toggle. Omit for programmatic-only overlays. */
  id?: string
  title?: string
  toggleChord?: string
  active?: () => boolean
  /** Current result-list length; ↑/↓ clamp to it. */
  count: () => number
  /** Invoke the item at the selected index (Enter / row click paths look items up themselves). */
  onPick: (index: number) => void
  /** Runs when the overlay opens (e.g. kick resource refetches). */
  onOpen?: () => void
}): OverlayPalette {
  const [open, setOpen] = createSignal(false)
  const [query, setQuerySignal] = createSignal('')
  const [sel, setSel] = createSignal(0)

  const close = () => {
    setOpen(false)
    setQuerySignal('')
    setSel(0)
    focus.release()
  }
  const focus = createOverlayFocus(close)
  const show = () => {
    focus.claim()
    setOpen(true)
    opts.onOpen?.()
  }
  const setQuery = (q: string) => {
    setQuerySignal(q)
    setSel(0)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open()) return
    // Open overlay: the input owns typing; only list-navigation keys are intercepted.
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, Math.max(0, opts.count() - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      opts.onPick(sel())
    }
  }

  onMount(() => {
    if (!opts.id || !opts.toggleChord) return
    const command = commandRegistry.register({
      id: `overlay.${opts.id}.toggle`,
      title: opts.title ?? `Toggle ${opts.id}`,
      category: 'navigation',
      when: opts.active,
      run: () => open() ? close() : show(),
    })
    const binding = keybindingRegistry.register({
      id: `overlay.${opts.id}.toggle`,
      command: `overlay.${opts.id}.toggle`,
      description: opts.title ?? `Toggle ${opts.id}`,
      category: 'Global',
      defaultChord: opts.toggleChord,
      when: 'global',
      active: opts.active,
    })
    onCleanup(() => { binding.dispose(); command.dispose() })
  })

  // Keep the selection in range when the list shrinks under it (data refetch narrows results).
  createEffect(() => {
    const len = opts.count()
    if (sel() >= len) setSel(len ? len - 1 : 0)
  })

  return {
    open,
    query,
    sel,
    setSel,
    setQuery,
    show,
    close,
    setInputRef: focus.setInputRef,
    onKeyDown,
    onDialogMouseDown: focus.onDialogMouseDown,
  }
}

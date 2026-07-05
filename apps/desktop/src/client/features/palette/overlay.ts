import { createEffect, createSignal, onCleanup, onMount, type Accessor } from 'solid-js'

// Shared keyboard plumbing for the three overlay palettes (⌘K command palette, ⌘P file palette,
// `/` changed-file finder): one window keydown listener, open/query/selection signals,
// ↑/↓ (clamped) / Enter / Esc handling, and focus-on-open. The overlay markup stays in each
// component — this is a hook returning the shared signals/handlers, not a framework.

export type OverlayPalette = {
  open: Accessor<boolean>
  query: Accessor<string>
  sel: Accessor<number>
  /** Row hover handler — moves the selection without touching the query. */
  setSel: (index: number) => void
  /** Input handler — updates the query and resets the selection to the top. */
  setQuery: (query: string) => void
  /** Open the overlay and focus its input (registered via setInputRef). */
  show: () => void
  /** Close the overlay and clear query + selection. Also the backdrop-click handler. */
  close: () => void
  setInputRef: (el: HTMLInputElement) => void
}

export function createOverlayPalette(opts: {
  /** Current result-list length; ↑/↓ clamp to it. */
  count: () => number
  /** Invoke the item at the selected index (Enter / row click paths look items up themselves). */
  onPick: (index: number) => void
  /** Open/close trigger chord (e.g. ⌘K). Consumed with preventDefault; toggles the overlay. */
  isToggle?: (e: KeyboardEvent) => boolean
  /** Runs when the overlay opens (e.g. kick resource refetches). */
  onOpen?: () => void
  /** Keydowns while the overlay is CLOSED that weren't the toggle — for extra bare-key shortcuts. */
  onClosedKey?: (e: KeyboardEvent) => void
}): OverlayPalette {
  const [open, setOpen] = createSignal(false)
  const [query, setQuerySignal] = createSignal('')
  const [sel, setSel] = createSignal(0)
  let inputRef: HTMLInputElement | undefined

  const close = () => {
    setOpen(false)
    setQuerySignal('')
    setSel(0)
  }
  const show = () => {
    setOpen(true)
    opts.onOpen?.()
    queueMicrotask(() => inputRef?.focus())
  }
  const setQuery = (q: string) => {
    setQuerySignal(q)
    setSel(0)
  }

  const onKey = (e: KeyboardEvent) => {
    if (opts.isToggle?.(e)) {
      e.preventDefault()
      if (open()) close()
      else show()
      return
    }
    if (!open()) {
      opts.onClosedKey?.(e)
      return
    }
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

  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

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
    setInputRef: (el) => {
      inputRef = el
    },
  }
}

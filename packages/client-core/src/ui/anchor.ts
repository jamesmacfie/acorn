import { createSignal, onCleanup, onMount } from 'solid-js'

// Element-anchored floating surfaces: portal-aware dismissal plus position-to-rect.
//
// Extracted verbatim from Picker.tsx, whose comment said "extract it if a second element-anchored
// popover appears". Five appeared, and each solved less of the problem: AccountMenu and
// NotificationBell hand-rolled their own document listener, TabRail's task menu had neither
// outside-click nor Escape, and terminal's profile menu had no portal at all — so any overflow
// ancestor clipped it, which is precisely the failure Picker documents.
//
// The Portal is the load-bearing part. Panes set `overflow`, and an absolutely-positioned child
// cannot escape an overflow-clipped ancestor; it gets cut at the pane edge instead of overlaying
// the next column. Fixed-positioning to the trigger's rect works unchanged inside a sandboxed
// plugin frame, where the "viewport" is simply the frame.
//
// This hook owns dismissal and geometry ONLY. List semantics come from focus.ts, markup from the
// call site. No flip/collision middleware beyond a `placement` flag and a re-measure on reflow —
// extend when a real collision case turns up, not before.

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start'

export type AnchoredPopover = {
  open: () => boolean
  toggle: () => void
  close: () => void
  show: () => void
  position: () => { top: number; left: number; width?: number }
  /** Ref for the floating element. Outside-click needs it: it lives outside the anchor's subtree. */
  setSurface: (element: HTMLElement | undefined) => void
  /** Inline style for the floating element — `position: fixed` plus the measured offsets. */
  surfaceStyle: () => Record<string, string>
}

export function createAnchoredPopover(opts: {
  anchor: () => HTMLElement | undefined
  placement?: () => Placement
  /** `'anchor'` matches the trigger's width; a number is a minimum (Picker's max(rect.width, 300)). */
  minWidth?: number | 'anchor'
  onDismiss?: () => void
  disabled?: () => boolean
  /** Controlled visibility, for the case where the surrounding component already owns "which one is
   *  open" as app state — the task rail closes its row menu on ⌘1-9 navigation, and that decision
   *  cannot live inside one menu instance. Supply both or neither. */
  open?: () => boolean
  onOpenChange?: (open: boolean) => void
}): AnchoredPopover {
  const [uncontrolled, setUncontrolled] = createSignal(false)
  const open = () => (opts.open ? opts.open() : uncontrolled())
  const setOpen = (next: boolean) => {
    setUncontrolled(next)
    opts.onOpenChange?.(next)
  }
  const [pos, setPos] = createSignal<{ top: number; left: number; width?: number }>({ top: 0, left: 0 })
  let surface: HTMLElement | undefined

  const gap = 4

  const reposition = () => {
    const rect = opts.anchor()?.getBoundingClientRect()
    if (!rect) return
    const placement = opts.placement?.() ?? 'bottom-start'
    const height = surface?.getBoundingClientRect().height ?? 0
    const width = surface?.getBoundingClientRect().width ?? 0
    const minWidth = opts.minWidth
    setPos({
      top: placement === 'top-start' ? rect.top - height - gap
        : placement === 'right-start' ? rect.top
        : rect.bottom + gap,
      left: placement === 'bottom-end' ? rect.right - Math.max(width, rect.width)
        : placement === 'right-start' ? rect.right + gap
        : rect.left,
      width: minWidth === 'anchor' ? rect.width
        : typeof minWidth === 'number' ? Math.max(rect.width, minWidth)
        : undefined,
    })
  }

  const close = () => {
    if (!open()) return
    setOpen(false)
    opts.onDismiss?.()
  }

  const show = () => {
    if (opts.disabled?.()) return
    // Measure before paint, then again once the surface exists so a height-dependent placement
    // ('top-start') is not one frame wrong.
    reposition()
    setOpen(true)
    queueMicrotask(reposition)
  }

  const toggle = () => (open() ? close() : show())

  const onDocPointer = (event: PointerEvent) => {
    if (!open()) return
    const target = event.target as Node
    if (!opts.anchor()?.contains(target) && !surface?.contains(target)) close()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open()) {
      event.preventDefault()
      close()
    }
  }
  const onReflow = () => {
    if (open()) reposition()
  }

  onMount(() => {
    document.addEventListener('pointerdown', onDocPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true) // capture: inner panes scroll too
  })
  onCleanup(() => {
    document.removeEventListener('pointerdown', onDocPointer)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', onReflow)
    window.removeEventListener('scroll', onReflow, true)
  })

  return {
    open,
    toggle,
    close,
    show,
    position: pos,
    setSurface: (element) => { surface = element },
    surfaceStyle: () => {
      const p = pos()
      return {
        position: 'fixed',
        top: `${p.top}px`,
        left: `${p.left}px`,
        ...(p.width === undefined ? {} : { width: `${p.width}px` }),
      }
    },
  }
}

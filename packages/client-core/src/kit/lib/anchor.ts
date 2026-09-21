import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'

// Element-anchored floating surfaces: portal-aware dismissal plus position-to-rect. See
// docs/ui-design.md § Menus and right-click for why this exists, what it leaves to focus.ts and the
// call site, and why the portal matters.

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start'

/** What a surface is positioned against: an element, or a point (what a right-click has). See
 * docs/ui-design.md § Menus and right-click for why a point needs no special handling downstream. */
export type AnchorTarget = HTMLElement | { readonly x: number; readonly y: number }

type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number }
type Size = { width: number; height: number }
type Viewport = { width: number; height: number }

const GAP = 4

// Every open surface, in the order it opened. A Select drawn inside a Popover draws its list in a
// portal of its own, so that list is not inside the popover holding it. Without this, a press on one
// of its rows reads as a press outside the popover: the popover closes, the row goes with it, and the
// click never lands on anything. Whatever opened after me is drawn on top of me, so a press in it is
// not a press outside.
const openSurfaces: Array<() => HTMLElement | undefined> = []

/** Pure collision pass for every anchored surface. Element anchors may flip to the opposite side;
 * point anchors keep the pointer as their origin and clamp, because there is no trigger edge to
 * flip around. The final clamp also covers a surface wider or taller than the available side. */
export function anchoredPosition(
  rect: Rect,
  surface: Size,
  viewport: Viewport,
  placement: Placement,
  canFlip: boolean,
): { top: number; left: number } {
  const below = viewport.height - rect.bottom
  const above = rect.top
  const right = viewport.width - rect.right
  const leftRoom = rect.left
  let top = placement === 'top-start' ? rect.top - surface.height - GAP
    : placement === 'right-start' ? rect.top
    : rect.bottom + GAP
  let left = placement === 'bottom-end' ? rect.right - Math.max(surface.width, rect.width)
    : placement === 'right-start' ? rect.right + GAP
    : rect.left

  if (canFlip && (placement === 'bottom-start' || placement === 'bottom-end')
    && top + surface.height + GAP > viewport.height && above > below) {
    top = rect.top - surface.height - GAP
  } else if (canFlip && placement === 'top-start' && top < GAP && below > above) {
    top = rect.bottom + GAP
  } else if (canFlip && placement === 'right-start'
    && left + surface.width + GAP > viewport.width && leftRoom > right) {
    left = rect.left - surface.width - GAP
  }

  const fit = (value: number, size: number, limit: number): number =>
    Math.max(GAP, size && value + size + GAP > limit ? limit - size - GAP : value)
  return {
    top: fit(top, surface.height, viewport.height),
    left: fit(left, surface.width, viewport.width),
  }
}

const rectOf = (target: AnchorTarget): Rect =>
  'getBoundingClientRect' in target
    ? target.getBoundingClientRect()
    : { top: target.y, bottom: target.y, left: target.x, right: target.x, width: 0, height: 0 }

const elementOf = (target: AnchorTarget | undefined): HTMLElement | undefined =>
  target && 'contains' in target ? target : undefined

export type AnchoredPopover = {
  open: () => boolean
  toggle: () => void
  close: () => void
  show: () => void
  position: () => { top: number; left: number; width?: number }
  /** Ref for the floating element. Outside-click needs it: it lives outside the anchor's subtree. */
  setSurface: (element: HTMLElement | undefined) => void
  /** Inline style for the floating element: position: fixed plus the measured offsets. */
  surfaceStyle: () => Record<string, string>
}

export function createAnchoredPopover(opts: {
  anchor: () => AnchorTarget | undefined
  placement?: () => Placement
  /** Surface width. `'anchor'` pins the surface to the trigger's width, so a long option label wraps
   *  inside the list instead of a list wider than the control it hangs off. A number is a fixed
   *  `max(trigger, n)`, which is what Picker was tuned against, where a list that changed width on
   *  every keystroke of the filter would be worse. */
  minWidth?: number | 'anchor'
  /** Keep the surface inside the viewport. On by default. Point anchors clamp without flipping;
   *  element anchors flip first and clamp only what still does not fit. */
  clamp?: boolean
  onDismiss?: () => void
  disabled?: () => boolean
  /** Controlled visibility, for when the surrounding component already owns "which one is open" as
   *  app state. The task rail closes its row menu on cmd+1-9 navigation, and that decision cannot
   *  live inside one menu instance. Supply both or neither. */
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

  const reposition = () => {
    const target = opts.anchor()
    if (!target) return
    const rect = rectOf(target)
    const placement = opts.placement?.() ?? 'bottom-start'
    const height = surface?.getBoundingClientRect().height ?? 0
    const width = surface?.getBoundingClientRect().width ?? 0
    const minWidth = opts.minWidth
    const keepVisible = opts.clamp !== false
    const placed = keepVisible
      ? anchoredPosition(
          rect,
          { width, height },
          { width: window.innerWidth, height: window.innerHeight },
          placement,
          elementOf(target) !== undefined,
        )
      : {
          top: placement === 'top-start' ? rect.top - height - GAP
            : placement === 'right-start' ? rect.top
            : rect.bottom + GAP,
          left: placement === 'bottom-end' ? rect.right - Math.max(width, rect.width)
            : placement === 'right-start' ? rect.right + GAP
            : rect.left,
        }
    setPos({
      ...placed,
      ...(minWidth === 'anchor' ? { width: rect.width }
        : typeof minWidth === 'number' ? { width: Math.max(rect.width, minWidth) }
        : {}),
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

  // This surface's place in the open order, for as long as it is open.
  const entry = () => surface
  // A controlled owner can flip `open` without calling show() (the task rail opens its row menu
  // from onRowClick), and only show() measures. Measure on every open, whichever door it came
  // through. Runs after render, so the mounted surface is already registered.
  createEffect(() => {
    if (!open()) return
    reposition()
    openSurfaces.push(entry)
    onCleanup(() => {
      const at = openSurfaces.indexOf(entry)
      if (at >= 0) openSurfaces.splice(at, 1)
    })
  })

  const onDocPointer = (event: PointerEvent) => {
    if (!open()) return
    const target = event.target as Node
    // A point anchor has no element, so nothing but the surface itself counts as "inside". That is
    // the right answer for a context menu: the row it was opened over is not part of the menu.
    if (elementOf(opts.anchor())?.contains(target) || surface?.contains(target)) return
    const at = openSurfaces.indexOf(entry)
    if (at >= 0 && openSurfaces.slice(at + 1).some((later) => later()?.contains(target))) return
    close()
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

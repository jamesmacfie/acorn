import { onCleanup } from 'solid-js'

// Drag-to-resize, plus the keyboard contract the three hand-rolled splitters didn't have. See
// docs/ui-design.md § Drag-to-resize for why it reports a delta and what it owns versus the caller.

export type SplitDrag = {
  /** Spread onto the handle element. */
  handleProps: {
    role: 'separator'
    'aria-orientation': 'vertical' | 'horizontal'
    'aria-label': string
    tabindex: 0
    onPointerDown: (event: PointerEvent) => void
    onKeyDown: (event: KeyboardEvent) => void
    onDblClick?: () => void
  }
}

export function createSplitDrag(opts: {
  /** The axis the handle moves along: 'x' for a vertical divider between columns. */
  axis: 'x' | 'y'
  label: string
  /** Called once at pointer-down, before any delta: the moment to snapshot current sizes. */
  onStart?: () => void
  /** Pixels moved since pointer-down, sign following the axis. The caller clamps. */
  onDelta: (deltaPx: number) => void
  /** After the pointer is released, or after a keyboard nudge. Persist here. */
  onCommit?: () => void
  /** Keyboard increment. */
  step?: number
  /** Double-click, if the surface has a reset (the pane row equalizes). */
  onReset?: () => void
  /** Invert the keyboard direction, for a handle whose "grow" is up or left (the drawer). */
  invert?: boolean
}): SplitDrag {
  const step = () => opts.step ?? 16

  // See docs/ui-design.md § Drag-to-resize: a drag that outlives its component would keep moving
  // panes that no longer exist.
  let release: (() => void) | undefined
  onCleanup(() => release?.())

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault()
    const handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
    handle?.setPointerCapture(event.pointerId)
    const start = opts.axis === 'x' ? event.clientX : event.clientY
    opts.onStart?.()

    // Without this, dragging selects every label it passes over.
    document.body.style.userSelect = 'none'

    let frame = 0
    let ended = false
    const move = (pointer: PointerEvent) => {
      const current = opts.axis === 'x' ? pointer.clientX : pointer.clientY
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => opts.onDelta(current - start))
    }
    // Idempotent: reachable from four places. See docs/ui-design.md § Drag-to-resize for why this
    // removes the property rather than restoring a snapshot.
    const up = () => {
      if (ended) return
      ended = true
      cancelAnimationFrame(frame)
      document.body.style.removeProperty('user-select')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      handle?.removeEventListener('lostpointercapture', up)
      release = undefined
      opts.onCommit?.()
    }
    release = up
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    // See docs/ui-design.md § Drag-to-resize for why both `pointerup` and `pointercancel` are
    // handled here. PanelGrid's own drag already handles cancel for the same reason.
    window.addEventListener('pointercancel', up)
    handle?.addEventListener('lostpointercapture', up)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const forward = opts.axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    const back = opts.axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    // A big number rather than Infinity: the caller clamps, and Infinity through a px arithmetic
    // path produces NaN widths rather than a pinned pane.
    const FULL = 10_000
    const delta = event.key === forward ? step()
      : event.key === back ? -step()
      : event.key === 'End' ? FULL
      : event.key === 'Home' ? -FULL
      : 0
    if (!delta) return
    event.preventDefault()
    opts.onDelta(opts.invert ? -delta : delta)
    opts.onCommit?.()
  }

  return {
    handleProps: {
      role: 'separator',
      // A handle that moves along x separates columns, which is a vertical divider.
      'aria-orientation': opts.axis === 'x' ? 'vertical' : 'horizontal',
      'aria-label': opts.label,
      tabindex: 0,
      onPointerDown,
      onKeyDown,
      ...(opts.onReset ? { onDblClick: opts.onReset } : {}),
    },
  }
}

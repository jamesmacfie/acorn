import { onCleanup } from 'solid-js'

// Drag-to-resize, plus the keyboard contract the three hand-rolled splitters didn't have.
//
// DELTA-based, not value-based. The three call sites model size differently — the pane row resizes
// TWO adjacent panes against each other by a pixel delta, the terminal drawer owns one absolute
// height, the document surface owns a fraction — and a delta is the one thing all three can turn
// into their own units. A `value`/`onChange` hook would have fit exactly one of them.
//
// What it owns: pointer capture, rAF coalescing, text-selection suppression during the drag, and
// `role="separator"` with arrow/Home/End keys. Persistence stays with the caller, because only the
// caller knows what it is persisting — a pref, a layout weight, a fraction.
//
// Same idiom as dismissable.ts: behaviour as a hook, markup at the call site.

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
  /** The axis the handle MOVES along: 'x' for a vertical divider between columns. */
  axis: 'x' | 'y'
  label: string
  /** Called once at pointer-down, before any delta — the moment to snapshot current sizes. */
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

  // A drag that outlives its component would keep moving panes that no longer exist.
  let release: (() => void) | undefined
  onCleanup(() => release?.())

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault()
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId)
    const start = opts.axis === 'x' ? event.clientX : event.clientY
    opts.onStart?.()

    // Without this, dragging selects every label it passes over.
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'

    let frame = 0
    const move = (pointer: PointerEvent) => {
      const current = opts.axis === 'x' ? pointer.clientX : pointer.clientY
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => opts.onDelta(current - start))
    }
    const up = () => {
      cancelAnimationFrame(frame)
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      release = undefined
      opts.onCommit?.()
    }
    release = up
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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
      // A handle that moves along x separates columns, which is a VERTICAL divider.
      'aria-orientation': opts.axis === 'x' ? 'vertical' : 'horizontal',
      'aria-label': opts.label,
      tabindex: 0,
      onPointerDown,
      onKeyDown,
      ...(opts.onReset ? { onDblClick: opts.onReset } : {}),
    },
  }
}

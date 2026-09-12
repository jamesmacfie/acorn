import { Direction } from 'yoga-layout'
import type { Node } from '../tree/node'

// One layout pass, and the clamp that reads it back.
//
// This function is where the old render guard went — deleted with the old painter, and in the git
// history as `apps/tui/src/renderGuard.ts`. That file patched two methods on somebody else's
// prototype because a node that joins the tree after a frame's layout pass has no computed size, and
// the fault is Yoga's rather than OpenTUI's: `getComputedWidth` and `getComputedHeight` on an
// unmeasured node both return `NaN`, and so does `getComputedLayout()` for the same two fields
// (docs/tui.md § Rendering). It survives the move to wasm unchanged. What changes is that there is
// one place a rectangle is read, so there is one place to answer it.
//
// Three things the clamp has to know, each measured rather than assumed.
//
//   NaN is the marker    and zero is not. An empty auto-sized box lays out at height 0 and a
//                        `DISPLAY_NONE` subtree lays out at 0, 0, 0, 0, both legitimately, so "is it
//                        zero" cannot be the question anywhere. Only `Number.isFinite` can.
//   a size becomes zero  rather than the one cell the render guard chose. That 1 was for the Zig
//                        side, which took a `u32` and threw on `NaN` from inside the render loop.
//                        Our paint has no such door: a zero rectangle paints nothing, which is the
//                        honest answer for a node Yoga has never measured, and the next frame has
//                        the real size.
//   a left may be        and stays negative. An overflowing child under `alignItems: center`
//   negative             reported left -15 at width 40 inside a 10-cell parent. Clamping that to 0
//                        would move the run; paint's job is to clip it. So the invariant is four
//                        finite integers, of which only the width and the height are non-negative
//                        (docs/tui.md § Rendering).
//
// Yoga rounds sizes to whole cells by itself at the default point scale factor of 1 — 101 split three
// ways comes back 34, 33, 34 with edges that meet — so the rounding below is a belt, not the braces.

/** How many rows a viewport has scrolled its content by, and nought for everything that is not one. */
const scrollOffset = (node: Node): number => {
  if (node.kind !== 'scrollbox') return 0
  const offset = node.props.offset
  return typeof offset === 'number' && Number.isFinite(offset) ? Math.round(offset) : 0
}

const position = (value: number): number => (Number.isFinite(value) ? Math.round(value) : 0)
const size = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)

/** Yoga's four computed numbers, made safe, and offset into absolute screen cells by the parent's
 *  origin. Exported on its own because it is the whole of what the render guard's own test pinned,
 *  and `./layout.test.ts § clamps the rectangle of a node that joined the tree after the pass` is
 *  where that assertion now lives. */
export function clampRect(
  left: number,
  top: number,
  width: number,
  height: number,
  originX = 0,
  originY = 0,
): { x: number; y: number; w: number; h: number } {
  return {
    x: originX + position(left),
    y: originY + position(top),
    w: size(width),
    h: size(height),
  }
}

/** Walk the tree writing each node's absolute rectangle, collecting whoever asked to be told their
 *  size changed.
 *
 *  A node with no Yoga node of its own — a `span`, a `#text` — keeps the rectangle it has and passes
 *  its parent's origin down, because a run's position inside a line is paint's to work out from the
 *  lines the measure function produced, not a box anybody laid out.
 *
 *  ── A viewport moves its children ──
 *
 *  A `scrollbox` carries an offset the component that drew it owns (`../kit/scrolling.tsx`), and the
 *  whole of what scrolling is here is that its children are read back that many rows higher. Paint
 *  then clips them to the viewport for nothing, because it clips every child to its parent's content
 *  box already.
 *
 *  Here rather than in paint, and it buys the same answer to three questions instead of one. A
 *  rectangle is where a node is on the screen, so a translated rectangle is what a reveal compares,
 *  what a wheel hit test walks, and what the region store reads through `x` and `y`. Translating in
 *  paint alone would leave those three reading a position nothing was drawn at. */
export function readBack(node: Node, originX = 0, originY = 0, resized: Node[] = []): Node[] {
  let x = originX
  let y = originY
  if (node.yoga) {
    const before = node.rect
    node.rect = clampRect(
      node.yoga.getComputedLeft(),
      node.yoga.getComputedTop(),
      node.yoga.getComputedWidth(),
      node.yoga.getComputedHeight(),
      originX,
      originY,
    )
    // The size only, not the position: a box that moved sideways is not a box whose contents have to
    // decide anything again, and that is also what the prop is called.
    if ((before.w !== node.rect.w || before.h !== node.rect.h) && typeof node.props.onSizeChange === 'function') {
      resized.push(node)
    }
    x = node.rect.x
    y = node.rect.y
  }
  const scrolled = y - scrollOffset(node)
  for (const child of node.children) readBack(child, x, scrolled, resized)
  return resized
}

/**
 * Lay the whole tree out at a terminal size and read it back. Called once per dirty frame.
 *
 * The `onSizeChange` calls come after the whole read-back rather than during it, and they are the
 * one thing in this file that runs somebody else's code. Eight components in this package pick a
 * form from the width they were given — the rail takes a third of the shell, the footer cuts its
 * hints to the row it has, a `list-detail` stacks below 80 cells — and every one of them reads it
 * from this prop. Without the call each of those reads the zero its `ref` saw before the first
 * layout and never hears otherwise: the rail drew at its 20-cell floor instead of 24, and the footer
 * cut every hint to nothing (../chrome/Rail.tsx § railCells, ../chrome/Footer.tsx).
 *
 * After the walk, because a handler writes a signal, and a signal written mid-walk is a tree
 * changing while it is being measured. It asks for the next frame instead, which the scheduler
 * coalesces with everything else that moved (../tree/frames.ts).
 */
export function layoutTree(root: Node, cols: number, rows: number): void {
  if (!root.yoga) return
  root.yoga.calculateLayout(cols, rows, Direction.LTR)
  for (const node of readBack(root)) (node.props.onSizeChange as () => void)()
}

import { Direction } from 'yoga-layout'
import type { Node } from '../tree/node'

// One layout pass, and the clamp that reads it back.
//
// This function is where `../renderGuard.ts` goes. That file patched two methods on somebody else's
// prototype because a node that joins the tree after a frame's layout pass has no computed size, and
// the fault is Yoga's rather than OpenTUI's: `getComputedWidth` and `getComputedHeight` on an
// unmeasured node both return `NaN`, and so does `getComputedLayout()` for the same two fields
// (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md § Spike 2). It survives the move to
// wasm unchanged. What changes is that there is one place a rectangle is read, so there is one place
// to answer it.
//
// Three things the clamp has to know, each measured rather than assumed.
//
//   NaN is the marker    and zero is not. An empty auto-sized box lays out at height 0 and a
//                        `DISPLAY_NONE` subtree lays out at 0, 0, 0, 0, both legitimately, so "is it
//                        zero" cannot be the question anywhere. Only `Number.isFinite` can.
//   a size becomes zero  rather than the one cell `renderGuard.ts` chose. That 1 was for the Zig
//                        side, which took a `u32` and threw on `NaN` from inside the render loop.
//                        Our paint has no such door: a zero rectangle paints nothing, which is the
//                        honest answer for a node Yoga has never measured, and the next frame has
//                        the real size.
//   a left may be        and stays negative. An overflowing child under `alignItems: center`
//   negative             reported left -15 at width 40 inside a 10-cell parent. Clamping that to 0
//                        would move the run; paint's job is to clip it. So the invariant in
//                        architecture.md § 2 holds for the size half only: four finite integers, of
//                        which the width and the height are non-negative.
//
// Yoga rounds sizes to whole cells by itself at the default point scale factor of 1 — 101 split three
// ways comes back 34, 33, 34 with edges that meet — so the rounding below is a belt, not the braces.

const position = (value: number): number => (Number.isFinite(value) ? Math.round(value) : 0)
const size = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)

/** Yoga's four computed numbers, made safe, and offset into absolute screen cells by the parent's
 *  origin. Exported on its own because it is the whole of what `../renderGuard.test.ts` was pinning. */
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

/** Walk the tree writing each node's absolute rectangle.
 *
 *  A node with no Yoga node of its own — a `span`, a `#text` — keeps the rectangle it has and passes
 *  its parent's origin down, because a run's position inside a line is paint's to work out from the
 *  lines the measure function produced, not a box anybody laid out. */
export function readBack(node: Node, originX = 0, originY = 0): void {
  let x = originX
  let y = originY
  if (node.yoga) {
    node.rect = clampRect(
      node.yoga.getComputedLeft(),
      node.yoga.getComputedTop(),
      node.yoga.getComputedWidth(),
      node.yoga.getComputedHeight(),
      originX,
      originY,
    )
    x = node.rect.x
    y = node.rect.y
  }
  for (const child of node.children) readBack(child, x, y)
}

/** Lay the whole tree out at a terminal size and read it back. Called once per dirty frame. */
export function layoutTree(root: Node, cols: number, rows: number): void {
  if (!root.yoga) return
  root.yoga.calculateLayout(cols, rows, Direction.LTR)
  readBack(root)
}

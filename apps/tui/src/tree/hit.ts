import { laysOut, type Node } from './node'

// What the pointer is over, and where a wheel goes from there.
//
// Every node carries the rectangle the layout pass wrote, so "which node is under this cell" is a
// depth-first search and nothing more. Two rules make it the answer a reader would give:
//
//   later siblings win     because a sibling drawn after another is drawn over it, and paint walks
//                          the children in order. So the search takes the last child that contains
//                          the point rather than the first.
//   hidden is not there    `visible === false` is a subtree paint skips whole, so the pointer must
//                          not reach into it either — an overlay's shell keeps its rectangles.
//
// A `span` and a `#text` are part of their parent's one run and have no rectangle of their own, so
// the deepest thing this can answer is the `text` that measured them.
//
// The wheel is here rather than in the region store because it is not a focus question: a scroll
// moves a viewport's offset and leaves the keys where they are (docs/tui.md § What the TUI never
// does). Focusing what a click landed on is the store's and is a later slice.

const holds = (node: Node, x: number, y: number): boolean =>
  x >= node.rect.x && x < node.rect.x + node.rect.w && y >= node.rect.y && y < node.rect.y + node.rect.h

/** The deepest node whose rectangle contains the cell, or nothing where the point is outside the
 *  tree altogether. */
export function hit(node: Node, x: number, y: number): Node | null {
  if (node.props.visible === false || !holds(node, x, y)) return null
  for (let at = node.children.length - 1; at >= 0; at -= 1) {
    const child = node.children[at]!
    if (!laysOut(child.kind)) continue
    const deeper = hit(child, x, y)
    if (deeper) return deeper
  }
  return node
}

/** What a viewport answers a wheel with. Installed on the node by `../kit/scrolling.tsx`, which owns
 *  the offset, so the shape is that component's promise rather than the tree's. */
type Wheeled = { scrollBy?: (delta: number, unit?: string) => void }

/** A wheel step as the two handlers in this package read one, which is OpenTUI's `MouseEvent` cut
 *  down to the members they touch (`../kit/showing.tsx § Rows virtual`, § DiffPane). */
export type Wheel = {
  x: number
  y: number
  scroll: { direction: 'up' | 'down'; delta: number }
  preventDefault: () => void
  stopPropagation: () => void
}

/** How far one wheel step moves anything.
 *
 *  Three rows, which is what a reader's finger expects of every other terminal application and what
 *  `../kit/scrolling.test.tsx` measures: four steps over a five-row viewport of 24 rows has to leave
 *  the first row behind without reaching the end. There is no acceleration — OpenTUI's scrollbox had
 *  a curve keyed on how fast the events arrived, and a wheel that moves a different distance
 *  depending on how hard somebody spun it is a thing to add when somebody asks for it. */
const WHEEL_ROWS = 3

/**
 * Deliver one wheel step at a cell: from the node under the pointer upwards, each node's own handler,
 * and the first viewport on the way up moves its offset.
 *
 * The order is the old painter's, where a mouse event runs each renderable's handler before it hands
 * the event to its parent, and both halves of it are load-bearing.
 *
 *   a handler below wins    a virtual `Rows` is inside a viewport and owns its own window, so it
 *                           takes the wheel and stops it before the viewport underneath it moves as
 *                           well (docs/tui.md § Scrolling viewports).
 *   a handler above reads   `DiffPane` windows its content against the viewport's offset and catches
 *   the offset that moved   the wheel on a box *around* the viewport precisely so that it runs after
 *                           the move rather than before it.
 */
export function wheelAt(root: Node, x: number, y: number, direction: 'up' | 'down'): void {
  const target = hit(root, x, y)
  if (!target) return
  let stopped = false
  const event: Wheel = {
    x,
    y,
    scroll: { direction, delta: WHEEL_ROWS },
    preventDefault: () => {},
    stopPropagation: () => { stopped = true },
  }
  let scrolled = false
  for (let at: Node | null = target; at && !stopped; at = at.parent) {
    const handler = at.props.onMouseScroll
    if (typeof handler === 'function') (handler as (wheel: Wheel) => void)(event)
    if (stopped || scrolled || at.kind !== 'scrollbox') continue
    ;(at as Wheeled).scrollBy?.(direction === 'down' ? WHEEL_ROWS : -WHEEL_ROWS)
    scrolled = true
  }
}

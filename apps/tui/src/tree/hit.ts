import { laysOut, type Node } from './node'

// What the pointer is over, and where a wheel and a press go from there.
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
// does). A press is the other half and it is delivered the same way, from the node under the pointer
// upwards — what it *means* is the store's, which reads it off the root
// (../keys/regions.ts § Clicks are hit tests).

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

/** A mouse press as the two handlers in this package read one, which is OpenTUI's `MouseEvent` cut
 *  down to the members they touch: the store wants the button and what was hit, and a stop's own
 *  handler wants nothing at all (`../keys/regions.ts § focusClicked`, `../keys/stops.ts § pressable`). */
export type Press = {
  x: number
  y: number
  button: number
  target: Node
  preventDefault: () => void
  stopPropagation: () => void
}

/** The left button, as `MouseButton.LEFT` numbers it. Spelled here rather than imported because this
 *  module deliberately reaches no OpenTUI, and it is the store that compares the two. */
const LEFT = 0

/** What answers a mouse press, which is a slot on the node rather than a prop: the store assigns one
 *  to the root and `../keys/stops.ts` assigns one to every pressable box, both imperatively, both on
 *  the object (`../tree/compat.ts`). */
type Pressed = { onMouseDown?: (event: Press) => void }

/**
 * Deliver one left press at a cell: from the node under the pointer upwards, each node's own handler.
 *
 * The order is the old painter's, where a mouse event runs each renderable's handler before it hands
 * the event to its parent, and both ends of the walk are load-bearing. A stop's own handler presses
 * what was clicked; the root's is the store's, which walks back up from `target` to the nearest thing
 * that can hold the keys and focuses it. So a click focuses and presses, in that order, which is the
 * whole of this host's pointer model (docs/tui.md § What the TUI never does).
 */
export function pressAt(root: Node, x: number, y: number): void {
  const target = hit(root, x, y)
  if (!target) return
  let stopped = false
  const event: Press = {
    x,
    y,
    button: LEFT,
    target,
    preventDefault: () => {},
    stopPropagation: () => { stopped = true },
  }
  for (let at: Node | null = target; at && !stopped; at = at.parent) {
    (at as Pressed).onMouseDown?.(event)
  }
}

import Yoga from 'yoga-layout'
import type { Node as YogaNode } from 'yoga-layout'
import { laysOut, measuresText, type Node } from '../tree/node'
import { measureRun } from './measure'

// Yoga, once, through its WebAssembly build, and the two operations the tree needs from it.
//
// **Why the synchronous entry.** Neither entry is synchronous. There is one binary in the package and
// both reach it: `yoga-layout` is a module that says `await loadYoga()` at the top level and exports
// the result, `yoga-layout/load` is the same call left for the caller. So the choice only decides
// where the await happens, and `../main.tsx` already awaits at the top level, which makes this the
// one that costs nothing (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md § Spike 2).
// The one thing it forbids is `require()` from CommonJS, and nothing in this package requires
// anything.
//
// **Why the same engine OpenTUI uses.** 153 boxes already say `flexDirection`, `flexGrow` and `gap`,
// and OpenTUI lays them out with Yoga. Using the same engine is what makes the golden frames from
// phase 0 match cell for cell and the eight layouts port without redesign. Speed is not the reason
// and not a worry: a 1,708-node list-detail lays out in 0.19 ms warm and 1.9 ms with every row
// changed, against a 5 ms budget.
//
// **Two things Yoga does that a caller has to respect.** Attaching a child to a node with a measure
// function aborts the wasm module — catchable, and the module survives, but it prints two lines to
// stderr, which in a TUI paints straight over the frame. So `../tree/renderer.ts` asserts against it
// rather than discovering it in a pane. And `free()` on a still-attached node does not throw; it
// leaves the parent holding a freed pointer. So freeing unlinks first, both from the parent and from
// the children, each of which is freed by its own owner.

/** A node's own Yoga node, made in `createElement` and freed when the owner that made it is disposed.
 *  A `span` and a `#text` get none: their parent `text` measures them as one run. */
export function createYogaNode(node: Node): YogaNode | null {
  if (!laysOut(node.kind)) return null
  const yoga = Yoga.Node.create()
  // A `text` is a leaf to Yoga and measures its own content, which is also why nothing may be
  // attached under it.
  if (measuresText(node.kind)) yoga.setMeasureFunc(measureRun(node))
  return yoga
}

/** Give the Yoga node back, having unlinked it first.
 *
 *  Both directions. Upward because a freed pointer left in a parent's child list is read by the next
 *  pass; downward because each child's Yoga node belongs to the owner that created it, so freeing
 *  recursively from here would free something that is about to free itself. */
export function freeYogaNode(node: Node): void {
  const yoga = node.yoga
  if (!yoga) return
  node.yoga = null
  yoga.getParent()?.removeChild(yoga)
  for (let count = yoga.getChildCount(); count > 0; count -= 1) yoga.removeChild(yoga.getChild(count - 1))
  yoga.free()
}

export { Yoga }

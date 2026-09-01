// The reconciler this host draws through: `@opentui/solid`, with loose text wrapped on the way in.
//
// This is the one structural difference between the two hosts, and until now every component answered
// it separately. A run of text in cells must have a `text` parent; on the DOM a bare string anywhere
// is a text node nobody thinks about. So `<Stack>{count()}</Stack>` is correct kit that draws on one
// host and throws on the other, and the throw is the bad kind: it comes out of `_insertNode` deep
// inside a signal write, which aborts that whole update pass and leaves every other reader of that
// signal un-notified. The screen stops following and nothing says why. Four separate crashes in one
// week were this, wearing four different values: `""`, `"7"`, `"8"`, and a pending `lazy()`.
//
// `cells.tsx` answers it three times over — `flatten` for a node that draws a line, `hasNode` to ask
// which it is, `slot` for a child that lands in a box — and every one of the seventy-six kit nodes has
// to reach for the right one. That is a convention, not a guarantee, and a convention loses: the
// component that forgets is found by a reader, in production, months later. It also does nothing for
// the chrome, the layouts, the tree host, or a plugin's own tree, none of which are kit.
//
// So the host answers it once, here, at the only place every one of them passes through.
//
// **Why `insert` and not `insertNode`.** OpenTUI builds its renderer by handing a node-ops object to
// `createRenderer`, and neither the object nor `createRenderer` is exported, so the `insertNode` that
// throws cannot be replaced. What can is `insert`, which is what the JSX transform emits for a dynamic
// child and what every one of those four crashes came through. Wrapping the value before the
// reconciler sees it means the check inside `insertNode` never fires.
//
// **Narrow on purpose.** Only a string or a number, only when the parent is certainly a box, and only
// through arrays. Everything else is handed straight to OpenTUI. A `<text>` parent still gets its raw
// string, so a run of styled words is still one `text` and still wraps and clips as one thing
// (cells.tsx § Run).
//
// What this does *not* forgive: a component type this host has no renderable for. `<main>` from a DOM
// component is still "Unknown component type", and it should be — that is a surface on the wrong host,
// not a shape the DOM absorbs (docs/tui.md § A descriptor source's list).
//
// **Destroy on disposal.** The second thing this file answers, and the worse one. OpenTUI destroys a
// renderable a tick after it leaves the tree (`_removeNode`, @opentui/solid 0.5.9 index.js:549), and
// that tick — `process.nextTick` — always runs before any promise settles. Solid's `Suspense` removes
// its children when it suspends and hands the *same instances* back when it resolves, because its
// children memo is created once; OpenTUI refuses a destroyed renderable ("was already destroyed,
// skipping add", @opentui/core) and draws nothing. So any boundary that has shown content and then
// suspends again — a browse row landing on an uncached pull, a detail panel following the caret — went
// permanently blank, and the warning popped the console overlay over what was left. The zero-latency
// test fixture could never reach this shape, which is why every browse test passed while the app did
// not (../browseSlow.test.tsx is the one that reaches it).
//
// The fix is to take "removed" out of the destroy decision. Solid's ownership graph already knows the
// difference this code was guessing at: a real unmount — a `For` row dropped, a `Show` flipped, a
// route change — disposes the owner that created the node, while `Suspense` keeps its children's
// owners alive on purpose, that being its whole contract. So `createElement` below ties each node's
// destruction to its creating owner: detached with a live owner means "may come back, keep it";
// owner disposed means destroy on the next tick if still detached. Attached teardown (the renderer
// destroying its whole tree child-first) still destroys promptly, because the children are still
// attached when the recursion reaches them. This is what the DOM gives Solid for free — removal
// detaches, garbage collection destroys — restated in a runtime with explicit destruction.

import { BoxRenderable, type Renderable } from '@opentui/core'
import { getOwner, onCleanup } from 'solid-js'
import {
  createElement as makeElement,
  createTextNode as makeTextNode,
  insert as reconcilerInsert,
  insertNode as reconcilerInsertNode,
} from '@opentui/solid/index.js'

export * from '@opentui/solid/index.js'

/** A node that outlives its removal, as long as the owner that created it is alive.
 *
 *  `_removeNode`'s next-tick destroy only fires on a node that is still detached, so the override's
 *  three cases are: attached (the renderer tearing down its tree, child-first, reaches every child
 *  while its parent pointer is still set) — destroy; owner disposed — destroy; detached with a live
 *  owner — a `Suspense` may hand this exact instance back, so keep it. `destroy()` is idempotent in
 *  @opentui/core, so the paths overlapping costs nothing. A node created outside any owner keeps
 *  OpenTUI's prompt destroy, which is the right answer for something no reactive scope will ever
 *  re-insert. */
const tieDestroyToOwner = (node: Renderable): Renderable => {
  if (!getOwner()) return node
  let disposed = false
  const destroy = node.destroyRecursively.bind(node)
  ;(node as { destroyRecursively: () => void }).destroyRecursively = () => {
    if (node.parent || disposed) destroy()
  }
  onCleanup(() => {
    disposed = true
    // Next tick rather than now: disposal and removal race in either order within one update pass,
    // and destroying an attached node mid-pass is the class of throw this file exists to end.
    process.nextTick(() => {
      if (!node.isDestroyed && !node.parent) destroy()
    })
  })
  return node
}

/** Every element the transform makes, tied to its owner on the way out (see the header). */
export function createElement(tag: string): Renderable {
  return tieDestroyToOwner((makeElement as (tag: string) => Renderable)(tag))
}

/** A `text` renderable holding one run, which is what a box can take and a bare string is not. */
const asText = (value: string | number): Renderable => {
  const element = createElement('text')
  reconcilerInsertNode(element, makeTextNode(String(value)))
  return element
}

/**
 * The same value, with any loose text in it wrapped.
 *
 * Recursive through arrays, because a fragment is an array and the mixed case is the common one:
 * `<Line><Icon />{count()}</Line>` is one element and one accessor, and only the second half needs
 * wrapping. An accessor is read here rather than passed on, which keeps the read inside the render
 * effect that `insert` is already running it in — so the wrap stays reactive.
 */
const wrapped = (value: unknown): unknown => {
  if (typeof value === 'string' || typeof value === 'number') {
    // An empty string is nothing, which is what the DOM draws for it and what a pending `lazy()`
    // resolves to. Returning null rather than an empty `text` keeps it out of the layout entirely.
    return value === '' ? null : asText(value)
  }
  if (Array.isArray(value)) return value.map(wrapped)
  // A nested accessor, which is how a value arrives from deeper than the first read: a `lazy()` is a
  // memo inside the memo `insert` was handed, and OpenTUI reads it in a render effect of its own. Hand
  // back a wrapping accessor rather than a value, so each of those reads is guarded too. This is the
  // one that catches a pending `lazy()` resolving to an empty string, which is the shape that made a
  // `Suspense` load-bearing at every mount point.
  if (typeof value === 'function') return () => wrapped((value as () => unknown)())
  return value
}

export function insert(parent: unknown, accessor: unknown, marker?: unknown, initial?: unknown): unknown {
  // Only where the parent is certainly a box. A `text` parent takes its string raw, and anything this
  // file cannot identify is OpenTUI's business rather than ours.
  if (!(parent instanceof BoxRenderable)) {
    return (reconcilerInsert as (...args: unknown[]) => unknown)(parent, accessor, marker, initial)
  }
  return (reconcilerInsert as (...args: unknown[]) => unknown)(parent, wrapped(accessor), marker, initial)
}

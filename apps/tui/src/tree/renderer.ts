import { createMemo, getOwner, onCleanup, splitProps, untrack, type JSX as SolidJSX } from 'solid-js'
import { createRenderer } from 'solid-js/universal'
import { focusedRenderable, onScreen, scheduleSettle } from '../keys/regions'
import { invalidateRun } from '../layout/measure'
import { applyProp, flexShrinkFor, SHRINK_DEPENDS } from '../layout/props'
import { createYogaNode, freeYogaNode } from '../layout/yoga'
import { INTRINSIC, KINDS, measuresText, textOwner, type Node } from './node'
import { markInserted, markRemoved, makeNode } from './compat'
import { requestFrame } from './frames'

// The reconciler this host draws through: ours, over plain objects.
//
// `solid-js/universal` wants ten node operations and this is all ten of them. The module is the
// target of the `moduleName` alias in `../../vite.config.ts`, so every JSX call in the process lands
// here — client-core's components and a sandboxed plugin's included — and it exports the same three
// names `@opentui/solid` does (`render`, `Dynamic`, `extend`) so that pointing the alias at it is the
// whole switch.
//
// **What it replaces, and why the replacements are absences.** Both overrides in
// `../kit/reconciler.ts` and both prototype patches in `../renderGuard.ts` exist because a
// `Renderable` has a lifecycle, has behaviour, and reads its own size. A plain object has none of the
// three, so:
//
//   - The orphan-text rule goes. A `#text` under a `box` is legal here; paint draws it as a one-line
//     run at the box's content origin. Four crashes in one week were a bare `{count()}` under a
//     `<Stack>`, and the shape that caused them is now just a shape.
//   - The destroy-on-detach race goes. `removeNode` unlinks and keeps the object. When `Suspense`
//     hands the same instance back on resolve — which it does, because its children memo is created
//     once — `insertNode` links it again and it still has its Yoga node. There is nothing to be
//     "already destroyed".
//
// **What did not become an absence: the Yoga handle.** It is a wasm pointer, so somebody has to give
// it back. Solid's ownership graph already knows the difference the old code was guessing at: a real
// unmount disposes the owner that created the node, while `Suspense` keeps its children's owners
// alive on purpose. So `createElement` ties the free to the creating owner with `onCleanup`, the same
// trick `../kit/reconciler.ts` used for `tieDestroyToOwner`, and a node made outside any owner frees
// when it is removed instead, which is the right answer for something no reactive scope will
// re-insert.

/** Nodes with no owner to free them. A `WeakSet` rather than a field, because the `Node` type is
 *  deliberately the whole type and this is bookkeeping, not state anything reads. */
const freeOnRemove = new WeakSet<Node>()

// Through `./compat.ts`, which puts the region store's view of a node on its prototype while the
// store is still typed on OpenTUI's tree. The fields it sets are this file's; the accessors are that
// file's, and phase 4 deletes them.
const make = (kind: Node['kind']): Node => makeNode(kind)

/** The nearest `text` ancestor has to re-measure, because what it measures is the concatenation of
 *  everything under it. A no-op anywhere else in the tree, which is most of the time. */
function runChanged(node: Node): void {
  const owner = textOwner(node)
  if (!owner) return
  invalidateRun(owner)
  // Only a node with a measure function may be marked dirty, which the owner is by construction.
  owner.yoga?.markDirty()
}

export function createElement(tag: string): Node {
  const kind = KINDS[tag]
  // A tag this host has no kind for is a surface on the wrong host — `<main>` from a DOM component —
  // and saying so is better than drawing an empty box (docs/tui.md § A descriptor source's list).
  if (!kind) throw new Error(`Unknown component type: <${tag}>`)
  const node = make(kind)
  node.yoga = createYogaNode(node)
  // What the kind arrives with, through `setProperty` rather than written on the side, so the prop
  // and Yoga and the derived shrink all see it (./node.ts § INTRINSIC).
  for (const [name, value] of Object.entries(INTRINSIC[kind] ?? {})) setProperty(node, name, value)
  if (node.yoga) {
    if (getOwner()) onCleanup(() => freeYogaNode(node))
    else freeOnRemove.add(node)
  }
  return node
}

export function createTextNode(text: string): Node {
  const node = make('#text')
  node.text = text
  return node
}

export function replaceText(node: Node, text: string): void {
  node.text = text
  runChanged(node)
  requestFrame()
}

export const isTextNode = (node: Node): boolean => node.kind === '#text'
export const getParentNode = (node: Node): Node | undefined => node.parent ?? undefined
export const getFirstChild = (node: Node): Node | undefined => node.children[0]
export const getNextSibling = (node: Node): Node | undefined => {
  const siblings = node.parent?.children
  return siblings?.[siblings.indexOf(node) + 1]
}

/** Where this node's Yoga child goes, which is not where its tree child goes: a `span` and a `#text`
 *  have no Yoga node, so they take no slot. */
function yogaIndex(parent: Node, upTo: number): number {
  let index = 0
  for (let at = 0; at < upTo; at += 1) if (parent.children[at]!.yoga) index += 1
  return index
}

export function insertNode(parent: Node, node: Node, anchor?: Node): void {
  // Attaching a child to a Yoga node that has a measure function aborts the wasm module. It is a
  // catchable throw and the module survives it, but it prints two lines to stderr first, and stderr
  // in a TUI paints straight over the frame. So refuse it here, where the message can say what to do
  // instead of somebody finding it in a pane.
  if (measuresText(parent.kind) && node.yoga) {
    throw new Error(`A <${node.kind}> cannot go inside a <text>; use a <span> for a run of styled words`)
  }
  // A node that still has a parent is being moved, not removed. Unlinked rather than removed, because
  // a removal is what decides whether an ownerless node's Yoga handle goes back, and a move must not.
  if (node.parent) unlink(node.parent, node)
  const found = anchor ? parent.children.indexOf(anchor) : -1
  const index = found < 0 ? parent.children.length : found
  parent.children.splice(index, 0, node)
  node.parent = parent
  markInserted(node)
  if (parent.yoga && node.yoga) parent.yoga.insertChild(node.yoga, yogaIndex(parent, index))
  runChanged(parent)
  requestFrame()
}

/** Take the child out of both trees, ours and Yoga's, and leave the question of freeing to the
 *  caller. */
function unlink(parent: Node, node: Node): void {
  const index = parent.children.indexOf(node)
  if (index >= 0) parent.children.splice(index, 1)
  node.parent = null
  if (parent.yoga && node.yoga) parent.yoga.removeChild(node.yoga)
  runChanged(parent)
}

export function removeNode(parent: Node, node: Node): void {
  unlink(parent, node)
  // And marked, which is the one thing the store cannot work out for itself. A removed node is not
  // destroyed here — that is the whole point, since `Suspense` hands the same object back — so
  // "gone" has to be a fact somebody records rather than a lifecycle anybody can read
  // (./compat.ts § removed).
  markRemoved(node)
  // Nothing is freed here unless nothing else will. The Yoga node outlives the removal because Solid
  // may hand this exact object back, and the owner that made it is what decides otherwise.
  if (freeOnRemove.has(node)) freeYogaNode(node)
  // A node leaving the tree is one of the two ways the keys end up nowhere, and it is the one the old
  // painter noticed by destroying the renderable a tick later. Here nothing is destroyed, so the
  // store is told: the landing pass walks the parents before it decides, and a node whose chain no
  // longer reaches the root cannot hold them. Only where they have actually gone, because a pass that
  // ran on every removal would reveal the focused node in its viewports on every re-render
  // (../keys/regions.ts § The landing rule, § ensureFocus).
  //
  // Untracked, because this runs inside whatever computation was updating the tree and a tracked read
  // of the focus signal would make every one of them re-run when the keys move.
  if (!untrack(() => onScreen(focusedRenderable()))) scheduleSettle()
  requestFrame()
}

export function setProperty(node: Node, name: string, value: unknown): void {
  node.props[name] = value
  if (node.yoga) applyProp(node.yoga, name, value)
  // A shrink nobody said is derived from the size somebody did, the way the old painter derived it,
  // so all three props are re-read whenever any one of them lands — they arrive one at a time and in
  // whatever order the JSX spelled them (../layout/props.ts § flexShrinkFor).
  if (node.yoga && SHRINK_DEPENDS.has(name)) node.yoga.setFlexShrink(flexShrinkFor(node.props))
  // How a run wraps is an input to its measure function rather than a Yoga style, so the cache has
  // to be told by hand.
  if (name === 'wrapMode') runChanged(node)
  requestFrame()
}

const renderer = createRenderer<Node>({
  createElement,
  createTextNode,
  replaceText,
  isTextNode,
  setProperty,
  insertNode,
  removeNode,
  getParentNode,
  getFirstChild,
  getNextSibling,
})

// Everything else the Solid transform emits by module name. The ten operations above are the same
// functions the renderer was built from, so they are exported directly rather than through it.
export const { effect, memo, createComponent, insert, spread, setProp, mergeProps, use } = renderer

/** Mount a tree under a root node and return the dispose.
 *
 *  The root belongs to the screen, so `../main.tsx` and both harnesses hand one in. A caller with no
 *  screen gets a bare box to mount into, which is what the tree's own tests want.
 *
 *  `JSX.Element` rather than `Node` on the way in, because a caller writes JSX and tsc types that
 *  against the ambient JSX namespace. Both namespaces in play — ours in `./jsx.ts` and the one the
 *  `@jsxImportSource` pragma still names — say `Element` is Solid's own, so this is the type a caller
 *  actually holds. What arrives is a `Node`, because `createElement` above is what built it. */
export function render(code: () => SolidJSX.Element, root: Node = createElement('box')): () => void {
  return renderer.render(code as unknown as () => Node, root)
}

/** A component chosen at runtime, and the universal one rather than `solid-js/web`'s: the DOM version
 *  would put a second Solid renderer in the process. Six chrome and plugin surfaces use it
 *  (`../chrome/Shell.tsx`, `../chrome/Rail.tsx`, `../chrome/slot.tsx`, `../kit/host.tsx`,
 *  `../plugins/TreeHost.tsx`, `../plugins/SourcePanel.tsx`).
 *
 *  A memo is what comes back and `JSX.Element` is what it is called, for the reason `render` above
 *  gives: Solid unwraps a function in a child position, so the accessor is the element as far as
 *  anything reading it is concerned. */
export function Dynamic<T extends Record<string, unknown>>(
  props: T & { component: ((props: T) => SolidJSX.Element) | undefined },
): SolidJSX.Element {
  const [own, rest] = splitProps(props, ['component'])
  return createMemo(() => {
    const chosen = own.component
    // Untracked, so the chosen component's own reads belong to its own owner rather than to this memo.
    return chosen ? untrack(() => createComponent(chosen as unknown as (props: T) => Node, rest as unknown as T)) : undefined
  }) as unknown as SolidJSX.Element
}

export { laysOut, measuresText, runText, textOwner } from './node'
export type { Kind, Node } from './node'
export type { JSX } from './jsx'

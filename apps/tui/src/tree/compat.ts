import { isFieldKind, laysOut, type Kind, type Node } from './node'

// The `Renderable`-shaped view of a node, and the whole reason it exists is that the region store is
// still typed on OpenTUI's tree.
//
// `../keys/regions.ts` is 1,071 lines that walk `parent`, read `visible`, `isDestroyed` and
// `focusable` and a rectangle off a node, and index a node among `getChildren()`. None of that is OpenTUI's Zig
// half — it is a tree walk over whatever the components handed it through a `ref` — so the cheapest
// way to run the store over our nodes is to answer those names. Phase 4 rewrites the store against
// `Node` directly and deletes this file; a rewrite now would be the same work done twice, against a
// painter nothing yet draws with.
//
// **A prototype per kind, not fields per node.** Two reasons, and the second is the surprising one.
// An accessor per node would be ten `defineProperty` calls on every one of the 1,708 nodes a pane
// builds; and `../golden.ts § focusPath` holds a focused node's path as `constructor.name` per step,
// which is `BoxRenderable` in every golden phase 0 captured. A named constructor function per kind
// answers that for free, so a frame's focus path compares without the golden being touched.
//
// **What is deliberately not answered.** `instanceof` — a shim cannot be an instance of somebody
// else's class, so the two `instanceof ScrollBoxRenderable` tests in the store ask
// `../keys/regions.ts § isViewport` instead. And none of this holds state of its own: every accessor
// reads a field the tree or the layout pass already wrote, and `focusable` and `onMouseDown`, which
// the components and the store assign, are plain properties on an ordinary object.

/** The class name OpenTUI's renderer gave each kind, which is what a golden's focus path holds. */
const CLASS: Readonly<Record<Kind, string>> = {
  box: 'BoxRenderable',
  text: 'TextRenderable',
  span: 'TextNodeRenderable',
  scrollbox: 'ScrollBoxRenderable',
  input: 'InputRenderable',
  textarea: 'TextareaRenderable',
  pty: 'EmbeddedTerminalRenderable',
  '#text': 'TextNodeRenderable',
}

/** Every node gets an id, because `scrollChildIntoView` and the key trace both name one. A counter
 *  rather than anything meaningful: the ids are minted per render and no golden holds one. */
let minted = 0

/**
 * The tops of the subtrees Solid has removed and not put back.
 *
 * The one thing the store still needs that "a node is data" does not answer by itself. Nothing here
 * is destroyed, which is the fault class this painter exists to end — `Suspense` hands the same
 * object back on resolve and it has to still work — but a node whose subtree was removed and never
 * re-inserted is not on the screen either, and the store's whole question about a node is whether it
 * can still hold the keys.
 *
 * Only the top of a removed subtree is unlinked, so this holds only tops and the question is asked of
 * the end of a parent walk (`../keys/regions.ts § onScreen`). A `WeakSet` rather than a field for the
 * reason `./renderer.ts § freeOnRemove` is one: `Node` is deliberately the whole type, and this
 * is bookkeeping rather than state anything draws from.
 */
const removed = new WeakSet<Node>()

/** Solid took this subtree out. Called by `removeNode`. */
export const markRemoved = (node: Node): void => { removed.add(node) }

/** …and put it back, which is what `Suspense` resolving looks like. Called by `insertNode`, which is
 *  also where a *move* lands, so a node that was only relocated is never left marked. */
export const markInserted = (node: Node): void => { removed.delete(node) }

/** Is this node the top of a subtree that is no longer in the tree? Asked of the end of a parent
 *  walk, and false for anything the old painter drew, because nothing ever marks one of those. */
export const isRemoved = (node: unknown): boolean => removed.has(node as Node)

const accessors = {
  // The last layout, under the four names the store reads it by.
  x: { get(this: Node) { return this.rect.x } },
  y: { get(this: Node) { return this.rect.y } },
  width: { get(this: Node) { return this.rect.w } },
  height: { get(this: Node) { return this.rect.h } },
  // A prop the layout pass turns into `DISPLAY_NONE` and paint skips, read here as the flag the store
  // walks with (`onScreen`). Absent means visible, which is what every box that says nothing means.
  visible: {
    get(this: Node) { return this.props.visible !== false },
    // Nothing in the app writes it — the shell and the tab panels hide a subtree through the prop —
    // and the setter is here so that if something ever does, the write lands where the prop is
    // instead of throwing or shadowing it.
    set(this: Node, value: boolean) { this.props.visible = value },
  },
  // Nothing is ever destroyed here, which is the fault class this painter exists to end: a plain
  // object has no lifecycle to be on the wrong side of (./node.ts).
  isDestroyed: { get() { return false } },
  // What can hold the keys. An ordinary property everywhere else — `../keys/stops.ts` and five
  // components write it on the node they built, and `../invariants.test.ts` counts those places — and
  // an accessor here for the three kinds that arrive with a default of their own. OpenTUI's
  // `ScrollBoxRenderable` is focusable unless told otherwise, which is what makes a viewport the stop
  // of last resort for a document with no controls in it (`../keys/regions.ts § stopsIn`). Without it
  // a `list-detail` narrow enough to show one half at a time had nothing to put the keys on, so `l`
  // never reached the layer that switches the halves. An `input` and a `textarea` are the other two,
  // through the flag `EditBufferRenderable` sets true on itself, and they are why nothing typed under
  // this painter before phase 3's second slice: no component asks a field to be focusable, so the
  // store would not give it the keys and there was nothing for the hand-off to type into
  // (`../keys/install.ts § typeInto`). Backed by `props`, so a write lands where the getter reads it
  // rather than shadowing the accessor.
  focusable: {
    get(this: Node) {
      const said = this.props.focusable as boolean | undefined
      return said ?? (this.kind === 'scrollbox' || isFieldKind(this.kind))
    },
    set(this: Node, value: boolean) { this.props.focusable = value },
  },
  // The caret, which is the one thing about focus the store still asks a renderable for
  // (`../keys/regions.ts § paintCaret`). Still no-ops rather than absences, because the store calls
  // them unconditionally — and deliberately so now that there is a caret to draw. A field asks the
  // store whether it has the keys and writes the answer into its own props, where paint reads it, so
  // the mirror stays one-way: nothing here holds focus state for the store to disagree with
  // (`../kit/asking.tsx § ownInput`, `../paint/paint.ts § drawField`).
  focus: { value() {} },
  blur: { value() {} },
  getChildren: {
    value(this: Node) {
      // The children that lay out. A `span` and a `#text` are part of their parent's one run, so they
      // are not nodes to a walk that is looking for stops.
      return this.children.filter((child) => laysOut(child.kind))
    },
  },
} as const

/** One prototype per kind, made once. */
const PROTOTYPES: Partial<Record<Kind, object>> = {}

const prototypeFor = (kind: Kind): object => {
  const made = PROTOTYPES[kind]
  if (made) return made
  // A named function purely so `constructor.name` answers what the goldens hold (see the header).
  const shim = { [CLASS[kind]]: function () {} }[CLASS[kind]] as unknown as { prototype: object }
  Object.defineProperties(shim.prototype, accessors as unknown as PropertyDescriptorMap)
  PROTOTYPES[kind] = shim.prototype
  return shim.prototype
}

/** A fresh node of this kind, with the store's view of it on its prototype. */
export function makeNode(kind: Kind): Node {
  const node = Object.create(prototypeFor(kind)) as Node & { id: number }
  node.kind = kind
  node.props = {}
  node.parent = null
  node.children = []
  node.yoga = null
  node.rect = { x: 0, y: 0, w: 0, h: 0 }
  node.id = (minted += 1)
  return node
}

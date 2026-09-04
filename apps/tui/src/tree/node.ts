import type { Node as YogaNode } from 'yoga-layout'

// What Solid creates, patches and moves: a plain object, and nothing else.
//
// The point of the type being this short is that it cannot carry the fault class it replaces. A
// `Renderable` has a lifecycle, so it can be destroyed a tick after it detaches and refuse to come
// back — which blanked every `Suspense` boundary that suspended twice. It has behaviour, so a `text`
// can refuse a bare child and a `span` can drop a colour prop in silence. And it reads its own size
// from Yoga, so an unmeasured node hands `NaN` to something strict from inside the render loop. A
// plain object cannot do any of the three: it has whatever fields the layout pass wrote, it holds
// whatever children it was given, and there is nothing to be "already destroyed"
// (docs/tui.md § Rendering).
//
// Deliberately absent, so nobody adds them back by habit: focus is the region store's one value
// (`../keys/regions.ts`), visibility is `props.visible` which layout turns into `DISPLAY_NONE`, and
// a scroll offset and an edit state are props the widget components own.

/** The kinds a tag can be. Fixed: this host has no component catalogue to extend, which is why
 *  `extend` in `./renderer.ts` registers nothing. */
export type Kind = 'box' | 'text' | 'span' | 'scrollbox' | 'input' | 'textarea' | 'pty' | '#text'

export type Node = {
  kind: Kind
  props: Record<string, unknown>
  parent: Node | null
  children: Node[]
  /** Null for `#text` and `span`, which have no box of their own: their parent `text` measures them
   *  as part of one run, and Yoga aborts outright on a child under a node with a measure function. */
  yoga: YogaNode | null
  /** The last layout, clamped (`../layout/pass.ts`). Only paint reads it, plus the two callers that
   *  legitimately want last frame's size: a layout's breakpoint and a `pty` rectangle's `size()`. */
  rect: { x: number; y: number; w: number; h: number }
  /** `#text` only. */
  text?: string
}

/** The tag the JSX transform emits, mapped to the kind we lay out and paint.
 *
 *  Anything not on this list is a surface on the wrong host — `<main>` from a DOM component — and
 *  should say so rather than draw an empty box. */
export const KINDS: Readonly<Record<string, Kind>> = {
  box: 'box',
  text: 'text',
  span: 'span',
  scrollbox: 'scrollbox',
  input: 'input',
  textarea: 'textarea',
  pty: 'pty',
}

/**
 * What a kind arrives with, before a single JSX prop lands on it.
 *
 * One entry, and it is `InputRenderable`'s constructor: it hands `height: 1` to the textarea it
 * extends, so a field is a cell tall whatever is in it. Said as a prop rather than straight to Yoga
 * because the height decides a second thing — `../layout/props.ts § flexShrinkFor` reads a numeric
 * height as "does not shrink", which is what keeps a field its full width in an overflowing row, and
 * a height set behind the prop's back would have left it shrinking.
 *
 * Applied in `./renderer.ts § createElement`, before a single JSX prop lands, so a call site that
 * wants a taller field can still say so.
 */
export const INTRINSIC: Partial<Readonly<Record<Kind, Readonly<Record<string, unknown>>>>> = {
  input: { height: 1 },
}

/** Does this kind get a Yoga node of its own? */
export const laysOut = (kind: Kind): boolean => kind !== 'span' && kind !== '#text'

/** Does this kind measure its own text, which makes it a leaf to Yoga? */
export const measuresText = (kind: Kind): boolean => kind === 'text'

/** Does this kind measure its own wrapped value, which also makes it a leaf to Yoga?
 *
 *  A `textarea` only. An `input` is a cell tall by `INTRINSIC` above and needs no measure of its own,
 *  and giving it one would be a second answer to its height. */
export const measuresField = (kind: Kind): boolean => kind === 'textarea'

/** Does this kind hold text of its own that a reader types into? Asked by paint, by the layout pass
 *  and by the dispatcher's typing hand-off, each of which has a different reason to care
 *  (../keys/regions.ts § isField). */
export const isFieldKind = (kind: Kind): boolean => kind === 'input' || kind === 'textarea'

/** The nearest ancestor that measures text, starting at the node itself. What a `#text` or a `span`
 *  has to tell to re-measure when its content changes. */
export function textOwner(node: Node): Node | null {
  for (let at: Node | null = node; at; at = at.parent) if (measuresText(at.kind)) return at
  return null
}

/** The concatenated text of a `text` node's run: its own `#text` and `span` children, in order.
 *
 *  A `span` is a styled stretch inside one `text`, so it contributes its characters and not a box of
 *  its own. That is what keeps a line of styled words wrapping and clipping as one thing rather than
 *  as a row of independently shrunk boxes (../kit/cells.tsx § Run). */
export function runText(node: Node): string {
  if (node.kind === '#text') return node.text ?? ''
  let out = ''
  for (const child of node.children) out += runText(child)
  return out
}

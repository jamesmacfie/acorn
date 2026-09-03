import { colorOr, toColor } from '../colour'
import { measuredRun } from '../layout/measure'
import { laysOut, type Node } from '../tree/node'
import { sliceToWidth } from '../width'
import {
  ATTRS, clipOf, fill, intersect, isEmptyClip, put, wholeOf, writeRun,
  type Buffer, type Clip, type Style,
} from './buffer'

// The tree into the cells: one depth-first walk, and every behaviour the old renderables had.
//
// This is where the rendering fault class ends, because the three things a `Renderable` did wrong are
// all decisions this file makes instead (docs/future/terminal-rewrite/review.md § 2a to § 2c):
//
//   a `#text` under a box     is a one-line run at the box's content origin. It was an error thrown
//                             from inside whatever signal had just moved, and four crashes in one
//                             week were a bare `{count()}` under a `<Stack>`.
//   a `span`'s colour         is read here, off the span, and inherited from its parent `text` where
//                             it names none. A span that dropped its colour drew every line of every
//                             diff in the parent's — which was white, on a white terminal.
//   a rectangle we mistrust   is clipped rather than believed. A node's rectangle says where its
//                             content goes and the clip says which cells may show it, and the two
//                             differ exactly when something overflows.
//
// **Clipping is unconditional.** A child is clipped to its parent's content box whatever `overflow`
// says, which is stricter than the CSS meaning of `visible`. Nothing in the kit positions a child
// outside its parent — there is no `position` setter in `../layout/props.ts` at all — so the only way
// to be outside one is to overflow it, and a run drawn over a sibling is never the answer we want.
// The early-out on an empty clip is also what makes a subtree scrolled off screen free.
//
// **What is not here.** A scroll offset, an edit cursor and the emulator's cells are phase 3, so a
// `scrollbox`, an `input`, a `textarea` and a `pty` draw as the boxes they are until then — which is
// all they are to layout as well.

/** The six characters a border draws with, and there is one set because there is one style.
 *
 *  `../kit/roles.ts § boxBorder` answers `borderStyle: 'single'` for every box, always. What the
 *  border role decides is the *sides*: `surface` is a box, so it draws all four, and `divider` is a
 *  glyph, so a `Rule` asks for `['top']` or `['left']` and gets one line or one column
 *  (client-core kit/tokens/roles.ts § border). A second set — heavy, rounded — is a second const and
 *  a lookup on `borderStyle` on the day a style pack asks for one, and not before. */
const SINGLE = { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘' } as const

type Sides = { top: boolean; right: boolean; bottom: boolean; left: boolean }

const NO_SIDES: Sides = { top: false, right: false, bottom: false, left: false }

/** A run with nothing said about it: the terminal's own foreground, no attributes, and the background
 *  it is drawn onto left alone. */
const PLAIN: Style = { fg: 'default', attrs: 0 }

/** The four bits we can actually emit. A mask a role hands us may carry more — OpenTUI's italic and
 *  strikethrough live in the same number — and a bit paint cannot write is a bit the diff should not
 *  think changed. */
const KNOWN_ATTRS = ATTRS.bold | ATTRS.dim | ATTRS.underline | ATTRS.inverse

/** Which sides a `border` prop asks for. `true` is a box, an array is the edges a `Rule` names, and
 *  anything else is no border — including the `false` `boxBorder` returns where a role draws none. */
function sidesOf(value: unknown): Sides {
  if (value === true) return { top: true, right: true, bottom: true, left: true }
  if (!Array.isArray(value)) return NO_SIDES
  const sides = { ...NO_SIDES }
  for (const side of value as unknown[]) {
    if (side === 'top' || side === 'right' || side === 'bottom' || side === 'left') sides[side] = true
  }
  return sides
}

const anySide = (sides: Sides): boolean => sides.top || sides.right || sides.bottom || sides.left

const maskOf = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) ? value & KNOWN_ATTRS : 0

/** A node's own run style, over the one it inherits.
 *
 *  Two shapes, because a `span` and a `text` do not take the same props yet: a `text` gets `fg` and
 *  an attribute mask, and a `span` gets one `style` object with the attributes as booleans, which is
 *  what `../kit/roles.ts § spanStyle` still answers. The slice that merges the two leaves this
 *  reading one shape; until then reading both is what keeps a styled word inside a sentence its own
 *  colour. Attributes accumulate down the run and a colour replaces, which is what nesting a
 *  `strong` inside a muted line means. */
function styleOf(node: Node, inherited: Style): Style {
  const props = node.props
  const bag = typeof props.style === 'object' && props.style !== null
    ? (props.style as Record<string, unknown>)
    : undefined
  let attrs = inherited.attrs | maskOf(props.attributes)
  if (bag) {
    for (const name of Object.keys(ATTRS) as (keyof typeof ATTRS)[]) if (bag[name] === true) attrs |= ATTRS[name]
  }
  return { fg: colorOr(props.fg ?? bag?.fg, inherited.fg), attrs }
}

type Segment = { text: string; style: Style }

/** A run's children as styled stretches, in order.
 *
 *  Concatenated, these are exactly the string `../layout/measure.ts` measured, which is the invariant
 *  that keeps the run paint draws the run that was wrapped. A `box` cannot appear here: `insertNode`
 *  refuses one under a `text`. */
function segmentsOf(children: readonly Node[], style: Style, into: Segment[]): Segment[] {
  for (const child of children) {
    if (child.kind === '#text') into.push({ text: child.text ?? '', style })
    else if (!laysOut(child.kind)) segmentsOf(child.children, styleOf(child, style), into)
  }
  return into
}

/** The stretches covering one slice of the run, in order, each cut to the slice. */
function piecesOf(segments: readonly Segment[], from: number, to: number): Segment[] {
  const pieces: Segment[] = []
  let at = 0
  for (const segment of segments) {
    const end = at + segment.text.length
    if (end > from && at < to) {
      pieces.push({ text: segment.text.slice(Math.max(0, from - at), Math.min(segment.text.length, to - at)), style: segment.style })
    }
    at = end
    if (at >= to) break
  }
  return pieces
}

/** A `text`: the lines its measure produced, each drawn in the styles of the spans that own it.
 *
 *  The rectangle and the run are two different widths and paint needs both. A column container
 *  stretches its children across, so a seven-cell run inside a nine-cell box has a `rect.w` of 9 and
 *  a measured width of 7: the rectangle is what we clip to, and the run is what we place
 *  (../layout/layout.test.ts § the text measure).
 *
 *  Each line is a contiguous slice of the run, so its offset is found by looking for it from where the
 *  last line ended — the only thing between two lines is the space or the newline the wrap consumed.
 *  Reconstructing the offset rather than carrying it is what keeps `measuredRun` the single answer
 *  about where the breaks are; a second opinion here would be a line out on every wrapped paragraph. */
function drawText(node: Node, buffer: Buffer, clip: Clip): void {
  const own = intersect(clip, clipOf(node.rect))
  if (isEmptyClip(own)) return
  const style = styleOf(node, PLAIN)
  const segments = segmentsOf(node.children, style, [])
  const flat = segments.reduce((text, segment) => text + segment.text, '')
  const { lines } = measuredRun(node, node.rect.w)

  let at = 0
  for (let row = 0; row < lines.length; row += 1) {
    const line = lines[row]!
    const found = flat.indexOf(line, at)
    const from = found < 0 ? at : found
    let x = node.rect.x
    for (const piece of piecesOf(segments, from, from + line.length)) {
      x += writeRun(buffer, own, x, node.rect.y + row, piece.text, piece.style)
    }
    at = from + line.length
  }
}

/** The caption in the top edge, cut to the room between the corners.
 *
 *  A cell of edge either side of it, which is what a bordered panel reads as: `┌─Keys──────┐`.
 *  `left` is the only alignment this app asks for (`../panel.tsx`) and the other two are here because
 *  the prop offers them. */
function drawTitle(
  buffer: Buffer, clip: Clip, node: Node, sides: Sides, title: string, style: Style,
): void {
  const rect = node.rect
  const from = rect.x + (sides.left ? 1 : 0)
  const to = rect.x + rect.w - (sides.right ? 1 : 0)
  const room = to - from - 2
  if (room <= 0) return
  const caption = sliceToWidth(title, room)
  if (caption.text === '') return
  const spare = room - caption.width
  const alignment = node.props.titleAlignment
  const offset = alignment === 'center' ? Math.floor(spare / 2) : alignment === 'right' ? spare : 0
  writeRun(buffer, clip, from + 1 + offset, rect.y, caption.text, style)
}

/** The edges a border draws, and a corner only where the two edges that meet it are both drawn. A
 *  `Rule` is one edge with no corners at all, which is how a single line becomes the divider between
 *  two regions. */
function drawBorder(buffer: Buffer, clip: Clip, rect: Node['rect'], sides: Sides, style: Style): void {
  if (rect.w <= 0 || rect.h <= 0) return
  const glyphs = SINGLE
  const right = rect.x + rect.w - 1
  const bottom = rect.y + rect.h - 1
  if (sides.top) for (let x = rect.x; x <= right; x += 1) put(buffer, clip, x, rect.y, glyphs.h, style)
  if (sides.bottom) for (let x = rect.x; x <= right; x += 1) put(buffer, clip, x, bottom, glyphs.h, style)
  if (sides.left) for (let y = rect.y; y <= bottom; y += 1) put(buffer, clip, rect.x, y, glyphs.v, style)
  if (sides.right) for (let y = rect.y; y <= bottom; y += 1) put(buffer, clip, right, y, glyphs.v, style)
  if (sides.top && sides.left) put(buffer, clip, rect.x, rect.y, glyphs.tl, style)
  if (sides.top && sides.right) put(buffer, clip, right, rect.y, glyphs.tr, style)
  if (sides.bottom && sides.left) put(buffer, clip, rect.x, bottom, glyphs.bl, style)
  if (sides.bottom && sides.right) put(buffer, clip, right, bottom, glyphs.br, style)
}

/** A box, and every kind that is a box until phase 3 gives it content of its own. */
function drawBox(node: Node, buffer: Buffer, clip: Clip): void {
  const own = intersect(clip, clipOf(node.rect))
  if (isEmptyClip(own)) return
  const props = node.props

  if (props.backgroundColor !== undefined) fill(buffer, own, clipOf(node.rect), toColor(props.backgroundColor))

  const sides = sidesOf(props.border)
  if (anySide(sides)) {
    const style: Style = { fg: toColor(props.borderColor), attrs: 0 }
    drawBorder(buffer, own, node.rect, sides, style)
    if (sides.top && typeof props.title === 'string') drawTitle(buffer, own, node, sides, props.title, style)
  }

  // Inside the border, which is where a child is and where a loose run goes. Clipped to it as well,
  // so an overflowing child eats its own frame rather than the box's.
  const content = {
    x: node.rect.x + (sides.left ? 1 : 0),
    y: node.rect.y + (sides.top ? 1 : 0),
    w: Math.max(0, node.rect.w - (sides.left ? 1 : 0) - (sides.right ? 1 : 0)),
    h: Math.max(0, node.rect.h - (sides.top ? 1 : 0) - (sides.bottom ? 1 : 0)),
  }
  const inner = intersect(own, clipOf(content))

  // A `#text` or a `span` directly under a box, which nothing laid out, drawn as one line at the
  // content origin. The orphan-text rule made unnecessary rather than moved.
  const loose = node.children.filter((child) => !laysOut(child.kind))
  if (loose.length > 0) {
    const text = segmentsOf(loose, PLAIN, [])
    let x = content.x
    for (const piece of text) x += writeRun(buffer, inner, x, content.y, piece.text, piece.style)
  }

  for (const child of node.children) if (laysOut(child.kind)) drawNode(child, buffer, inner)
}

function drawNode(node: Node, buffer: Buffer, clip: Clip): void {
  // `visible === false` is skipped whole, which is also what Yoga does with `DISPLAY_NONE`, so the
  // two agree without a rule between them (../layout/props.ts § visible).
  if (node.props.visible === false) return
  if (node.kind === 'text') drawText(node, buffer, clip)
  else drawBox(node, buffer, clip)
}

/** The whole tree into the whole buffer. Called once a frame, after layout. */
export function paint(root: Node, buffer: Buffer): void {
  drawNode(root, buffer, wholeOf(buffer))
}

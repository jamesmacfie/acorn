/** @jsxImportSource @opentui/solid */
import { Show, type JSX } from 'solid-js'
import type { TextRole, Tone } from '@acorn/client-core/kit/tokens/tokens.ts'
import { borderCell, styled, textStyle } from './roles'
import { slotColor } from '../appearance'
import { paintColor } from '../colourCompat'
import { sliceToWidth, stringWidth } from '../width'

// The three things every component in this package needs, and the reason each exists.
//
// A cell host is stricter than the DOM in one structural way: a run of text must have a `text`
// parent. On the DOM a bare string anywhere is a text node nobody thinks about, so the kit's
// element-typed props — `leading`, `trailing`, `meta`, `actions`, `icon` — are handed bare strings by
// panes writing perfectly correct kit. That difference belongs to the host, not to the caller.

/** A prop that takes "some UI" and is often handed a bare string. Wraps one, drops an empty one, and
 *  passes a real tree through. */
export const slot = (value: JSX.Element): JSX.Element => {
  if (value === null || value === undefined || value === false || value === true) return null
  if (typeof value === 'string' || typeof value === 'number') {
    return value === '' ? null : <text>{String(value)}</text>
  }
  // An accessor, which is what Solid compiles a dynamic child to: `<Line><Icon />{count()}</Line>` is
  // an array of one element and one function. Read it and wrap what comes back, the same thing
  // `flatten` and `hasNode` below do with the same shape — this was the one of the three that did not,
  // so the string went through untouched, Solid inserted it raw, and a row holding a node beside a
  // count threw "Orphan text error" from inside whatever signal had just moved. Reading it here is
  // tracked, because `slot` is called from inside the JSX that renders it.
  if (typeof value === 'function') return slot((value as () => unknown)() as JSX.Element)
  // An array mixes the three, and a fragment is an array: `hint={<><Kbd>⌘↵</Kbd> to send</>}` is one
  // node and one bare string, and the string on its own would land in a box, which is the shape a cell
  // host refuses outright (docs/tui.md).
  if (Array.isArray(value)) return value.map((item) => slot(item as JSX.Element)) as unknown as JSX.Element
  return value
}

/** Children as one string, for a node that draws a line rather than a box. A terminal has no inline
 *  flow: `text` takes content, so a run of words has to arrive as words. */
export const flatten = (value: unknown): string => {
  if (value === null || value === undefined || value === false || value === true) return ''
  if (Array.isArray(value)) return value.map(flatten).join('')
  if (typeof value === 'function') return flatten((value as () => unknown)())
  return String(value)
}

/** Is there a node in here rather than words?
 *
 *  A pane may hand a node that draws a line another kit node: a `Row` labelled with a `Text`, a `Badge`
 *  inside a `Chip`. `flatten` turns one into `[object Object]`, because a renderable has no text to
 *  read off it — which is how the pane sweep found this, on the file rows of the changes pane and the
 *  item rows of the context pane. So a line asks first, and a line whose children are a tree draws the
 *  tree instead (docs/tui.md).
 *
 *  Its own function so `Line` stays one expression, and exported because `Row` asks the same question
 *  about the same children when it decides whether the `match` role is its to apply. */
export function hasNode(value: unknown): boolean {
  if (value === null || value === undefined || typeof value === 'boolean') return false
  if (Array.isArray(value)) return value.some(hasNode)
  if (typeof value === 'function') return hasNode((value as () => unknown)())
  return typeof value === 'object'
}

/** One run of text at a role and a tone. The workhorse: no component in this package builds a `text`
 *  by hand, so no component can name a colour or an attribute of its own.
 *
 *  Children that are a tree rather than words go through untouched, in a row: the role and the tone
 *  belong to a run of text, and a node inside brought its own. */
export function Line(props: { role?: TextRole; tone?: Tone; wrap?: boolean; children: JSX.Element }) {
  const run = () => styled(flatten(props.children), props.role, props.tone)
  return (
    <Show when={hasNode(props.children)} fallback={
      <text {...run().style} wrapMode={props.wrap ? 'word' : 'none'}>{run().text}</text>
    }>
      <box flexDirection="row" gap={0}>{slot(props.children)}</box>
    </Show>
  )
}

/** One styled run *inside* a line, rather than a line of its own.
 *
 *  A `text` renderable is a box to yoga, so a row of them is a row of boxes: at a width they do not
 *  fit, each is shrunk and each clips its own content, which turned "hash but `signIn` still" into
 *  "hash bsignInstill" on the agents transcript. A `span` is a run inside one `text`, so the whole
 *  line wraps and clips as one thing — which is what a line of styled words is
 *  (docs/tui.md).
 *
 *  Only for a caller that owns the `text` around it. Everything else uses `Line`.
 *
 *  Both shapes of one answer, because the two painters read a span's colour in different places. Ours
 *  reads the props, the same ones a `text` takes. The old one ignores every prop on a text node but
 *  `href` and `style` and reads the colour and the attributes out of that one object as booleans, so a
 *  span given only props drew in its parent's colour — which was white, on a white terminal, on every
 *  line of every diff. Saying it twice is what keeps one component source drawing the same cells under
 *  both, and phase 4 drops the `style` half (./roles.ts § textStyle). */
export function Run(props: { role?: TextRole; tone?: Tone; children: JSX.Element }) {
  const run = () => styled(flatten(props.children), props.role, props.tone)
  return <span {...run().style} style={run().style}>{run().text}</span>
}

/** A divider between two regions, along the axis it separates: a line across for `x`, a column of
 *  cells for `y`.
 *
 *  One side of a box's border rather than a run of repeated characters, so the renderer draws it to
 *  whatever width or height the layout gave it and nothing here measures anything. Drawn only where
 *  the `divider` border role has a glyph at all: a style pack may set it to nothing, and then this
 *  draws nothing and the layout is still correct, which is the role's own promise. */
export function Rule(props: { axis?: 'x' | 'y' }) {
  const vertical = () => props.axis === 'y'
  return (
    <Show when={borderCell('divider').glyph}>
      <box border={vertical() ? ['left'] : ['top']} borderStyle="single" borderColor={paintColor(slotColor('default'))} flexShrink={0} />
    </Show>
  )
}

/** The style of a run, for the few places that hand `text` its own content. */
export const runStyle = (role?: TextRole, tone?: Tone) => {
  const { transform: _transform, ...style } = textStyle(role, tone)
  return style
}

/** Cut to a width, with a `…` where something was cut. Every truncating node — `Table`, `Grid`, a
 *  `Row`'s meta — cuts the same way, so a reader learns the mark once.
 *
 *  Cells, not characters. `String.length` is wrong three ways — two code units for one astral
 *  character, one cell for a wide one, a cell for a combining mark that takes none — so a column
 *  holding any of the three did not line up with the one above it. The fixture is entirely ASCII,
 *  where the two answers agree, which is why nobody has seen it (../width.ts). */
export function ellipsise(value: string, width: number): string {
  if (width <= 0) return ''
  if (stringWidth(value) <= width) return value
  // A cell for the mark itself, and `sliceToWidth` gives back a whole cluster: cutting one code point
  // short of a wide character would otherwise leave the run a cell narrower than the column.
  return `${sliceToWidth(value, width - 1).text}…`
}

/** Pad to a width, for a column that has to line up with the one above it. Padded by cells for the
 *  same reason, because `padEnd` counts code units. */
export function pad(value: string, width: number): string {
  const cut = ellipsise(value, width)
  return cut + ' '.repeat(Math.max(0, width - stringWidth(cut)))
}

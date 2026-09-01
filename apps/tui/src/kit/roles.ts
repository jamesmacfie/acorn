import { TextAttributes } from '@opentui/core'
import type { RGBA } from '@opentui/core'
import { roleCell, type CellAttribute, type CellStyle } from '@acorn/client-core/kit/tokens/roles.ts'
import type { Border, Space, TextRole, Tone } from '@acorn/client-core/kit/tokens/tokens.ts'
import { isCompact, slotColor } from '../appearance'

// Roles as cells: what a role token means to a terminal, as something a renderable can be handed.
//
// The decision is `roleCell()`'s, in client-core, beside the sentence it came from. This file is the
// last inch: turning a `CellStyle` into the props OpenTUI's renderables take. Nothing in this package
// names a colour, a gap or a box character — it asks for a role, and the answer arrives here.

export type Style = {
  fg: RGBA
  attributes?: number
  transform?: (value: string) => string
}

const bits: Record<CellAttribute, number> = {
  bold: TextAttributes.BOLD,
  dim: TextAttributes.DIM,
  underline: TextAttributes.UNDERLINE,
  inverse: TextAttributes.INVERSE,
}

const attributes = (cell: CellStyle): number =>
  (cell.attrs ?? []).reduce((mask, attr) => mask | bits[attr], TextAttributes.NONE)

/** A run of text: its colour, its weight, and whether the role changes the characters themselves. */
export function textStyle(role: TextRole | undefined, tone?: Tone): Style {
  const text = roleCell('text', role ?? 'body')
  const colour = tone ? roleCell('tone', tone) : undefined
  return {
    // Always a colour, never omitted: an unset `fg` is opaque white to OpenTUI rather than the
    // terminal's own foreground (../appearance.ts).
    //
    // The tone decides where one is given, and the text role decides where one is not. Both name a
    // slot now, and a caller that passes neither still lands on `default` — which is what makes
    // `role="muted"` a grey rather than the default foreground with the dim bit set.
    fg: slotColor(colour?.slot ?? text.slot),
    attributes: attributes(text) | (colour ? attributes(colour) : 0),
    ...(text.upper ? { transform: (value: string) => value.toUpperCase() } : {}),
  }
}

/** The same answer as a `span` takes, which is not the same shape a `text` takes.
 *
 *  A `text` renderable gets `fg` and an attribute bitmask as props. A `span` inside one gets neither:
 *  the Solid reconciler ignores every prop on a text node except `href` and `style`, and reads the
 *  colour and the attributes out of that one object as booleans
 *  (`@opentui/solid` § setProperty, `@opentui/core` § createTextAttributes). A `fg` handed to a span
 *  is dropped without a word, so the run inherits its parent `text`'s colour — and a parent that was
 *  given none draws opaque white, which on a light terminal is white on white. That was every
 *  markdown paragraph and every line of every diff. */
export const spanStyle = (role: TextRole | undefined, tone?: Tone): {
  fg: RGBA
  bold?: boolean
  dim?: boolean
  underline?: boolean
  inverse?: boolean
} => {
  const style = textStyle(role, tone)
  return {
    fg: style.fg,
    ...(style.attributes! & TextAttributes.BOLD ? { bold: true } : {}),
    ...(style.attributes! & TextAttributes.DIM ? { dim: true } : {}),
    ...(style.attributes! & TextAttributes.UNDERLINE ? { underline: true } : {}),
    ...(style.attributes! & TextAttributes.INVERSE ? { inverse: true } : {}),
  }
}

/** The whole answer for a run, with the transform already applied. Most components want this. */
export const styled = (value: string, role?: TextRole, tone?: Tone): { text: string; style: Style } => {
  const style = textStyle(role, tone)
  return { text: style.transform ? style.transform(value) : value, style }
}

/** Cells of gap a space role spends along a row, and lines it spends down a column. Density decides
 *  whether the blank line is spent at all: it is the one style axis a terminal keeps. */
export const spaceCells = (space: Space | undefined): number => roleCell('space', space ?? 'inline').cells ?? 0
export const spaceLines = (space: Space | undefined): number => {
  const lines = roleCell('space', space ?? 'stack').lines ?? 0
  return isCompact() ? 0 : lines
}

/** The border props for a box drawing a border role, and no colour at all where it draws no box.
 *
 *  Two things about OpenTUI a caller has to answer for. Its own border colour is opaque white, the
 *  same trap a run of text has; and a `borderColor` handed to a box with no border switches the border
 *  back on, so the colour has to be absent exactly when the box is. */
export const boxBorder = (border: Border, opts: { when?: boolean; tone?: Tone } = {}): {
  border: boolean
  borderStyle: 'single'
  borderColor: RGBA | undefined
} => {
  const box = (opts.when ?? true) && borderCell(border).box
  return {
    border: box,
    borderStyle: 'single',
    borderColor: box ? slotColor(roleCell('tone', opts.tone ?? 'neutral').slot) : undefined,
  }
}

/** What a border role draws: a box around the thing, a character to repeat, or nothing. */
export function borderCell(border: Border): { box: boolean; glyph: string; attributes: number } {
  const cell = roleCell('border', border)
  return { box: cell.box === true, glyph: cell.glyph ?? '', attributes: attributes(cell) }
}

/** A rule across a box, which is the `divider` role repeated. Compact density spends nothing, which
 *  is what the role's own sentence says. */
export const rule = (width: number): string => (isCompact() ? '' : borderCell('divider').glyph.repeat(Math.max(0, width)))

/**
 * How a control draws its state: the role and the tone a `Line` inside it takes.
 *
 * Focus is the one that matters and it is the caret's equivalent for something that presses — a
 * terminal has no ring to draw, so a focused control is `strong` in the `accent` tone and everything
 * else about its characters is unchanged (docs/tui.md § Rendering). `strong` on its own is the
 * pressed and armed state a `Button` already drew; `disabled` wins over both, because a control that
 * will not press should not look like the one that will.
 */
export const litControl = (state: {
  focused?: boolean
  strong?: boolean
  disabled?: boolean
  tone?: Tone
}): { role: TextRole; tone: Tone | undefined } => ({
  role: state.focused || state.strong ? 'strong' : 'body',
  tone: state.disabled ? 'muted' : state.focused ? 'accent' : state.tone,
})

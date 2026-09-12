import { roleCell, type CellStyle } from '@acorn/client-core/kit/tokens/roles.ts'
import type { Border, Space, TextRole, Tone } from '@acorn/client-core/kit/tokens/tokens.ts'
import type { Color } from '../colour'
import { isCompact, slotColor } from '../appearance'
import { ATTRS } from '../paint/buffer'

// Roles as cells: what a role token means to a terminal, as something a renderable can be handed.
//
// The decision is `roleCell()`'s, in client-core, beside the sentence it came from. This file is the
// last inch: turning a `CellStyle` into the props a run of cells takes. Nothing in this package names
// a colour, a gap or a box character — it asks for a role, and the answer arrives here.
//
// The attribute bits are `../paint/buffer.ts`'s: bold 1, dim 2, underline 8, inverse 32, with the
// gaps at 4 and 16 where italic and blink would be. The positions are the ones every terminal
// library uses, so a mask read off a frame is the number a reader expects.

export type Style = {
  /** A `../colour.ts` colour: the terminal's own foreground, one of its sixteen slots, or a triple. */
  fg: Color
  attributes: number
  /** The same four bits as booleans. Not a second answer: a `span` under the old painter reads its
   *  colour and its weight out of one object and ignores an `attributes` prop entirely, so a run
   *  inside a line has to be told both ways (§ Run). */
  bold?: true
  dim?: true
  underline?: true
  inverse?: true
  transform?: (value: string) => string
}

/** A role's attribute list as the mask paint reads. `ATTRS` is keyed by exactly the four names a
 *  `CellAttribute` can be, so there is no table between them.
 *
 *  A loop rather than a seeded `reduce`, and the reason is a grep: `../keys/tiers.test.ts` forbids a
 *  keymap priority spelled outside the tier table and finds one by looking for a bare number after a
 *  closing bracket, which `}, 0)` reads as. */
function attributes(cell: CellStyle): number {
  let mask = 0
  for (const attr of cell.attrs ?? []) mask |= ATTRS[attr]
  return mask
}

/**
 * A run of text: its colour, its weight, and whether the role changes the characters themselves.
 *
 * One answer for a `text` and for a `span`, which used to be two. The shapes differ, not the
 * decision: a `text` takes `fg` and a mask as props and a `span` takes one object with booleans in
 * it, so this returns both and each caller spends the half it needs (§ Run, ./cells.tsx).
 */
export function textStyle(role: TextRole | undefined, tone?: Tone): Style {
  const text = roleCell('text', role ?? 'body')
  const colour = tone ? roleCell('tone', tone) : undefined
  // The tone decides where a colour is given, and the text role decides where one is not. Both name a
  // slot, and a caller that passes neither still lands on `default` — which is what makes
  // `role="muted"` a grey rather than the default foreground with the dim bit set.
  const mask = attributes(text) | (colour ? attributes(colour) : 0)
  return {
    fg: slotColor(colour?.slot ?? text.slot),
    attributes: mask,
    ...(mask & ATTRS.bold ? { bold: true } : {}),
    ...(mask & ATTRS.dim ? { dim: true } : {}),
    ...(mask & ATTRS.underline ? { underline: true } : {}),
    ...(mask & ATTRS.inverse ? { inverse: true } : {}),
    ...(text.upper ? { transform: (value: string) => value.toUpperCase() } : {}),
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
  borderColor: Style['fg'] | undefined
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

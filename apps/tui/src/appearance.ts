import type { Slot } from '@acorn/client-core/kit/tokens'
import type { Color } from './colour'

// Appearance in a terminal: which colour a slot is, and which of the style axes survive.
//
// The desktop's theme is forty-odd colour tokens read off `:root`. A terminal has sixteen slots, dim
// and bold, and — if it says so — twenty-four bits of colour. So the theme collapses here, once, and
// `roleCell()` is the only thing that names a slot: no component in this package spells a colour.
//
// The default is deliberately the terminal's own palette. A person's terminal already has a theme
// they chose, and drawing acorn's over the top of it is the thing every TUI that hardcodes hexes gets
// wrong. `paletteFor` is what a theme is for: a caller that knows the theme's colours and knows the
// terminal will take them can hand both over.
//
// The appearance layer exposes the eight relevant built-in colour tokens as data from its own CSS
// source. A configured theme uses those tokens when the terminal supports truecolour.

/** The two backgrounds a list row can ask for: `selected` behind the row the keys are on, `hover`
 *  behind the row that is open while the keys are somewhere else. The desktop draws the same rows
 *  with the same two theme colours. */
export type Surface = 'hover' | 'selected'

/** The six colours a role can ask for, and the two row backgrounds. `default` is the terminal's own
 *  foreground, and its own background when a surface asks for it. */
export type Palette = Record<Slot | Surface, Color>

/** The terminal's own slots, in two of `./colour.ts`'s three answers: the terminal's own foreground,
 *  or one of its sixteen numbered slots. Either way the colour comes from the theme the person chose
 *  rather than from us.
 *
 *  Both are said out loud rather than left unset or named. An unset colour is easy to paint as opaque
 *  white, which on a light background is white on white, and a named one is easy to read as the CSS
 *  colour (`cyan` as `#00FFFF`). The painter writes `39` for `default` and `30 + n` for a slot
 *  (./paint/flush.ts). */
export const TERMINAL_PALETTE: Palette = {
  default: 'default',
  // Slot 8, the palette's own grey, is what `muted` is instead of the `dim` attribute: dim blends a
  // run toward the background, so on a light terminal it draws white on white
  // (client-core/kit/tokens/roles.ts § tone).
  muted: 8,
  accent: 6,
  ok: 2,
  warn: 3,
  danger: 1,
  // No fill. None of the sixteen slots is a background that every theme's text stays legible on, so
  // a row without a theme colour keeps only its caret.
  hover: 'default',
  selected: 'default',
}

/** Which theme token feeds which slot. Eight of the forty: the six text colours and the two row
 *  backgrounds. The rest are other backgrounds, borders and diff colours, which a terminal does not
 *  paint. */
const FROM_TOKEN: Record<Slot | Surface, string> = {
  default: '--text',
  muted: '--text-muted',
  accent: '--accent',
  ok: '--state-ok',
  warn: '--state-warn',
  danger: '--state-bad',
  hover: '--bg-hover',
  selected: '--bg-selected',
}

/** Does this terminal say it can take a 24-bit colour? Where it does not, a hex is worse than the
 *  slot name: the emulator quantises it to a slot anyway, and to the wrong one. */
export const reportsTruecolor = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit'

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** A `#rgb` or `#rrggbb` as the triple a terminal takes. Three-digit form doubles each nibble, which
 *  is what CSS means by it. */
const fromHex = (hex: string): Color => {
  const body = hex.slice(1)
  const full =
    body.length === 3
      ? body
          .split('')
          .map((part) => part + part)
          .join('')
      : body
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as unknown as Color
}

/** A theme's palette as the six slots. Truecolor passes the theme's own value through; anything else
 *  falls back to the terminal's slot, including a colour written as `oklch(...)`, which a terminal
 *  cannot take at all. */
export function paletteFor(theme: Readonly<Record<string, string | undefined>>, truecolor: boolean): Palette {
  const palette = { ...TERMINAL_PALETTE }
  if (!truecolor) return palette
  for (const slot of Object.keys(FROM_TOKEN) as (Slot | Surface)[]) {
    const value = theme[FROM_TOKEN[slot]]?.trim()
    if (value && HEX.test(value)) palette[slot] = fromHex(value)
  }
  return palette
}

let palette: Palette = TERMINAL_PALETTE

/** The colour a slot resolves to right now. A role that names no slot still gets one: an absent
 *  colour is a colour somebody downstream has to guess at, so "no colour of its own" is said as the
 *  default slot instead. */
export const slotColor = (slot: Slot | undefined): Color => palette[slot ?? 'default']

/** The background a row surface resolves to right now. */
export const surfaceColor = (surface: Surface): Color => palette[surface]

/** Swap the palette when the device configuration changes. */
export const setPalette = (next: Palette): void => {
  palette = next
}

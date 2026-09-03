import type { Slot } from '@acorn/client-core/kit/tokens/roles.ts'
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
// No theme is read, and phase 4 found out why it cannot be yet: a theme in acorn is an id, and its
// forty tokens live in a `:root[data-theme=…]` block in a stylesheet. There is no JS-readable table of
// them — the only reader is `infra/styles/readStyleSheets.ts`, which walks the repo from
// `pnpm-workspace.yaml` and is test-only by construction. So the terminal cannot resolve a theme's
// colours without the appearance layer publishing them as data, and that is the appearance layer's
// change to make, not this file's. `paletteFor` is written and tested against the tokens, so the day
// they are published this is a call site rather than a design.

/** The six colours a role can ask for. `default` is the terminal's own foreground. */
export type Palette = Record<Slot, Color>

/** The terminal's own slots, as `./colour.ts`'s three answers: the terminal's own foreground, or one
 *  of its sixteen numbered slots. Either way the colour comes from the theme the person chose rather
 *  than from us.
 *
 *  Both have to be said out loud, and that is the whole of the light-terminal bug — under the painter
 *  we are leaving. A run with no colour was not the terminal's foreground to OpenTUI, it was opaque
 *  white, which on a light background is white on white; and a colour *named* was worse, because it
 *  read `cyan` as the CSS colour and sent `#00FFFF`. Our painter writes `39` for `default` and
 *  `30 + n` for a slot, so the class is answered where the colour is emitted
 *  (./paint/flush.ts). */
export const TERMINAL_PALETTE: Palette = {
  default: 'default',
  // Slot 8, the palette's own grey, is what `muted` is instead of the `dim` attribute: dim blends a
  // run toward the background, so on a light terminal it drew white on white
  // (client-core/kit/tokens/roles.ts § tone).
  muted: 8,
  accent: 6,
  ok: 2,
  warn: 3,
  danger: 1,
}

/** Which theme token feeds which slot. Six of the forty; the rest are backgrounds, borders and diff
 *  colours, and a terminal has no surface to paint. */
const FROM_TOKEN: Record<Slot, string> = {
  default: '--text',
  muted: '--text-muted',
  accent: '--accent',
  ok: '--state-ok',
  warn: '--state-warn',
  danger: '--state-bad',
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
  const full = body.length === 3 ? body.split('').map((part) => part + part).join('') : body
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as unknown as Color
}

/** A theme's palette as the five slots. Truecolor passes the theme's own value through; anything else
 *  falls back to the terminal's slot, including a colour written as `oklch(...)`, which a terminal
 *  cannot take at all. */
export function paletteFor(theme: Readonly<Record<string, string | undefined>>, truecolor: boolean): Palette {
  const palette = { ...TERMINAL_PALETTE }
  if (!truecolor) return palette
  for (const slot of Object.keys(FROM_TOKEN) as Slot[]) {
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

/** Swap the palette. Phase 4's job, when the TUI can read the chosen theme off the node. */
export const setPalette = (next: Palette): void => { palette = next }

// Density is the one style axis a terminal keeps (docs/ui-design.md § Roles, and what each host makes
// of them). It decides whether a Section or a Card spends a blank line; shape, type and space have no
// answer here.
let density: 'compact' | 'default' = 'default'
export const isCompact = (): boolean => density === 'compact'
export const setDensity = (next: 'compact' | 'default'): void => { density = next }

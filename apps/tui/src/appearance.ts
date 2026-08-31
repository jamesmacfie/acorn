import type { Slot } from '@acorn/client-core/kit/tokens/roles.ts'

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
// No theme is read yet, because nothing in this host knows which one is chosen: the preference lives
// on the node and the TUI reaches it in phase 4 with the rest of the chrome. `paletteFor` is written
// and tested against the theme tokens, so that phase is a call site rather than a design.

/** The five colours a role can ask for. `default` is the terminal's own foreground. */
export type Palette = Record<Slot, string | undefined>

/** The terminal's own slots, by name. OpenTUI resolves these against whatever the terminal is set to,
 *  which is the theme the person actually chose. */
export const TERMINAL_PALETTE: Palette = {
  default: undefined,
  accent: 'cyan',
  ok: 'green',
  warn: 'yellow',
  danger: 'red',
}

/** Which theme token feeds which slot. Five of the forty; the rest are backgrounds, borders and diff
 *  colours, and a terminal has no surface to paint. */
const FROM_TOKEN: Record<Slot, string> = {
  default: '--text',
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

/** A theme's palette as the five slots. Truecolor passes the theme's own value through; anything else
 *  falls back to the terminal's slot, including a colour written as `oklch(...)`, which a terminal
 *  cannot take at all. */
export function paletteFor(theme: Readonly<Record<string, string | undefined>>, truecolor: boolean): Palette {
  const palette = { ...TERMINAL_PALETTE }
  if (!truecolor) return palette
  for (const slot of Object.keys(FROM_TOKEN) as Slot[]) {
    const value = theme[FROM_TOKEN[slot]]?.trim()
    if (value && HEX.test(value)) palette[slot] = value
  }
  return palette
}

let palette: Palette = TERMINAL_PALETTE

/** The colour a slot resolves to right now, or nothing for the terminal's own foreground. */
export const slotColor = (slot: Slot | undefined): string | undefined => (slot ? palette[slot] : undefined)

/** Swap the palette. Phase 4's job, when the TUI can read the chosen theme off the node. */
export const setPalette = (next: Palette): void => { palette = next }

// Density is the one style axis a terminal keeps (docs/ui-design.md § Roles, and what each host makes
// of them). It decides whether a Section or a Card spends a blank line; shape, type and space have no
// answer here.
let density: 'compact' | 'default' = 'default'
export const isCompact = (): boolean => density === 'compact'
export const setDensity = (next: 'compact' | 'default'): void => { density = next }

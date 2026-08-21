// The colour half of the theme axis, as a contract both sides read. See docs/ui-design.md § Plugin
// themes for the three-group split and why only the palette is declarable.

/** The palette a theme block must state in full. Colour values only; see the group note above. */
export const THEME_PALETTE_TOKENS = [
  '--bg', '--bg-subtle', '--bg-hover', '--bg-selected',
  '--border', '--border-strong',
  '--text', '--text-muted', '--text-faint',
  '--accent', '--focus',
  '--add-bg', '--add-marker', '--del-bg', '--del-marker',
  '--add-word-bg', '--del-word-bg',
  '--hunk-bg', '--hunk-text',
  '--warn', '--badge-border', '--shadow-popover',
] as const

/** Room for `oklch(0.7 0.15 250 / 0.42)` and nothing like a stylesheet. */
export const THEME_COLOR_VALUE_MAX = 64

// A hex literal, or one colour function with a flat argument list. See docs/ui-design.md § Plugin
// themes for why only these are accepted.
//
// The character set inside the parentheses excludes `(`, `)`, `;`, `{`, `}`, `<`, `\`, quotes, and
// control characters, so a value that passes this check cannot close the declaration, close the
// block, open a nested function, or open a tag. The anchor is exact: in JavaScript, `$` matches the
// end of the input, not the position before a trailing newline, so `#fff\n` fails both patterns.
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FUNCTION = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\([0-9a-z%.,/ +-]{1,56}\)$/i

/** Is this a colour value the host is willing to write into a generated theme block? */
export const isThemeColorValue = (value: string): boolean =>
  value.length <= THEME_COLOR_VALUE_MAX && (HEX.test(value) || FUNCTION.test(value))

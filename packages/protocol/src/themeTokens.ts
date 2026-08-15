// The colour half of the theme axis, as a contract both sides read.
//
// acorn's appearance is two axes on <html> — `data-theme` owns colour, `data-style` owns
// shape/type/space/density — and the token contract lives as data in
// `client-core/src/ui/tokenAxes.ts`, which is still the single declaration of which token belongs to
// which axis. What lives HERE is only the palette half of the theme axis, and it is here because a
// plugin theme is a manifest-declared map of exactly these names: the node has to be able to reject a
// theme that omits one, and the node cannot import the client.
//
// So `tokenAxes.ts` composes `THEME_TOKENS` from this list plus the two groups a manifest may not
// state (see below), and `styles/tokenAxes.test.ts` still asserts the stylesheets agree with it.
//
// THE THREE GROUPS, and why a manifest may only state the first:
//
//   PRIMITIVES (below, 22)  Restated per theme block. A colour and nothing else.
//   DERIVED (12)            `--danger`, `--surface-sunken`, … — declared ONCE on `:root` as `var()`
//                           references into the primitives, so they follow every theme for free.
//                           A theme block that restated one would break that derivation, which is
//                           why the manifest object below is strict rather than merely capped.
//   SELF-DESCRIPTION (3)    `--is-dark`, `--color-scheme`, `--syntax-fg`. Not colours at all, so
//                           they cannot go through the colour check; the host writes all three from
//                           a theme's one `dark` boolean instead of letting a manifest spell them.

/** The palette a theme block must state in full. Colour values only — see the group note above. */
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

// A hex literal, or one colour function with a flat argument list. Deliberately NOT "any CSS colour":
// named colours, `currentColor`, `inherit` and `var()` are all refused, because the promise this seam
// makes is that a plugin theme expresses colour and nothing else — a `var()` reaches other tokens and
// a keyword is not a colour the host can reason about.
//
// It is also the injection gate. The alphabet inside the parentheses excludes `(`, `)`, `;`, `{`, `}`,
// `<`, `\`, quotes and every control character, so a value that passes cannot close the declaration,
// close the block, start a nested function (`url(…)`, `expression(…)`, `image-set(…)`) or open a tag.
// Anchoring is exact: in JavaScript `$` matches end of INPUT, not before a trailing newline, so
// `#fff\n` fails both patterns.
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FUNCTION = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\([0-9a-z%.,/ +-]{1,56}\)$/i

/** Is this a colour value the host is willing to write into a generated theme block? */
export const isThemeColorValue = (value: string): boolean =>
  value.length <= THEME_COLOR_VALUE_MAX && (HEX.test(value) || FUNCTION.test(value))

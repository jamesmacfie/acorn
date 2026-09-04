import { RGBA } from '@opentui/core'
import type { Color } from './colour'

// A colour as the paint pass takes it, and what is left of the two painters having wanted different
// things (docs/future/terminal-rewrite/architecture.md § 3).
//
// `./appearance.ts` decides a colour and `./kit/roles.ts` hands it to a prop, and the prop's reader
// is our paint pass, which wants the `Color` it was given. So `paintColor` is the identity and only
// its type does anything: `tsconfig.json` still resolves `@opentui/solid` to the real package, so tsc
// checks the JSX props against OpenTUI's shapes and a role that handed a `Color` straight to a prop
// would not compile. Saying `RGBA` here is what keeps the forty call sites that spell a role from
// each needing a cast, and it goes when the package leaves `package.json`.

/** The colour as an `RGBA`, always. */
export const toRgba = (colour: Color): RGBA => {
  if (colour === 'default') return RGBA.defaultForeground()
  // An index keeps its indexed intent, which is what makes OpenTUI write `ESC[38;5;n` and ask the
  // terminal for the theme's own slot rather than for a hex of ours (../appearance.ts).
  if (typeof colour === 'number') return RGBA.fromIndex(colour)
  return RGBA.fromInts(colour[0], colour[1], colour[2])
}

/** The colour, unchanged, typed as the prop it is about to be written to (§ A colour as the paint
 *  pass takes it). */
export const paintColor = (colour: Color): RGBA => colour as unknown as RGBA

/** The same colour as the `{ r, g, b }` triple in 0 to 1 that the harness reports a run's foreground
 *  as, and that the phase 0 goldens therefore hold.
 *
 *  Through `RGBA` rather than through a table of ours, so the numbers a golden is compared against
 *  come from the same place the golden's did — `default` is `1, 1, 1`, slot 8 is `0.502`, and the
 *  comparison is about which slot a role chose rather than about two spellings of one grey. */
export const rgbOf = (colour: Color): { r: number; g: number; b: number } => {
  const rgba = toRgba(colour)
  return { r: rgba.r, g: rgba.g, b: rgba.b }
}

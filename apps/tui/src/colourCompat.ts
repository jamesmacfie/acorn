import { RGBA } from '@opentui/core'
import type { Color } from './colour'
import { drawsOwn } from './painter'

// A colour as the painter in this build takes it, and this file exists only while there are two of
// them (docs/future/terminal-rewrite/architecture.md § 3 budgets it at ten lines; phase 4 deletes it).
//
// `./appearance.ts` decides a colour and `./kit/roles.ts` hands it to a prop, and the prop's reader is
// either our paint pass, which wants a `Color`, or OpenTUI, which wants an `RGBA`. So the conversion
// is here, once, rather than at the forty call sites that spell a role.
//
// The return type is a lie under `own` and it is a deliberate one: `tsconfig.json` resolves
// `@opentui/solid` to the real package, so tsc type-checks the JSX props against OpenTUI's shapes
// whichever painter the build picked. Saying `RGBA` is what lets one component source compile for
// both. Under `own` the value that comes back is the `Color` it was handed, and `./paint/paint.ts`
// reads it as one.

/** The colour as an `RGBA`, always. */
export const toRgba = (colour: Color): RGBA => {
  if (colour === 'default') return RGBA.defaultForeground()
  // An index keeps its indexed intent, which is what makes OpenTUI write `ESC[38;5;n` and ask the
  // terminal for the theme's own slot rather than for a hex of ours (../appearance.ts).
  if (typeof colour === 'number') return RGBA.fromIndex(colour)
  return RGBA.fromInts(colour[0], colour[1], colour[2])
}

/** The colour, converted where the old painter is the one reading it. */
export const paintColor = (colour: Color): RGBA => (drawsOwn() ? (colour as unknown as RGBA) : toRgba(colour))

/** The same colour as the `{ r, g, b }` triple in 0 to 1 that both harnesses report a run's
 *  foreground as, and that the phase 0 goldens therefore hold.
 *
 *  Through `RGBA` rather than through a table of ours, so the numbers a golden is compared against
 *  come from the same place the golden's did — `default` is `1, 1, 1`, slot 8 is `0.502`, and the
 *  comparison is about which slot a role chose rather than about two spellings of one grey. */
export const rgbOf = (colour: Color): { r: number; g: number; b: number } => {
  const rgba = toRgba(colour)
  return { r: rgba.r, g: rgba.g, b: rgba.b }
}

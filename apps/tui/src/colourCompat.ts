import type { Color } from './colour'

// A colour as a test reads one back off the screen.
//
// `./appearance.ts` decides a colour, `./kit/roles.ts` hands it to a prop, and paint writes it — all
// three in `./colour.ts`'s own three answers, so nothing between them needs converting. What is left
// here is the one place a colour becomes something else: the `{ r, g, b }` triple in nought to one
// that the two harnesses report a run's foreground as, and that a test asserting "this run is the
// accent" compares (`../kit/kit.test.tsx`, `./diffLong.test.tsx`).
//
// The numbers are the standard sixteen at their usual values, which is what the old painter's `RGBA`
// answered and therefore what the assertions were written against: `default` is 1, 1, 1, a slot below
// eight is a half-intensity primary, and slot 8 is 0.502 grey.

/** The sixteen slots as nought-to-one triples, in the usual order: black, red, green, yellow, blue,
 *  magenta, cyan, white, then the bright eight. */
const HALF = 128 / 255
const SLOTS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [HALF, 0, 0], [0, HALF, 0], [HALF, HALF, 0],
  [0, 0, HALF], [HALF, 0, HALF], [0, HALF, HALF], [192 / 255, 192 / 255, 192 / 255],
  [HALF, HALF, HALF], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
]

/** The colour as the `{ r, g, b }` triple in nought to one a harness reports.
 *
 *  `default` is the terminal's own foreground, which nothing here can know, so it reads as white —
 *  which is the answer the assertions were written against and, more usefully, the one answer that is
 *  never mistaken for a slot a role chose. */
export const rgbOf = (colour: Color): { r: number; g: number; b: number } => {
  const [r, g, b] = colour === 'default'
    ? [1, 1, 1]
    : typeof colour === 'number'
      ? SLOTS[colour & 15] ?? [1, 1, 1]
      : [colour[0] / 255, colour[1] / 255, colour[2] / 255]
  return { r, g, b }
}

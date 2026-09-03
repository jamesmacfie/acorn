// How many cells a string takes. The one question a painter cannot get wrong, so it has one answer
// and both halves of the frame read it: layout asks it to wrap a run, paint asks it to place one.
//
// `String.length` is what the kit truncates by today, and it is wrong three ways: two code units for
// one astral character, one cell for a wide one, and a cell for a combining mark that takes none. The
// fixture never reaches any of the three, which is why nobody has seen it
// (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md § Spike 3).
//
// So: `Intl.Segmenter` for the cluster boundaries and a hand table of the East Asian Width `W` and
// `F` ranges for how wide each cluster's base is. Spike 3 weighed that against `string-width` and
// this is the one it picked. `string-width` asks `emoji-regex` first, which matches a bare
// text-presentation emoji, so it calls `▶`, `☑`, `⚠`, `⌨`, `☺`, `👁` and `🏷` two cells each —
// against the standard, against xterm, and against seven names the rail and the footer draw every
// frame. It also arrives in the tree as a dependency of `@opentui/core` and leaves with it, so
// taking it would be a new dependency rather than the reuse it looked like.
//
// The ASCII branch in front is not an optimisation we are being clever about, it is the difference
// between 1,946 us and 163 us on a 400-line wrap. Everything the fixture draws is ASCII and every
// pane's own text mostly is, so the segmenter is the exception path and it should look like one.
//
// This file knows nothing about OpenTUI and nothing about Yoga, so it runs on the Node the repo pins
// with no flag.

/** A string with nothing in it a terminal has to think about. One cell per character, and the answer
 *  agrees with the segmenter on every one of spike 3's 125 samples. */
const PLAIN = /^[\x20-\x7e]*$/

/** A cluster that starts with a mark or a format character has no base of its own, so it costs
 *  nothing: it is drawn over whatever came before it. This is the class OpenTUI's paint got wrong
 *  while its own layout got it right, which is how an accented name drew a column too wide per mark
 *  and clobbered the cell beside it. */
const MARKLESS = /^[\p{Mn}\p{Me}\p{Cf}\u200b\u2060\ufeff]/u

/** East Asian Width `W` and `F`, as code point ranges, inclusive both ends.
 *
 *  Unicode 16. The table is here rather than in a package because it is the file the disagreements
 *  get argued in: when a terminal draws a character at a width this says it is not, the argument is
 *  a line here and a golden frame, not an upgrade of somebody else's regex.
 *
 *  Two entries worth naming, because both were measured. U+2630 to U+2637 moved to `W` in Unicode 16,
 *  so `☰` — which `apps/tui/src/kit/glyphs.ts` spends on `list` — is two cells by the standard and one
 *  cell in any terminal with an older table. That is a glyph whose width the layout cannot predict,
 *  and a later slice replaces it. And the astral pictographs OpenTUI widens (U+1F5C0, U+1F5CE,
 *  U+1F5D2, U+1F5C3, U+1F5B5 among 279 code points) are deliberately absent: the standard, xterm and
 *  `string-width` all call them one cell, and phase 3 puts an xterm-measured rectangle on the same
 *  screen, so the two halves of one frame have to count alike. */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2630, 0x2637], [0x2648, 0x2653],
  [0x267f, 0x267f], [0x268a, 0x268f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab],
  [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705],
  [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755],
  [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x2e99], [0x2e9b, 0x2ef3], [0x2f00, 0x2fd5],
  [0x2ff0, 0x2fff], [0x3000, 0x303e], [0x3041, 0x3096], [0x3099, 0x30ff], [0x3105, 0x312f],
  [0x3131, 0x318e], [0x3190, 0x31e5], [0x31ef, 0x321e], [0x3220, 0x3247], [0x3250, 0x4dbf],
  [0x4e00, 0xa48c], [0xa490, 0xa4c6], [0xa960, 0xa97c], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe10, 0xfe19], [0xfe30, 0xfe52], [0xfe54, 0xfe66], [0xfe68, 0xfe6b], [0xff01, 0xff60],
  [0xffe0, 0xffe6], [0x16fe0, 0x16fe4], [0x16ff0, 0x16ff1], [0x17000, 0x187f7],
  [0x18800, 0x18cd5], [0x18cff, 0x18d08], [0x1aff0, 0x1aff3], [0x1aff5, 0x1affb],
  [0x1affd, 0x1affe], [0x1b000, 0x1b122], [0x1b132, 0x1b132], [0x1b150, 0x1b152],
  [0x1b155, 0x1b155], [0x1b164, 0x1b167], [0x1b170, 0x1b2fb], [0x1d300, 0x1d356],
  [0x1d360, 0x1d376], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a], [0x1f200, 0x1f202], [0x1f210, 0x1f23b], [0x1f240, 0x1f248],
  [0x1f250, 0x1f251], [0x1f260, 0x1f265], [0x1f300, 0x1f320], [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c], [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0], [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc], [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a], [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4], [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5], [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2], [0x1f6d5, 0x1f6d7],
  [0x1f6dc, 0x1f6df], [0x1f6eb, 0x1f6ec], [0x1f6f4, 0x1f6fc], [0x1f7e0, 0x1f7eb],
  [0x1f7f0, 0x1f7f0], [0x1f90c, 0x1f93a], [0x1f93c, 0x1f945], [0x1f947, 0x1f9ff],
  [0x1fa70, 0x1fa7c], [0x1fa80, 0x1fa89], [0x1fa8f, 0x1fac6], [0x1face, 0x1fadc],
  [0x1fadf, 0x1fae9], [0x1faf0, 0x1faf8], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
]

/** Built once. Constructing a segmenter costs far more than asking one a question, and this module
 *  is asked a few hundred times a frame. */
const clusters = new Intl.Segmenter('en', { granularity: 'grapheme' })

const isWide = (code: number): boolean => {
  let low = 0
  let high = WIDE.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const range = WIDE[middle]!
    if (code < range[0]) high = middle - 1
    else if (code > range[1]) low = middle + 1
    else return true
  }
  return false
}

/** The cells one grapheme cluster occupies: none for a mark or a control, two for an East Asian wide
 *  or fullwidth base, one for everything else. The base is the cluster's first code point, which is
 *  what a terminal draws and what every mark after it hangs off. */
export function clusterWidth(cluster: string): number {
  const code = cluster.codePointAt(0)
  if (code === undefined) return 0
  // A control or a C1 byte draws nothing. Paint never emits one — it writes runs, not the string it
  // was handed — so this is about not counting a cell for something that will not appear.
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return 0
  if (code < 0x7f) return 1
  if (MARKLESS.test(cluster)) return 0
  return isWide(code) ? 2 : 1
}

/** Every grapheme cluster in a string, in order. Paint walks these to place a run; nothing else
 *  should have to know the segmenter is here. */
export function graphemes(value: string): string[] {
  if (PLAIN.test(value)) return value.split('')
  return Array.from(clusters.segment(value), (segment) => segment.segment)
}

/** The width of a string in cells. */
export function stringWidth(value: string): number {
  if (PLAIN.test(value)) return value.length
  let cells = 0
  for (const { segment } of clusters.segment(value)) cells += clusterWidth(segment)
  return cells
}

/** The longest prefix of a string that fits in `cells`, and the cells it actually takes.
 *
 *  Both halves, because a wide cluster on the boundary means the prefix is a cell narrower than the
 *  limit and a caller padding to a column has to know that. Truncating at a cluster keeps a mark with
 *  the base it belongs to, which is the whole reason the segmenter is in front of this. */
export function sliceToWidth(value: string, cells: number): { text: string; width: number } {
  if (cells <= 0) return { text: '', width: 0 }
  if (PLAIN.test(value)) {
    const text = value.length <= cells ? value : value.slice(0, cells)
    return { text, width: text.length }
  }
  let width = 0
  let text = ''
  for (const { segment } of clusters.segment(value)) {
    const cost = clusterWidth(segment)
    if (width + cost > cells) break
    width += cost
    text += segment
  }
  return { text, width }
}

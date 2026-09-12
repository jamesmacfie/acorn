import { colorOr, sameColor, type Color } from '../colour'
import { clusterWidth, graphemes } from '../width'

// The cells, and the three ways anything is written into them.
//
// A flat array of `cols × rows`, indexed `y * cols + x`. Flat because the diff walks it in order and
// an array of rows would be an array of arrays to chase per row; and mutable in place, because the
// cells are rewritten every frame — a fresh object per cell would be 4,800 allocations a frame at 120
// by 40, and there is nothing in a cell worth allocating for.
//
// **A wide glyph is a pair.** It writes itself into its first cell and a continuation marker — an
// empty character — into its second, so the diff and the flush can treat the two as one thing: the
// marker emits no character of its own, and a run that starts on one is widened left to pick up the
// glyph it belongs to. Without the pair a wide character would either lose the cell to its right or
// be half-overwritten by whatever drew there next.
//
// **A run has no background.** It is drawn onto whatever the box beneath it laid down, so `bg` is
// optional here and absent is not the same as `default`: `default` would wipe a box's background back
// to the terminal's, which is the wrong answer for a highlighted row with a word of text on it.

/** One cell: a grapheme, its two colours, and its attribute bits. `char` is `''` for the second cell
 *  of a wide glyph and `' '` for an empty one. */
export type Cell = { char: string; fg: Color; bg: Color; attrs: number }

/** Where the terminal's own caret goes after the frame, and null where it is hidden.
 *
 *  On the buffer rather than beside it, so it is diffed with everything else: the cursor is part of
 *  what a frame says, and a frame that moved nothing must not write a cursor sequence either
 *  (./flush.ts). */
export type Cursor = { x: number; y: number } | null

export type Buffer = { cols: number; rows: number; cells: Cell[]; cursor: Cursor }

/** The four attributes a role can ask for, as bits.
 *
 *  The values are the ones every terminal library uses, so a mask read off a frame is the number a
 *  reader expects. The gaps at 4 and 16 are italic and blink, which no role asks for. */
export const ATTRS = { bold: 1, dim: 2, underline: 8, inverse: 32 } as const

/** A rectangle that a write may land in, as half-open bounds in absolute screen cells.
 *
 *  Separate from a node's rectangle because the two answer different questions: the rectangle says
 *  where a run goes, and the clip says which of its cells survive. They differ exactly when a node
 *  overflows its parent, which is the case a left of -15 comes from (`../layout/pass.ts`). */
export type Clip = { x0: number; y0: number; x1: number; y1: number }

/** How a run is drawn. `bg` absent means "keep the background that is already there". */
export type Style = { fg: Color; bg?: Color; attrs: number }

export const BLANK: Style = { fg: 'default', bg: 'default', attrs: 0 }

const blank = (cell: Cell): void => {
  cell.char = ' '
  cell.fg = 'default'
  cell.bg = 'default'
  cell.attrs = 0
}

export function createBuffer(cols: number, rows: number): Buffer {
  const count = Math.max(0, cols) * Math.max(0, rows)
  const cells: Cell[] = Array.from({ length: count }, () => ({ char: ' ', fg: 'default', bg: 'default', attrs: 0 }))
  return { cols, rows, cells, cursor: null }
}

/** Back to blank, in place. Every frame starts here, so a node that stopped drawing leaves nothing
 *  behind for the diff to think is still on screen. */
export function clearBuffer(buffer: Buffer): void {
  for (const cell of buffer.cells) blank(cell)
  // The caret with them: it belongs to whichever field is focused this frame, and a frame where none
  // is has no caret rather than the last one's.
  buffer.cursor = null
}

/** Same buffer object, new size. The cells are replaced rather than kept, because a resize changes
 *  what every index means. */
export function resizeBuffer(buffer: Buffer, cols: number, rows: number): void {
  const fresh = createBuffer(cols, rows)
  buffer.cols = fresh.cols
  buffer.rows = fresh.rows
  buffer.cells = fresh.cells
  buffer.cursor = null
}

/** The whole buffer as a clip, which is the clip paint starts from. */
export const wholeOf = (buffer: Buffer): Clip => ({ x0: 0, y0: 0, x1: buffer.cols, y1: buffer.rows })

/** A rectangle as a clip. A negative left stays negative here and is dealt with by the intersection
 *  below, because the rectangle is where the content goes and the clip is what is allowed to show. */
export const clipOf = (rect: { x: number; y: number; w: number; h: number }): Clip =>
  ({ x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h })

/** Both, which is what a child may draw in. Empty where they do not meet, and an empty clip lets
 *  nothing through rather than everything. */
export const intersect = (one: Clip, two: Clip): Clip => ({
  x0: Math.max(one.x0, two.x0),
  y0: Math.max(one.y0, two.y0),
  x1: Math.min(one.x1, two.x1),
  y1: Math.min(one.y1, two.y1),
})

export const inside = (clip: Clip, x: number, y: number): boolean =>
  x >= clip.x0 && x < clip.x1 && y >= clip.y0 && y < clip.y1

/** Nothing gets through. Worth asking early: a node whose clip is empty has children whose clips are
 *  subsets of it, so the whole subtree can be skipped without walking it. */
export const isEmptyClip = (clip: Clip): boolean => clip.x1 <= clip.x0 || clip.y1 <= clip.y0

export const cellAt = (buffer: Buffer, x: number, y: number): Cell | undefined =>
  x >= 0 && x < buffer.cols && y >= 0 && y < buffer.rows ? buffer.cells[y * buffer.cols + x] : undefined

/** One cell, if the clip and the buffer both allow it. */
export function put(buffer: Buffer, clip: Clip, x: number, y: number, char: string, style: Style): void {
  if (!inside(clip, x, y)) return
  const cell = cellAt(buffer, x, y)
  if (!cell) return
  cell.char = char
  cell.fg = style.fg
  cell.bg = colorOr(style.bg, cell.bg)
  cell.attrs = style.attrs
}

/** A rectangle of background, with no characters of its own. What a box with a `backgroundColor`
 *  draws before anything inside it. */
export function fill(buffer: Buffer, clip: Clip, area: Clip, bg: Color): void {
  const box = intersect(clip, area)
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const cell = cellAt(buffer, x, y)
      if (cell) cell.bg = bg
    }
  }
}

/** One line of text, from a column that may be off the left edge.
 *
 *  Returns the cells the run occupied, clipped or not, so a caller placing something after it knows
 *  where it ended.
 *
 *  A negative `x` is the ordinary case rather than the exception: a run inside an overflowing box
 *  starts left of the screen, and the clip drops the clusters before column zero while the ones after
 *  it land where they belong. Advancing by the cluster's own width and asking the clip per cell is
 *  what makes that fall out rather than needing arithmetic. */
export function writeRun(buffer: Buffer, clip: Clip, x: number, y: number, text: string, style: Style): number {
  let at = x
  for (const cluster of graphemes(text)) {
    const width = clusterWidth(cluster)
    if (width === 0) continue
    // A wide glyph whose second cell the clip refuses would be drawn as half a character over
    // whatever is beside it, so it gives up the cell and draws a space instead. The wrap in
    // `../layout/measure.ts` already stops short of one; this is truncation's turn at the same edge.
    if (width === 2 && !inside(clip, at + 1, y)) {
      put(buffer, clip, at, y, ' ', style)
      at += width
      continue
    }
    put(buffer, clip, at, y, cluster, style)
    if (width === 2) put(buffer, clip, at + 1, y, '', style)
    at += width
  }
  return at - x
}

/** Are the caret in the same place, or hidden in both? */
export const sameCursor = (one: Cursor, two: Cursor): boolean =>
  one === two || (!!one && !!two && one.x === two.x && one.y === two.y)

/** Do these two cells draw the same thing? The diff's whole question. */
export const sameCell = (one: Cell, two: Cell): boolean =>
  one.char === two.char && one.attrs === two.attrs && sameColor(one.fg, two.fg) && sameColor(one.bg, two.bg)

/** The buffer as lines of characters, one string per row.
 *
 *  A continuation marker contributes nothing, so a line is a string of graphemes rather than of
 *  columns — the same shape `../harness.tsx` § frame hands a test. */
export function bufferLines(buffer: Buffer): string[] {
  const lines: string[] = []
  for (let y = 0; y < buffer.rows; y += 1) {
    let line = ''
    for (let x = 0; x < buffer.cols; x += 1) line += cellAt(buffer, x, y)?.char ?? ' '
    lines.push(line)
  }
  return lines
}

/** One stretch of a row drawn the same way: what it says, how it is styled, and how many columns it
 *  took. */
export type Run = { text: string; fg: Color; bg: Color; attrs: number; width: number }

/**
 * The buffer as runs, one array per row. What a test asks when the question is not what the screen
 * says but how it says it.
 *
 * `width` is the count that matters and it is not `text.length`: a row held as characters cannot see
 * a column shift at all, because a wide glyph contributes one character and two cells. So a run
 * carries both, and a continuation marker adds a column to the run it belongs to rather than a run
 * of its own (§ A wide glyph is a pair, ../harness.tsx § Span).
 */
export function bufferRuns(buffer: Buffer): Run[][] {
  const rows: Run[][] = []
  for (let y = 0; y < buffer.rows; y += 1) {
    const runs: Run[] = []
    for (let x = 0; x < buffer.cols; x += 1) {
      const cell = cellAt(buffer, x, y)
      if (!cell) continue
      const last = runs.at(-1)
      // The second cell of a wide glyph: a column of the run before it, and no character.
      if (cell.char === '' && last) { last.width += 1; continue }
      if (last && last.attrs === cell.attrs && sameColor(last.fg, cell.fg) && sameColor(last.bg, cell.bg)) {
        last.text += cell.char
        last.width += 1
        continue
      }
      runs.push({ text: cell.char, fg: cell.fg, bg: cell.bg, attrs: cell.attrs, width: 1 })
    }
    rows.push(runs)
  }
  return rows
}

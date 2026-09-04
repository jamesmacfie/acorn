import { clusters, stringWidth } from './width'
import type { Node } from './tree/node'

// Where the soft breaks in a field's text fall, and how a document offset and a screen cell find each
// other across them.
//
// Beside `./width.ts` rather than under `./kit/`, because three unrelated readers want the same
// answer: Yoga asks a `textarea` how tall it is, paint asks which characters are on which row, and
// `./kit/field.ts` asks which row the cursor is on so that Up and Down can move between them. One
// wrap for the three is what keeps the cursor on the row the reader can see it on.
//
// **A soft break carries no character**, so a row's `to` is the next row's `from` and one offset can
// sit at the end of one row and the start of the next. That is the whole reason `assoc` exists in the
// model: without it End on a wrapped row and Home on the row below are the same number, and End
// followed by Home does not come back. CodeMirror carries the same field for the same problem.
//
// **The cache is here rather than in `./layout/measure.ts`, and the reason is a byte count.** That
// module imports `MeasureMode` from `yoga-layout`, which is a runtime value, so a static import of it
// from `./kit/asking.tsx` — which `./main.tsx` reaches eagerly — put the whole own-painter layout
// module and Yoga's wasm binary into the startup closure of the *OpenTUI* build: 41 KB of chunk and an
// `await loadYoga()` before the first frame, in a build that never lays a node out with it. Same trap
// `./keyEvent.ts` exists to avoid, one module over (`../scripts/check-startup-graph.mjs`).
//
// **This is not `./layout/measure.ts § wrapLines`, and the two are not merging.** That one answers
// "what lines does this run of text occupy", which is a question about characters, and it drops the
// space a break was taken at. This one answers "which offsets are on which row", which is a question
// about positions, so it keeps every character of the document in exactly one row — a field whose
// wrap lost a space would put the caret a cell out for the rest of the line.

/** One visual row, as half-open document offsets. */
export type Row = { from: number; to: number }

/** Break after the last space that fits; hard-break a word too long for a row of its own.
 *
 *  A single cluster wider than the whole row is left over-long for paint to clip, which is the same
 *  answer `./layout/measure.ts` gives: there is nowhere narrower to put it and moving it would be
 *  worse than clipping it. */
function wrapLine(text: string, from: number, to: number, width: number, into: Row[]): void {
  const cells = clusters(text.slice(from, to))
  const at = (index: number): number => (index < cells.length ? from + cells[index]!.from : to)
  let start = 0
  let used = 0
  let space = -1
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!
    if (used + cell.width > width && index > start) {
      const cut = space > start ? space : index
      into.push({ from: at(start), to: at(cut) })
      start = cut
      used = 0
      space = -1
      // Re-read the cluster that did not fit as the first of the next row.
      index = cut - 1
      continue
    }
    used += cell.width
    if (cell.text === ' ') space = index + 1
  }
  into.push({ from: at(start), to: at(cells.length) })
}

/**
 * Every visual row of a document at a width, in order.
 *
 * A `\n` always breaks and the width breaks as well, so an empty document is one row and a document
 * ending in a newline has an empty row after it — which is where the caret goes when you press Return
 * at the end, and a wrap that dropped it would have nowhere to draw that caret.
 *
 * A width under one cell is treated as one, because a field squeezed to nothing still has to produce
 * rows for the cursor to be on and a zero width is a row per cluster forever.
 */
export function wrapRows(text: string, width: number): Row[] {
  const limit = Number.isFinite(width) ? Math.max(1, Math.trunc(width)) : Infinity
  const rows: Row[] = []
  let from = 0
  for (;;) {
    const brk = text.indexOf('\n', from)
    wrapLine(text, from, brk < 0 ? text.length : brk, limit, rows)
    if (brk < 0) return rows
    from = brk + 1
  }
}

/** The row and the column a document offset sits at.
 *
 *  `assoc` of -1 asks for the row that *ends* at the offset rather than the row that starts there,
 *  which is the only thing that tells a caret at a soft break which of its two homes it is in. */
export function toVisual(
  text: string, rows: readonly Row[], pos: number, assoc = 0,
): { row: number; col: number } {
  let row = 0
  while (row + 1 < rows.length && rows[row + 1]!.from <= pos) row += 1
  if (assoc < 0 && row > 0 && rows[row]!.from === pos && rows[row - 1]!.to === pos) row -= 1
  let col = 0
  for (const cell of clusters(text.slice(rows[row]!.from, pos))) col += cell.width
  return { row, col }
}

/** The document offset a column into a row, clamped to the row's own end. Which is what makes a goal
 *  column survive a short line: moving down onto a five-cell row from column 30 lands at its end and
 *  the next Down still goes back out to 30. */
export function fromVisual(text: string, rows: readonly Row[], row: number, col: number): number {
  const line = rows[Math.min(Math.max(row, 0), rows.length - 1)]
  if (!line) return 0
  let used = 0
  for (const cell of clusters(text.slice(line.from, line.to))) {
    if (used + cell.width > col) return line.from + cell.from
    used += cell.width
  }
  return line.to
}

type Wrapped = { key: string; rows: readonly Row[]; width: number }

const cache = new WeakMap<Node, Wrapped>()

/**
 * A field's visual rows at a width, cached on the node by its text and that width.
 *
 * Three readers want this answer and they must not disagree: Yoga asks a `textarea` how tall it is
 * (`./layout/measure.ts § measureField`), paint asks which characters go on which row, and
 * `./kit/asking.tsx` asks which row the caret is on so that Up and Down can move between them. A
 * second wrap anywhere would draw a caret on a row the reader is not looking at.
 *
 * Which is also why the rows are held beside the model rather than rebuilt per frame: a wrap of a
 * 400-line note is 163 microseconds, affordable per keystroke and wasteful per frame, so a frame that
 * moved nothing wraps nothing and a keystroke that only moved the caret is a cache hit.
 *
 * There is no invalidator beside this, unlike `./layout/measure.ts § invalidateRun`, and the
 * difference is where the text comes from: a run's characters are its `#text` children, which the
 * reconciler patches, so something has to tell the cache. A field's are one prop this function reads
 * on the way in, so a value that changed is a key that does not match. What the component still owes
 * is `markDirty` on the Yoga node, because Yoga will not call a measure function it does not think is
 * stale (./kit/asking.tsx § fieldRef).
 */
export function measuredField(node: Node, limit: number): Wrapped {
  const text = typeof node.props.value === 'string' ? node.props.value : ''
  // An `input` never wraps, the way `InputRenderable` forces `wrapMode: 'none'` on the buffer it
  // inherits, so it is one row however long its content is and its component scrolls it sideways.
  const width = node.kind === 'input' ? Infinity : limit
  const key = `${width} ${text}`
  const hit = cache.get(node)
  if (hit && hit.key === key) return hit
  const rows = wrapRows(text, width)
  let widest = 0
  for (const row of rows) widest = Math.max(widest, stringWidth(text.slice(row.from, row.to)))
  const fresh: Wrapped = { key, rows, width: widest }
  cache.set(node, fresh)
  return fresh
}

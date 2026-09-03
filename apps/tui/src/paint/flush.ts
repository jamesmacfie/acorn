import { sameColor, type Color } from '../colour'
import { ATTRS, cellAt, sameCell, type Buffer, type Cell } from './buffer'

// The difference between two frames, as the bytes that turn one into the other.
//
// Row by row, the changed cells are grouped into runs, and each run costs a cursor position and its
// characters. A style is written only where it differs from the last cell written, which is why the
// state below is threaded through the whole flush rather than reset per run: moving the cursor does
// not change a terminal's colour.
//
// The whole write is wrapped in `CSI ? 2026 h` and `CSI ? 2026 l`, synchronized output, so the
// emulator applies the frame in one go instead of showing it being drawn. That is what stops a
// half-painted frame being visible on a slow terminal, and it is one escape sequence rather than the
// double buffering it looks like.
//
// **The whole SGR vocabulary is here**, and it is short on purpose: three colour forms, four
// attributes. There is no terminfo layer and no capability detection, because the kit asks for six
// colour slots and four attributes and every terminal since the 1980s has those. A terminal that
// says it takes 24-bit colour is asked for it and the rest get a slot, which is
// `../appearance.ts § reportsTruecolor`'s one decision, made once at boot.

const CSI = '\x1b['

/** Synchronized output, DEC private mode 2026. */
const BEGIN = `${CSI}?2026h`
const END = `${CSI}?2026l`

/** Erase the whole display. Only after a resize: the terminal is still holding a frame of a different
 *  shape, and the cells we are about to write are the ones that changed against a blank buffer, so
 *  nothing else would clear what used to be in the corner. */
const ERASE = `${CSI}2J`

/** Back to the terminal's own everything. At the end of a flush rather than the start, so the next
 *  flush knows what state it begins in and can leave an unchanged style unsaid — and so that anything
 *  else writing to this terminal afterwards, a crash trace or the shell prompt, is not bold red. */
const RESET = `${CSI}0m`

/** The SGR codes that set our four attributes, and the ones that clear them. Bold and dim share a
 *  reset, `22`, which is the one place this vocabulary is not symmetrical: clearing either clears
 *  both, so the survivor is written again after it. */
const SET = { bold: 1, dim: 2, underline: 4, inverse: 7 } as const

/** Clamped rather than trusted, both of these, because the numbers come from a theme file and a
 *  parameter out of range is a sequence the terminal reads as something else entirely. */
const slot = (index: number): number => Math.max(0, Math.min(15, Math.trunc(index)))
const channel = (value: number): number => Math.max(0, Math.min(255, Math.trunc(value)))

/** A colour as SGR parameters. `39` and `49` are the terminal's own foreground and background, which
 *  is the whole reason `default` is a value rather than an absence (../colour.ts). The bright half of
 *  the palette is the 90s and the 100s rather than the 30s and the 40s. */
function colorParams(color: Color, background: boolean): number[] {
  const base = background ? 40 : 30
  if (color === 'default') return [base + 9]
  if (typeof color === 'number') {
    const index = slot(color)
    return [index < 8 ? base + index : base + 60 + (index - 8)]
  }
  return [base + 8, 2, channel(color[0]), channel(color[1]), channel(color[2])]
}

type Written = { fg: Color; bg: Color; attrs: number }

const START: Written = { fg: 'default', bg: 'default', attrs: 0 }

/** What has to be said to get from one style to another, as one escape sequence or nothing at all. */
function sgr(from: Written, to: Written): string {
  const params: number[] = []
  if (!sameColor(from.fg, to.fg)) params.push(...colorParams(to.fg, false))
  if (!sameColor(from.bg, to.bg)) params.push(...colorParams(to.bg, true))

  const gone = from.attrs & ~to.attrs
  const fresh = to.attrs & ~from.attrs
  if (gone & (ATTRS.bold | ATTRS.dim)) {
    params.push(22)
    // 22 took the other one with it, so whichever of the two is still wanted is said again.
    if (to.attrs & ATTRS.bold) params.push(SET.bold)
    if (to.attrs & ATTRS.dim) params.push(SET.dim)
  } else {
    if (fresh & ATTRS.bold) params.push(SET.bold)
    if (fresh & ATTRS.dim) params.push(SET.dim)
  }
  if (gone & ATTRS.underline) params.push(24)
  else if (fresh & ATTRS.underline) params.push(SET.underline)
  if (gone & ATTRS.inverse) params.push(27)
  else if (fresh & ATTRS.inverse) params.push(SET.inverse)

  return params.length === 0 ? '' : `${CSI}${params.join(';')}m`
}

const styleOf = (cell: Cell): Written => ({ fg: cell.fg, bg: cell.bg, attrs: cell.attrs })

const sameStyle = (one: Written, two: Written): boolean =>
  one.attrs === two.attrs && sameColor(one.fg, two.fg) && sameColor(one.bg, two.bg)

/** Row and column are one-based to a terminal and zero-based to us, which is the only place that
 *  matters. */
const moveTo = (x: number, y: number): string => `${CSI}${y + 1};${x + 1}H`

export type Flush = {
  /** Everything to write, or empty where the frame changed nothing. */
  text: string
  /** How many runs it took. Nothing but a test reads this, and what it is a test of is that a
   *  one-cell change costs one run rather than a row. */
  runs: number
}

const EMPTY: Flush = { text: '', runs: 0 }

/**
 * The bytes that turn `front` into `back`.
 *
 * `erase` forces the display clear that a resize needs. Otherwise this is a pure diff: a frame where
 * nothing moved writes nothing at all, which is what makes paint-on-demand cost nothing when the app
 * is sitting still.
 */
export function flush(front: Buffer, back: Buffer, erase = false): Flush {
  if (back.cols <= 0 || back.rows <= 0) return erase ? { text: BEGIN + ERASE + END, runs: 0 } : EMPTY

  let out = ''
  let runs = 0
  let written: Written = START

  for (let y = 0; y < back.rows; y += 1) {
    let x = 0
    while (x < back.cols) {
      const now = cellAt(back, x, y)!
      const before = cellAt(front, x, y)
      if (before && sameCell(before, now)) {
        x += 1
        continue
      }
      // A wide glyph is a pair, and its second cell carries no character of its own — so a run that
      // begins on one begins a cell earlier, on the glyph it belongs to. Otherwise the cursor would
      // be positioned over the right half of a character and nothing would be written there.
      const start = now.char === '' && x > 0 ? x - 1 : x
      let end = x + 1
      while (end < back.cols) {
        const next = cellAt(back, end, y)!
        const was = cellAt(front, end, y)
        if (was && sameCell(was, next)) break
        end += 1
      }

      out += moveTo(start, y)
      for (let at = start; at < end; at += 1) {
        const cell = cellAt(back, at, y)!
        const style = styleOf(cell)
        if (!sameStyle(written, style)) {
          out += sgr(written, style)
          written = style
        }
        out += cell.char
      }
      runs += 1
      x = end
    }
  }

  if (out === '') return erase ? { text: BEGIN + ERASE + END, runs: 0 } : EMPTY
  const reset = sameStyle(written, START) ? '' : RESET
  return { text: BEGIN + (erase ? ERASE : '') + out + reset + END, runs }
}

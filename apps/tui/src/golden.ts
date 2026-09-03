import { focusedRenderable } from './keys/regions'
import type { Screen, Span } from './harness'

// A frame, held so that a painter swap can be checked against it, and the comparison that reads the
// difference out loud (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md).
//
// This is a temporary instrument. The kit is tested by intent — `Badge` draws `[text]`, a `Fold`
// draws `▸ label` — and that is the right test for a kit people keep changing. It is the wrong test
// for a painter swap, where the promise is every cell, so phases 2 and 3 compare against goldens
// captured from the renderer we are leaving and phase 4 deletes this file with them.
//
// Three things are held, because none of the three is enough on its own:
//
//   - the characters, which is what a person reads;
//   - the runs, because a screen that draws the right characters in the wrong colour is a screen
//     nobody can use, and because `width` is the only record of how many columns a run took
//     (../harness.tsx § Span);
//   - the focused node's path, because where the keys are is not visible in the cells at all.

/** One step down the tree: the kind of node, and which child of its parent it is. */
export type FocusStep = [kind: string, index: number]

export type Frame = {
  surface: string
  width: number
  height: number
  /** The character frame, split by line. One character per grapheme, not per column. */
  frame: string[]
  /** The same frame as coloured runs, one array per line. */
  runs: Span[][]
  /** From the root down to whatever has the keys. Empty when nothing does. */
  focus: FocusStep[]
}

/** Where the keys are, as a path a golden can hold: renderable ids are minted per render and would
 *  differ on every run, but a node's kind and its place among its siblings are the tree's shape. */
export function focusPath(): FocusStep[] {
  const path: FocusStep[] = []
  let node = focusedRenderable()
  while (node?.parent) {
    const parent = node.parent
    path.unshift([node.constructor.name, parent.getChildren().indexOf(node)])
    node = parent
  }
  return path
}

const read = async (screen: Screen, surface: string, width: number, height: number): Promise<Frame> => ({
  surface,
  width,
  height,
  frame: (await screen.frame()).split('\n'),
  runs: await screen.spans(),
  focus: focusPath(),
})

/**
 * Take all three off a live screen, once the screen has stopped changing.
 *
 * Both the capture and the phases that compare go through here, so neither of them is the only thing
 * that knows what a frame is — and neither of them gets a frame taken mid-flight. Waiting for a
 * string is not enough on its own: the notes pane's list is on screen a beat before the effect that
 * selects the scratchpad has run, and the two states differ by one `inverse` bit on one word, which
 * is exactly the kind of difference a golden is supposed to be able to trust.
 *
 * Two identical reads in a row, and each read already settles the render loop twice, so this costs
 * about a second on a screen that was already still. Bounded, and it hands back the last read either
 * way: a surface that never settles is a finding of its own, and reporting it as a mismatch says
 * more than hanging does.
 */
export async function readFrame(screen: Screen, surface: string, width: number, height: number): Promise<Frame> {
  let previous = await read(screen, surface, width, height)
  for (let tries = 0; tries < 10; tries += 1) {
    const next = await read(screen, surface, width, height)
    if (JSON.stringify(next) === JSON.stringify(previous)) return next
    previous = next
  }
  return previous
}

/** The column a run starts at, which is the sum of the widths before it rather than the characters
 *  before it. The two differ wherever anything on the line is wide (§ Frame). */
const columnsOf = (line: Span[]): number[] => {
  let column = 0
  return line.map((span) => {
    const at = column
    column += span.width
    return at
  })
}

/** Three lines either side, so a mismatch is somewhere a reader can place rather than a row number. */
const CONTEXT = 3

const context = (lines: string[], row: number): string[] =>
  lines.slice(Math.max(0, row - CONTEXT), row + CONTEXT + 1)
    .map((line, at) => {
      const number = Math.max(0, row - CONTEXT) + at
      return `${number === row ? '  →' : '   '} ${String(number).padStart(3)} ${line}`
    })

/** A run, as short as it can be and still name what changed. */
const say = (span: Span): string =>
  `${JSON.stringify(span.text)} w${span.width} fg(${span.fg.r},${span.fg.g},${span.fg.b}) attr${span.attributes}`

/**
 * What is different, as `row:col expected/actual` with the lines around it.
 *
 * Empty means they match. Every difference is reported rather than the first, because a painter that
 * has shifted a column has shifted every line below it and the useful question is how far the damage
 * runs, not where it starts. A frame that is wholly different reports every row, so a caller printing
 * this into a failure message should take the first few and say how many there were.
 */
export function compare(live: Frame, golden: Frame): string[] {
  const found: string[] = []
  const at = `${golden.surface} at ${golden.width} by ${golden.height}`

  if (JSON.stringify(live.focus) !== JSON.stringify(golden.focus)) {
    found.push(`${at}: the keys moved\n   expected ${JSON.stringify(golden.focus)}\n   actual   ${JSON.stringify(live.focus)}`)
  }

  const rows = Math.max(live.frame.length, golden.frame.length)
  for (let row = 0; row < rows; row += 1) {
    const expected = golden.frame[row] ?? ''
    const actual = live.frame[row] ?? ''
    if (expected === actual) continue
    // The first character that differs, which is where a reader's eye goes. It is a grapheme index
    // and not a column: a run frame difference below carries the column (§ columnsOf).
    let col = 0
    while (col < expected.length && col < actual.length && expected[col] === actual[col]) col += 1
    found.push([
      `${at}: ${row}:${col} expected ${JSON.stringify(expected[col] ?? '')} / actual ${JSON.stringify(actual[col] ?? '')}`,
      ...context(golden.frame, row).map((line) => `expected ${line}`),
      ...context(live.frame, row).map((line) => `actual   ${line}`),
    ].join('\n'))
  }

  const runRows = Math.max(live.runs.length, golden.runs.length)
  for (let row = 0; row < runRows; row += 1) {
    const expected = golden.runs[row] ?? []
    const actual = live.runs[row] ?? []
    if (JSON.stringify(expected) === JSON.stringify(actual)) continue
    const columns = columnsOf(expected)
    let run = 0
    while (run < expected.length && run < actual.length && JSON.stringify(expected[run]) === JSON.stringify(actual[run])) run += 1
    found.push([
      `${at}: ${row}:${columns[run] ?? columns.at(-1) ?? 0} run ${run}`,
      `   expected ${expected[run] ? say(expected[run]) : 'nothing'}`,
      `   actual   ${actual[run] ? say(actual[run]) : 'nothing'}`,
      ...context(golden.frame, row).map((line) => `           ${line}`),
    ].join('\n'))
  }

  return found
}

/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import type { Renderable } from './tree/compat'
import { renderFixture } from './harness'

// A diff longer and wider than the column it draws in.
//
// Its own file for the reason ./browseLong.test.tsx is: the query cache is module state and outlives
// a render, so the pull an earlier test loaded is the one a later test in the same worker gets.
//
// A cell layout shrinks a child that doesn't fit rather than clipping it. So a column that lays out
// every row draws 2,500 rows in a 40-row panel thirty deep on top of each other, and two runs inside a
// row (the line numbers and the code) clip separately, so the gutter's last digit runs into the change
// marker (./kit/showing/diffRows.tsx, ./kit/cells.tsx § Run).
describe('a diff longer than its column', () => {
  it('draws one line per row, in order, with the gutter clear of the code', async () => {
    process.env.ACORN_FIXTURE_PATCH_LINES = '2500'
    try {
      const screen = await renderFixture({ width: 160, height: 40, pane: 'pr' })
      const opened = await screen.until('somethingRatherLongIndeed', 45)
      const runs = (await screen.spans()).flat()
      screen.done()

      // Each row that drew is one line, and the lines read down the screen in the patch's own order.
      const drawn = opened
        .split('\n')
        .map((line) => line.match(/somethingRatherLongIndeed(\d+)/)?.[1])
        .filter((found): found is string => found !== undefined)
        .map(Number)
      expect(drawn.length).toBeGreaterThan(20)
      expect(drawn).toEqual(drawn.map((_unused, at) => drawn[0] + at))

      // And the gutter is clear of the marker. Two runs in a row are two boxes, so a row too wide for
      // the column shrinks each and clips each: the line number loses its leading spaces and lands
      // against the `+`, as `11+  const`. One `text` with two spans in it clips once, at the end.
      expect(opened).toContain('-  const somethingRatherLongIndeed1 =')
      expect(opened).toContain('+  const somethingRatherLongIndeed3 =')
      expect(opened.split('\n').filter((line) => /\d[+-] {2}const/.test(line))).toEqual([])
      for (const line of opened.split('\n')) expect(line.length).toBeLessThanOrEqual(160)

      // And it is drawn in the colours the role table asks for (./kit/roles.ts § textStyle). A run
      // that falls back to its parent's colour still has the right characters, so only a colour
      // check catches it.
      const inserted = runs.find((run) => run.text.includes('+  const somethingRatherLongIndeed'))
      expect(inserted).toBeDefined()
      expect(inserted!.fg).not.toEqual({ r: 1, g: 1, b: 1 })
      expect(inserted!.fg.g).toBeGreaterThan(inserted!.fg.r)
      const deleted = runs.find((run) => run.text.includes('-  const somethingRatherLongIndeed'))
      expect(deleted!.fg.r).toBeGreaterThan(deleted!.fg.g)
    } finally {
      delete process.env.ACORN_FIXTURE_PATCH_LINES
    }
  }, 120_000)
})

// ── And how much of it is built ───────────────────────────────────────────────────────────────
//
// A five-thousand-line diff in a pane that shows twenty would be five thousand renderables laid out on
// every frame. The pane draws the slice around the offset and stands two boxes in for the rest
// (./kit/showing/diffPane.tsx § DiffPane).

/** Every renderable under the root, which is what a frame costs to lay out. */
const renderables = (root: Renderable): number => {
  let count = 1
  for (const child of root.getChildren()) count += renderables(child)
  return count
}

describe('a five-thousand-line diff', () => {
  it('builds a window rather than the whole patch', async () => {
    process.env.ACORN_FIXTURE_PATCH_LINES = '5000'
    try {
      const screen = await renderFixture({ width: 160, height: 40, pane: 'pr' })
      await screen.until('somethingRatherLongIndeed', 45)
      const built = renderables(screen.renderer.root)
      screen.done()

      // The whole screen, chrome included, against a patch of five thousand lines. The bound is the
      // viewport plus the overscan the pane keeps either side of it, with a wide margin, because what
      // is being pinned is the shape (a number that does not grow with the diff) rather than a layout.
      expect(built).toBeLessThan(1000)
    } finally {
      delete process.env.ACORN_FIXTURE_PATCH_LINES
    }
  }, 120_000)
})

/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import type { Renderable } from '@opentui/core'
import { renderFixture } from './harness'

// A diff longer and wider than the column it draws in.
//
// Its own file for the reason ./browseLong.test.tsx is: the query cache is module state and outlives
// a render, so the pull a earlier test loaded is the one a later test in the same worker gets.
//
// The failure this pins is the diff column as it shipped. A cell layout shrinks a child that does not
// fit rather than clipping it, so 2,500 rows in a 40-row panel were drawn thirty deep on top of each
// other, and the two runs inside a row — the line numbers and the code — each clipped separately, so
// the gutter's last digit ran into the change marker. What came out was a smear of characters from
// lines that are nowhere near each other (./kit/showing.tsx § Diff, ./kit/cells.tsx § Run).
describe('a diff longer than its column', () => {
  it('draws one line per row, in order, with the gutter clear of the code', async () => {
    process.env.ACORN_FIXTURE_PATCH_LINES = '2500'
    try {
      const screen = await renderFixture({ width: 160, height: 40, pane: 'pr' })
      const opened = await screen.until('somethingRatherLongIndeed', 45)
      const runs = (await screen.spans()).flat()
      screen.done()

      // Each row that drew is one line, and the lines read down the screen in the patch's own order.
      // Under the squeeze they arrived as 0, 16, 29, 42: every row lost most of its height and what
      // survived came from whichever row the renderer reached last.
      const drawn = opened.split('\n')
        .map((line) => line.match(/somethingRatherLongIndeed(\d+)/)?.[1])
        .filter((found): found is string => found !== undefined)
        .map(Number)
      expect(drawn.length).toBeGreaterThan(20)
      expect(drawn).toEqual(drawn.map((_unused, at) => drawn[0] + at))

      // And the gutter is clear of the marker. Two runs in a row are two boxes, so a row too wide for
      // the column shrank each and clipped each: the line number lost its leading spaces and landed
      // against the `+`, as `11+  const`. One `text` with two spans in it clips once, at the end.
      expect(opened).toContain('-  const somethingRatherLongIndeed1 =')
      expect(opened).toContain('+  const somethingRatherLongIndeed3 =')
      expect(opened.split('\n').filter((line) => /\d[+-] {2}const/.test(line))).toEqual([])
      for (const line of opened.split('\n')) expect(line.length).toBeLessThanOrEqual(160)

      // And it is drawn in the colours the role table asks for. A `span` takes its colour in a
      // `style` object and drops a bare `fg` without a word, so every run inside a `text` used to
      // come out in the parent's colour — and a `text` given no colour is opaque white to OpenTUI,
      // which on a light terminal is white on white (./kit/roles.ts § spanStyle). The characters were
      // right the whole time, which is why nothing caught it.
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
// The pane used to say in its own comment that every row was built. A five-thousand-line diff in a
// pane that shows twenty is five thousand renderables laid out on every frame, and the fix is the one
// the rail already had: draw the slice around the offset and stand two boxes in for the rest
// (./kit/showing.tsx § DiffPane).

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
      const screen = await renderFixture({ width: 80, height: 24, pane: 'pr' })
      await screen.until('somethingRatherLongIndeed', 45)
      const built = renderables(screen.renderer.root)
      screen.done()

      // The whole screen, chrome included, against a patch of five thousand lines. Before the window
      // this was the patch plus the chrome; the bound is the viewport plus the overscan the pane
      // keeps either side of it, and there is a wide margin here because what is being pinned is the
      // shape — a number that does not grow with the diff — rather than a layout.
      expect(built).toBeLessThan(1000)
    } finally {
      delete process.env.ACORN_FIXTURE_PATCH_LINES
    }
  }, 120_000)
})

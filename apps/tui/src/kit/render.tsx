/** @jsxImportSource @opentui/solid */
import type { JSX } from 'solid-js'

// Drawing one node to a cell buffer and reading it back, which is what a test of this kit is.
//
// The DOM kit's tests render to jsdom and query the tree (client-core's `hosts` vitest project). A
// cell host has no tree to query: what a node did is what is in the buffer, so the assertion is the
// characters. That is stricter and it is the point — "`Badge` draws `[text]`" is a claim about the
// screen, and the 80×24 appendix is written in those terms.

export type Frame = {
  /** Every line, trailing spaces trimmed, so an assertion is about what was drawn. */
  lines: string[]
  /** The whole thing, for a `toContain` on something that spans a line break. */
  text: string
  done: () => void
}

/** Render a fragment at a size and read the cells back. Small by default, because a node under test
 *  is a node and not a screen, and a wide buffer hides a node that overflows its row. */
export async function renderCells(
  node: () => JSX.Element,
  size: { width?: number; height?: number } = {},
): Promise<Frame> {
  const { testRender } = await import('@opentui/solid')
  const { renderer, flush, captureCharFrame } = await testRender(node, {
    width: size.width ?? 40,
    height: size.height ?? 8,
  })
  // Bounded, and the frame is taken either way: a tree that never settles is itself a finding, and a
  // capture that hangs says nothing about which node did it.
  await Promise.race([flush(), new Promise((done) => setTimeout(done, 2000))])
  // OpenTUI patches `console.*` and pops its own overlay over the frame when anything logs. Whatever
  // logged is worth seeing on stderr; it is not worth drawing over the screen under test.
  renderer.console.deactivate()
  renderer.console.hide()
  await Promise.race([flush(), new Promise((done) => setTimeout(done, 500))])
  const raw = captureCharFrame()
  return {
    lines: raw.split('\n').map((line) => line.replace(/\s+$/, '')),
    text: raw,
    done: () => renderer.destroy(),
  }
}

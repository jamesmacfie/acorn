/** @jsxImportSource @opentui/solid */
import { renderFixture } from './harness'

// The screenshot, on a machine with no TTY. Same tree as the pane suite; printed instead of asserted.
//
//   pnpm --filter @acorn/tui capture              the pane the task opens on
//   pnpm --filter @acorn/tui capture -- notes     one pane by name
//
// A pane's own data is a route and a store rather than a prop, so the frame is taken again until
// something is in the pane, the same bounded wait the suite does (./panes.test.tsx § screenFor).
const pane = process.argv[2]
const screen = await renderFixture(pane ? { pane } : {})
let frame = await screen.frame()
const empty = (drawn: string) => drawn.split('\n').slice(2, -2).every((line) => line.replace(/[\s│─◉›]/g, '') === '')
for (let tries = 0; tries < 20 && empty(frame); tries += 1) {
  await new Promise((done) => setTimeout(done, 250))
  frame = await screen.frame()
}
process.stdout.write(`${frame}\n`)
screen.done()
process.exit(0)

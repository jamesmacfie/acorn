/** @jsxImportSource @acorn/tui/jsx */
import { renderFixture } from './harness'

// The screenshot, on a machine with no TTY. Same tree as the pane suite; printed instead of asserted.
//
//   pnpm --filter @acorn/tui capture           the first available Menu source
//   pnpm --filter @acorn/tui capture notes     one pane by name
//
// No `--` before the name. pnpm passes it straight through to the script, so it lands in `argv[2]`
// and the pane name lands in `argv[3]` — which drew whatever the task's saved layout puts first and
// looked like the name being ignored. Skipped rather than only documented, because the habit is
// older than this script.
//
// A pane's own data is a route and a store rather than a prop, so the frame is taken again until
// something is in the pane, the same bounded wait the suite does (./panes.test.tsx § screenFor).
const pane = process.argv.slice(2).find((arg) => arg !== '--')
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

/** @jsxImportSource @opentui/solid */
import { renderFixture } from './harness'

// The screenshot, on a machine with no TTY. Same tree as the smoke test; printed instead of asserted.
//
//   pnpm --filter @acorn/tui capture
const screen = await renderFixture()
process.stdout.write(`${await screen.frame()}\n`)
screen.done()
process.exit(0)

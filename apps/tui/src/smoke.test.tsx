/** @jsxImportSource @opentui/solid */
import { createRequire } from 'node:module'
import { expect, test } from 'vitest'
import { renderFixture } from './harness'

// OpenTUI's render core is Zig behind `node:ffi`, which is a Node 26.4 builtin behind
// `--experimental-ffi` (vitest.config.ts passes it). On an older Node there is no renderer to draw
// to, so this file has nothing to say — and it says so rather than failing the repo's suite for a
// reason that has nothing to do with the change under test. See FINDINGS.md, "The runtime floor".
const hasFfi = (() => {
  try {
    createRequire(import.meta.url)('node:ffi')
    return true
  } catch {
    return false
  }
})()

// The one test phase 0 owes: the Notes pane, unchanged, drawn to a cell buffer at 80 by 24.
//
// It asserts what a reader would look for on the screen rather than a snapshot of every cell: the
// group labels the list column drew, the note titles under them, and the body of the note the detail
// column opened. A snapshot would fail on every spacing decision phase 1 makes, and phase 1 is where
// cell-level assertions belong (docs/testing.md § Test layers).
test.skipIf(!hasFfi)('the notes pane draws its list and its detail at 80 by 24', async () => {
  const screen = await renderFixture()
  const frame = await screen.frame()
  screen.done()

  expect(frame).toContain('TASK')
  expect(frame).toContain('Repro steps')
  expect(frame).toContain('What the agent found')
  expect(frame).toContain('Conventions')
  expect(frame).toContain('Whatever is in hand.')
  // 80 cells is the contract, not an accident of this fixture: a wider line is a node that read a
  // width it does not have (docs/ui-design.md § What the kit and layouts must never do).
  for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(80)
}, 30_000)

// The other half of what phase 0 set out to prove: the pane handles no keys, and the arrows still
// walk it. `j` is `next` in the one table both hosts read (kit/keys/keymap.ts), and the caret is
// where this host draws the collection's active row.
test.skipIf(!hasFfi)('j moves the caret down the list', async () => {
  const screen = await renderFixture()
  await screen.press('j')
  const first = await screen.frame()
  await screen.press('j')
  const second = await screen.frame()
  screen.done()

  const caretRow = (frame: string) => frame.split('\n').findIndex((line) => line.includes('\u203a'))
  expect(caretRow(first)).toBeGreaterThan(0)
  expect(caretRow(second)).toBe(caretRow(first) + 1)
}, 30_000)

// And Enter opens what the caret is on. Worth its own test because the wiring is not obvious: a `Row`
// on the DOM is a button, so Enter on it raises a click and `onPress` runs by itself. There is no
// element here, so the row hands its press to the collection and the intent routes it
// (kit/collection.ts).
test.skipIf(!hasFfi)('enter opens the row the caret is on', async () => {
  const screen = await renderFixture()
  // Past the scratchpad, which the pane opens by itself, onto the second note.
  await screen.press('j')
  await screen.press('j')
  await screen.press('RETURN')
  const frame = await screen.frame()
  screen.done()

  expect(frame).toContain('Sign in as a new account.')
}, 30_000)

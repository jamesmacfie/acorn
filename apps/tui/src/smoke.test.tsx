/** @jsxImportSource @acorn/tui/jsx */
import { expect, test } from 'vitest'
import { renderFixture } from './harness'

// The one test phase 0 owes: a first-party pane, unchanged, drawn to a cell buffer at 80 by 24.
//
// It asserts what a reader would look for on the screen rather than a snapshot of every cell: the
// group labels the list column drew, the note titles under them, and the body of the note the detail
// column opened. Cell-level assertions live one node at a time in kit/kit.test.tsx, which is where a
// broken promise names itself (docs/testing.md § Test layers). The chrome around the pane has its own
// file (chrome/chrome.test.tsx); this one is about the pane.
//
// Since phase 4 the pane is inside a shell, so getting to it takes two presses of Tab — rail, pane
// strip, pane. That is the shell behaving, and it is asserted in the file that owns it.
const intoPane = async (screen: { press: (key: string) => Promise<void> }): Promise<void> => {
  await screen.press('TAB')
  await screen.press('TAB')
}

test('the notes pane draws its list at 80 by 24', async () => {
  const screen = await renderFixture({ pane: 'notes' })
  // `until`, not `frame`: the pane's rows are a query away and the shell has more to draw than it
  // used to, so reading the first frame is a race that passes alone and fails beside eleven other
  // files (./harness.tsx § until).
  const frame = await screen.until('TASK')
  screen.done()

  expect(frame).toContain('TASK')
  expect(frame).toContain('Repro steps')
  expect(frame).toContain('What the agent found')
  expect(frame).toContain('Conventions')
  // 80 cells is the contract, not an accident of this fixture: a wider line is a node that read a
  // width it does not have (docs/ui-design.md § What the kit and layouts must never do).
  for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(80)
}, 30_000)

// The other half of what phase 0 set out to prove: the pane handles no keys, and the arrows still
// walk it. `j` is `next` in the one table both hosts read (kit/keys/keymap.ts), and the caret is
// where this host draws the collection's active row.
test('j moves the caret down the list', async () => {
  const screen = await renderFixture({ pane: 'notes' })
  await intoPane(screen)
  const first = await screen.frame()
  await screen.press('j')
  const second = await screen.frame()
  screen.done()

  const caretRow = (frame: string) => frame.split('\n').findIndex((line) => line.includes('›'))
  expect(caretRow(first)).toBeGreaterThan(0)
  expect(caretRow(second)).toBe(caretRow(first) + 1)
}, 30_000)

// And Enter opens what the caret is on. Worth its own test because the wiring is not obvious: a `Row`
// on the DOM is a button, so Enter on it raises a click and `onPress` runs by itself. There is no
// element here, so the row hands its press to the collection and the intent routes it
// (keys/collection.ts).
//
// The `l` at the end is the shell's doing rather than the pane's, and it is a real finding: the
// chrome spends three cells on the rail and its rule, so at 80 columns the pane is 77 and
// `list-detail` is below its own 80-cell threshold — one group at a time, with `expand` switching
// between them. Opening a note there does not reveal it until you go and look.
test('enter opens the row the caret is on', async () => {
  const screen = await renderFixture({ pane: 'notes' })
  await intoPane(screen)
  // Past the scratchpad, which the pane opens by itself, onto the second note.
  await screen.press('j')
  await screen.press('RETURN')
  await screen.press('l')
  const frame = await screen.frame()
  screen.done()

  expect(frame).toContain('Sign in as a new account.')
}, 30_000)

// The same pane at two sizes, which is what a `reduced` node's loss is about: `list-detail` is two
// columns above 80 cells and one below it, and a pane that reads at 80 by 24 has to keep reading when
// the window is bigger rather than leaving a column stranded.
//
// Notes rather than the http pane, which is what phase 1 asked for: http ships only a tree bundle
// (plugins/http/src/tree/, no client/), so drawing it means the worker sandbox and that is phase 5.
// See docs/tui.md.
test('the pane holds together at 120 by 40 as well as at 80 by 24', async () => {
  const wide = await renderFixture({ width: 120, height: 40, pane: 'notes' })
  const frame = await wide.frame()
  wide.done()

  expect(frame).toContain('TASK')
  expect(frame).toContain('Scratchpad')
  expect(frame).toContain('Conventions')
  // Both columns, still: the list stays its 32 cells and the detail fills what is left, so a row in
  // the list has the note's body beside it rather than a stranded empty half. Which note is open is
  // not asserted — the pane's model is per task and outlives a render, so a suite that opened one in
  // an earlier test finds it open here, which is the pane behaving.
  const listRow = frame.split('\n').find((line) => line.includes('Scratchpad')) ?? ''
  expect(listRow.trimEnd().length).toBeGreaterThan(40)
  for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(120)
}, 30_000)

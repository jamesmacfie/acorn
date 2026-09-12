/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { renderFixture } from './harness'

// Its own file, for the reason ./workspaceFocus.test.tsx is: the managed-session store is module
// state and its snapshots outlive a render, so a case that wants a different transcript from the one
// its neighbours read has to be the only case in the process. Run beside them it was handed the short
// snapshot the previous case had already cached, and failed naming the scroll position.

describe('a transcript that is still growing', () => {
  // The composer is the last thing in the detail column, so a transcript taller than the pane used to
  // push it under the fold and leave every turn costing a page-down to find the box again. The
  // viewport follows the transcript's newest content now (../kit/scrolling.tsx § followViewport).
  it('keeps the newest turn and the composer on screen', async () => {
    process.env.ACORN_FIXTURE_LONG_TRANSCRIPT = '1'
    try {
      const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
      try {
        // Tab to the session list and open the row, the same walk ./agents.test.tsx makes, and the
        // same wait in front of it: the list is a query and the walk is a fixed budget of presses.
        await screen.until('Write src/login.ts')
        let found = false
        for (let step = 0; step < 10 && !found; step += 1) {
          const caret = (await screen.frame()).split('\n').find((line) => line.includes('›')) ?? ''
          found = caret.includes('Write src/login.ts')
          if (!found) await screen.press('TAB')
        }
        expect(found).toBe(true)
        await screen.press('RETURN')

        const frame = await screen.until('Ask the agent')
        // The foot of the transcript, not its head, and the composer under it.
        expect(frame).toContain('Filler turn 30.')
        expect(frame).toContain('[Send]')
        expect(frame).not.toContain('Filler turn 1.')

        // And the composer stays there when the reader goes back through the history, because the
        // transcript is the scroller and the composer is its sibling rather than its last line
        // (../kit/grouping.tsx § Timeline, ../layouts/ListDetail.tsx). This is the half that a
        // viewport merely held at its foot could not give: scrolling up used to take the message box
        // off the screen with it.
        await screen.press('l')
        // Into the transcript, then page back through the history. Up in a field moves the caret a row
        // and leaves the field at its first one, which is what puts the keys among the turns
        // (../keys/install.ts § typeInto); the page keys then scroll the viewport those keys are
        // inside without moving them, which is the cleanest way to ask this question — nothing about
        // what stays on screen is then a side effect of the caret having gone somewhere.
        for (let step = 0; step < 6; step += 1) await screen.press('ARROW_UP')
        for (let page = 0; page < 12; page += 1) await screen.press('PAGEUP')

        const back = await screen.frame()
        // The transcript moved off its foot...
        expect(back).not.toContain('Filler turn 30.')
        // ...and both of its siblings are still where the reader left them.
        expect(back).toContain('Ask the agent')
        expect(back).toContain('[Send]')
        expect(back).toContain('[ New ▾ ]')
      } finally {
        screen.done()
      }
    } finally {
      delete process.env.ACORN_FIXTURE_LONG_TRANSCRIPT
    }
  }, 180_000)
})

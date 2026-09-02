/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { hasFfi } from './ffi'
import { renderFixture } from './harness'
import { recordedRequests } from './fixture'

// The pull request, driven from the keyboard, on the real shell.
//
// `kit/kit.test.tsx` § every control is a stop asserts that each node presses when the keys are on it.
// This asserts the other half, which no unit case can: that a reader arriving at a pane can get the
// keys onto a control at all, and that pressing it reaches the node
// (docs/tui.md § Keys and focus).
//
// The worked example in that folder's focus-model.md is the sequence below. Phase 0 reached the first
// stop of a panel; phase 2 reaches the rest of them, so `[Merge]` — the second stop in Details — is
// asserted here too, along with the wall at the end of the panel and the Escape that climbs out.

/** Every run drawn in the focused form: `strong` in the `accent` tone (../kit/roles.ts § litControl).
 *
 *  Accent is the palette's own sixth slot and the default foreground is white, so a red channel below
 *  the green is "this is the accent slot" without naming a colour (./appearance.ts). */
const litRuns = async (screen: { spans: () => Promise<{ text: string; fg: { r: number; g: number; b: number }; attributes: number }[][]> }): Promise<string[]> =>
  (await screen.spans()).flat()
    .filter((run) => run.text.trim() && run.fg.r < run.fg.g && (run.attributes & 1) === 1)
    .map((run) => run.text)

describe.skipIf(!hasFfi)('the pull request from the keyboard', () => {
  it('lands the keys on a control in the Details panel, and says which one has them', async () => {
    const screen = await renderFixture({ pane: 'pr', width: 100, height: 32 })
    try {
      const opened = await screen.until('[Merge]', 45)
      expect(opened).toContain('[ squash ▾ ]')
      const { focusedRegion } = await import('./keys/regions')

      // Tab to the pane strip, Down into the pane's own region, which lands on the Details strip.
      await screen.press('TAB')
      expect(focusedRegion()).toEqual({ paneId: 'chrome', regionId: 'panes' })
      await screen.press('ARROW_DOWN')
      expect(focusedRegion()).toEqual({ paneId: 'pr', regionId: 'body' })

      // …and Down again into the panel under the strip, where before this phase there was nothing
      // focusable at all: the merge-method `Select` is the panel's first stop.
      await screen.press('ARROW_DOWN')
      expect(await litRuns(screen)).toContain('[ squash ▾ ]')

      // The footer says `open`, because this control opens a list. A plain button beside it would
      // say `press`, and a row in the rail would say `open` for the other reason
      // (../chrome/bindings.ts § WORDS).
      const onControl = await screen.frame()
      expect(onControl).toContain('enter open')

      // And pressing it opens the method list, which is what a `Select` does.
      await screen.press('RETURN')
      const list = await screen.frame()
      expect(list).toContain('rebase')
      await screen.press('ESCAPE')

      // Down again reaches the panel's second stop, which is the whole of phase 2: the arrows move
      // between the stops of one panel in reading order.
      await screen.press('ARROW_DOWN')
      expect(await litRuns(screen)).toContain('[Merge]')

      // …and on to the one after it, in the panel's own reading order rather than by screen position.
      await screen.press('ARROW_DOWN')
      expect(await litRuns(screen)).toContain('[Close]')

      // The end of the panel is a wall, not a trip to the next region: past the last control the keys
      // stay where they are for as long as Down is pressed.
      for (let step = 0; step < 8; step += 1) await screen.press('ARROW_DOWN')
      const atEnd = await litRuns(screen)
      await screen.press('ARROW_DOWN')
      expect(await litRuns(screen)).toEqual(atEnd)
      expect(focusedRegion()).toEqual({ paneId: 'pr', regionId: 'body' })

      // Escape climbs one level, to the strip that owns the panel, and the panel's controls are no
      // longer the lit ones.
      await screen.press('ESCAPE')
      expect(await litRuns(screen)).not.toContain('[Merge]')
    } finally {
      screen.done()
    }
  }, 180_000)

  it('posts a comment typed into the composer', async () => {
    const screen = await renderFixture({ pane: 'pr', width: 100, height: 32 })
    try {
      await screen.until('[Merge]', 45)
      await screen.press('TAB')
      await screen.press('ARROW_DOWN')
      // Right along the strip to Comments, which is the seventh tab.
      for (let step = 0; step < 6; step += 1) await screen.press('ARROW_RIGHT')
      expect(await screen.frame()).toContain('[Comments/Commits]')

      // Down into the panel lands on the composer's field, because it is the first stop in it.
      await screen.press('ARROW_DOWN')
      await screen.press('h')
      await screen.press('i')
      const typed = await screen.frame()
      expect(typed).toContain('> hi')
      // The footer names the key that sends, at the field that takes it.
      expect(typed).toContain('ctrl+return send')

      // Escape leaves the field for the strip that owns the panel and sends nothing, which is how a
      // reader gets out of a composer without posting.
      await screen.press('ESCAPE')
      expect(recordedRequests().filter((request) => request.method === 'POST')).toEqual([])

      // Back in, on the field, with the draft still in it.
      await screen.press('ARROW_DOWN')
      expect(await screen.frame()).toContain('> hi')

      // Ctrl+Return is a chord only because the app asks the terminal for the kitty keyboard
      // protocol; without it a terminal sends one byte for Return either way (./main.tsx).
      await screen.press('RETURN', { ctrl: true })
      expect(recordedRequests().filter((request) => request.method === 'POST')).toEqual([
        { path: '/v2/p/github/repos/runn-fast/acorn/pulls/42/comments', method: 'POST' },
      ])
    } finally {
      screen.done()
    }
  }, 180_000)
})

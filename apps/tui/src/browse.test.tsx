/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { renderFixture } from './harness'
import { focusedRegion, focusedRenderable, isField } from './keys/regions'

// Menu, Browse, detail: the one path through the shell that needs every piece of this host at once.
//
// A source is chosen in the Menu panel, its `list` region draws in the Browse panel, moving the caret
// onto a row navigates, and the `detail` region in the main panel follows — with no Enter pressed
// anywhere (docs/tui.md § The screen, § Collections).
//
// It is slow and it is worth it. Four separate things have to hold for the last line to pass: the
// router shim resolving `:number` off a path (./kit/router.ts), the source contract carrying two
// regions to two places (client-core § SourceContribution.regions), select-on-move firing `onSelect`
// without an activate, and every `lazy()` under the surface carrying a `Suspense` of its own. Each of
// the four broke this flow once while it was being built, and three of them broke it silently.

const caretLine = (frame: string): string => frame.split('\n').find((line) => line.includes('›')) ?? ''

/** Walk the region cycle until the caret is on something the caller recognises. A count of presses
 *  would be a count of regions, and the shell has five before a pane's own. */
const caretOn = async (
  screen: { frame: () => Promise<string>; press: (key: string) => Promise<void> },
  text: string,
): Promise<boolean> => {
  for (let step = 0; step < 10; step += 1) {
    if (caretLine(await screen.frame()).includes(text)) return true
    await screen.press('TAB')
  }
  return false
}

describe('browsing a source', () => {
  it('puts a source in the Menu, its list in Browse, and the highlighted item in the main panel', async () => {
    const screen = await renderFixture({ width: 100, height: 32 })

    // The Menu holds the sources this workspace has. GitHub is there because the fixture's node
    // reports the integration connected (./fixture.ts).
    expect(await caretOn(screen, 'GitHub')).toBe(true)

    // Menu selects the row it opens on. A terminal has no pointer to make a second selection, so a
    // highlighted source and the source shown in Browse are one state from the first frame.
    const browsing = await screen.until('Invalidate')
    expect(browsing).toContain('Reviews')
    expect(browsing).toContain('Invalidate')

    // Into the Browse panel, onto the pull, and the main panel follows with no Enter or arrow press.
    // Browse opts into picking on entry too, so entering its list opens the highlighted pull.
    expect(await caretOn(screen, 'Invalidate')).toBe(true)
    // Wait on something only the loaded detail draws. `PULL REQUEST` is the detail's heading and it
    // draws before the pull arrives, and `#42` is on the list row itself, so either one is a race that
    // passes alone and fails beside eleven other files. The branch pair is the pull.
    //
    // A longer bound than the default, too: this is the one test that mounts three lazy trees in a row
    // — the source's list, its detail, and the diff under that — and under a full repo build every one
    // of those is a cold compile.
    const opened = await screen.until('(fix-login) → (main)', 45)

    expect(opened).toContain('#42')
    expect(opened).toContain('Invalidate the old password on reset')
    expect(opened).toContain('(fix-login) → (main)')
    // The three panels are still there beside it, which is the arrangement this whole test is about.
    for (const panel of ['Menu', 'Browse', 'Tasks']) expect(opened).toContain(panel)
    for (const line of opened.split('\n')) expect(line.length).toBeLessThanOrEqual(100)

    // A source closes the task, so there is no pane strip and therefore no strip region. The full
    // cycle contains only visible, useful places and returns to Browse.
    const cycle: string[] = []
    for (let step = 0; step < 4; step += 1) {
      await screen.press('TAB')
      cycle.push(focusedRegion()?.regionId ?? '')
    }
    screen.done()
    expect(cycle).toEqual(['tasks', 'source', 'menu', 'browse'])
  }, 120_000)

  it('enters pull-detail controls below the tabs and escapes back through Browse', async () => {
    const screen = await renderFixture({ width: 100, height: 32 })
    try {
      // The default source is GitHub. Reach Browse and move its one-row list once so the row's
      // select-on-move contract opens the pull; then wait for the branch pair because it belongs to
      // the loaded detail rather than to the list row beside it.
      for (let step = 0; step < 6 && focusedRegion()?.regionId !== 'browse'; step += 1) {
        await screen.press('TAB')
      }
      expect(focusedRegion()?.regionId).toBe('browse')
      await screen.press('ARROW_DOWN')
      expect(await screen.until('(fix-login) → (main)', 45)).toContain('Invalidate the old password')

      // Reach the source region from whichever rail region won the asynchronous startup race. Its
      // first stop is the section strip; Right moves that strip and not the row of task panes.
      for (let step = 0; step < 6 && focusedRegion()?.regionId !== 'source'; step += 1) {
        await screen.press('TAB')
      }
      expect(focusedRegion()?.regionId).toBe('source')
      let comments = await screen.frame()
      for (let step = 0; step < 8 && !comments.includes('[Comments/Commits] 1'); step += 1) {
        await screen.press('ARROW_RIGHT')
        comments = await screen.frame()
      }
      expect(comments).toContain('[Comments/Commits] 1')

      // Down enters the active panel's first real control. Escape returns to the strip (proved by
      // Left changing tabs), and the next Escape restores the Browse row in the left column.
      await screen.press('ARROW_DOWN')
      // Through the store's own question rather than an `instanceof`, because a field under our
      // painter is a plain object with a `kind` and no shim can be an instance of somebody else's
      // class (../keys/regions.ts § isField).
      expect(isField(focusedRenderable()!)).toBe(true)
      await screen.press('ESCAPE')
      await screen.press('ARROW_LEFT')
      expect(await screen.frame()).toContain('[Files] 2')
      await screen.press('ESCAPE')
      expect(focusedRegion()?.regionId).toBe('browse')
    } finally {
      screen.done()
    }
  }, 120_000)

  it('lets the Menu leave a source whose path is still showing', async () => {
    const screen = await renderFixture({ width: 100, height: 32 })

    // Browse into GitHub far enough that the path names a pull — the shape that used to pin the
    // Menu: the rail-follows-path effect read the selection inside its own tracked scope, so every
    // Menu choice re-ran it, the path's owner was still GitHub, and the choice was snapped straight
    // back (../chrome/routing.ts).
    expect(await caretOn(screen, 'GitHub')).toBe(true)
    await screen.until('Invalidate')
    expect(await caretOn(screen, 'Invalidate')).toBe(true)
    await screen.until('(fix-login) → (main)', 45)

    // Back on the Menu, one row down: Docker is next by order, and moving onto it chooses it
    // (select-on-move). Docker has no `regions.list`, so the one line only a *stuck* switch can show
    // is the Browse panel's own fallback.
    expect(await caretOn(screen, 'GitHub')).toBe(true)
    await screen.press('j')
    const switched = await screen.until('Nothing to list here.', 45)
    expect(caretLine(switched)).toContain('Docker')
    expect(switched).not.toContain('Invalidate the old password')

    // Docker is still component-only. Browse keeps its frame to avoid reflowing the rail, but the
    // empty frame is not a region and Tab cannot land there.
    const cycle: string[] = []
    for (let step = 0; step < 3; step += 1) {
      await screen.press('TAB')
      cycle.push(focusedRegion()?.regionId ?? '')
    }
    screen.done()
    expect(cycle).not.toContain('browse')
  }, 120_000)
})

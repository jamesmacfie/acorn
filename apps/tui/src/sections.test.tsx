/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { hasFfi } from './ffi'
import { renderFixture } from './harness'
import { focusedRegion } from './keys/regions'

// `Sections` in cells: one declaration, the other shape.
//
// The desktop draws a pull request as a column of folds beside its diff. A terminal has no second
// column to spend on seven folds nobody can see the bottom of, so the same list is a strip of tabs
// over one panel, with `main` keeping a column of its own while there is room for one
// (client-core/kit/components/layout/Sections.tsx).
//
// Three things have to hold and each broke while this was being built: the strip has to draw every
// tab rather than clipping half of them over whatever sits beside it, the strip has to be a parent
// stop instead of stealing Left/Right from whatever its current panel contains, and the main panel
// has to be a region Tab can get to at all — it was not, so nothing in a browse surface could be
// driven.
describe('a surface drawn as sections', () => {
  it.skipIf(!hasFfi)('is a strip of tabs, enters with Down, and takes main into the strip when narrow', async () => {
    const screen = await renderFixture({ width: 160, height: 38, pane: 'pr' })
    const wide = await screen.until('Comments', 45)

    // Every section is on the strip, and the header is the first tab rather than a fold.
    for (const tab of ['Details', 'Description', 'Labels', 'Checks', 'Reviewers', 'Files', 'Comments']) {
      expect(wide, tab).toContain(tab)
    }
    // `main` has a column, so the diff is beside the strip rather than behind a tab.
    expect(wide).toContain('Diff')
    expect(wide).toContain('src/login.ts')
    // The header tab is the one showing: the pull's own heading, not a fold's label.
    expect(wide).toContain('#42')

    // This fixture deliberately opens a task, so it starts in Tasks. Tab reaches the outer task-pane
    // strip; Down enters the PR pane on its own section strip; Right changes that inner strip. The old
    // focus-within binding let the first Right change the outer strip to Agent instead.
    await screen.press('TAB')
    expect(focusedRegion()?.regionId).toBe('panes')
    await screen.press('ARROW_DOWN')
    expect(focusedRegion()?.paneId).toBe('pr')
    await screen.press('ARROW_RIGHT')
    const switched = await screen.frame()
    // Description is a `ProviderHtml` body, so what it draws is the pull's own text.
    expect(switched).toContain('Loads the account first')

    // Narrow, and `main` becomes the last tab rather than half a screen of wrapped diff.
    screen.resize(100, 38)
    const narrow = await screen.until('Diff', 20)
    screen.done()
    expect(narrow).toContain('Details')
    expect(narrow).toContain('Diff')
    for (const line of narrow.split('\n')) expect(line.length).toBeLessThanOrEqual(100)
  }, 120_000)
})

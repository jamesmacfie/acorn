/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { renderFixture } from './harness'
import { focusedRegion } from './keys/regions'

// `Sections` in cells: one declaration, the other shape.
//
// The desktop draws a pull request as a column of folds beside its diff. A terminal has no second
// column to spend on seven folds nobody can see the bottom of, so the same list is a strip of tabs
// over one panel, with `main` keeping a column of its own while there is room for one
// (client-core/kit/components/layout/Sections.tsx).
//
// Three things have to hold: the strip draws every tab rather than clipping half of them over
// whatever sits beside it, the strip is a parent stop instead of stealing Left/Right from whatever its
// current panel contains, and the main panel is a region Tab can get to, or nothing in a browse
// surface can be driven.
describe('a surface drawn as sections', () => {
  it('is a strip of tabs, enters with Down, and takes main into the strip when narrow', async () => {
    const screen = await renderFixture({ width: 160, height: 38, pane: 'pr' })
    const wide = await screen.until('Conversation', 45)

    // Every section is on the strip, and the header is the first tab rather than a fold.
    for (const tab of ['Details', 'Labels', 'Checks', 'Reviewers', 'Files', 'Conversation']) {
      expect(wide, tab).toContain(tab)
    }
    // `main` has a column, so the diff is beside the strip rather than behind a tab.
    expect(wide).toContain('Diff')
    expect(wide).toContain('src/login.ts')
    // The header tab is the one showing: the pull's own heading, with its description under it. The
    // description is a `ProviderHtml` body, so what it draws is the pull's own text.
    expect(wide).toContain('#42')
    expect(wide).toContain('Loads the account first')

    // This fixture deliberately opens a task, so it starts in Tasks. Tab reaches the outer task-pane
    // strip; Down enters the PR pane on its own section strip; Right changes that inner strip, not the
    // outer one.
    await screen.press('TAB')
    expect(focusedRegion()?.regionId).toBe('panes')
    await screen.press('ARROW_DOWN')
    expect(focusedRegion()?.paneId).toBe('pr')
    await screen.press('ARROW_RIGHT')
    const switched = await screen.frame()
    expect(switched).toContain('[Labels]')
    expect(switched).toContain('No labels')

    // Narrow, and `main` becomes the last tab rather than half a screen of wrapped diff.
    screen.resize(100, 38)
    const narrow = await screen.until('Diff', 20)
    screen.done()
    expect(narrow).toContain('Details')
    expect(narrow).toContain('Diff')
    for (const line of narrow.split('\n')) expect(line.length).toBeLessThanOrEqual(100)
  }, 120_000)
})

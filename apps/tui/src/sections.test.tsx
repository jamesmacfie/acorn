/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { hasFfi } from './ffi'
import { renderFixture } from './harness'

// `Sections` in cells: one declaration, the other shape.
//
// The desktop draws a pull request as a column of folds beside its diff. A terminal has no second
// column to spend on seven folds nobody can see the bottom of, so the same list is a strip of tabs
// over one panel, with `main` keeping a column of its own while there is room for one
// (client-core/kit/components/layout/Sections.tsx).
//
// Three things have to hold and each broke while this was being built: the strip has to draw every
// tab rather than clipping half of them over whatever sits beside it, `h` and `l` have to reach the
// node from inside whatever the current tab drew, and the main panel has to be a region Tab can get
// to at all — it was not, so nothing in a browse surface could be driven.
describe('a surface drawn as sections', () => {
  it.skipIf(!hasFfi)('is a strip of tabs, walks with h and l, and takes main into the strip when narrow', async () => {
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

    // Into the surface, then along the strip. `l` is the pane's own key tier, focus-within, so it
    // works from wherever in the panel the keys landed — but only once the keys are in the panel at
    // all, which is what the region around a browse surface is for (./chrome/Shell.tsx).
    let switched = ''
    for (let step = 0; step < 12 && !switched.includes('Loads the account first'); step += 1) {
      await screen.press('TAB')
      await screen.press('l')
      switched = await screen.frame()
    }
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

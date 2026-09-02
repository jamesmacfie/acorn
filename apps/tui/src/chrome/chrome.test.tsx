/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { toast } from '@acorn/client-core/features/notifications/toast.ts'
import { _resetNotices, pushNotice } from '@acorn/client-core/features/notifications/notifications.ts'
import { hasFfi } from '../ffi'
import { renderFixture } from '../harness'

// The chrome, drawn against the fixture node: rail, topbar, pane strip, footer, palette, overlays.
//
// Whole-screen assertions rather than cell-level ones, for the reason the smoke test gives: what a
// reader would look for on the screen. The one thing asserted cell by cell is where the caret is,
// because on this host the caret is not decoration — it is where the keys are, and a screen with no
// caret is a screen nobody can drive (docs/testing.md § Test layers).

const caretRow = (frame: string): number => frame.split('\n').findIndex((line) => line.includes('›'))

describe.skipIf(!hasFfi)('the shell', () => {
  it('draws the topbar, the rail, the pane strip and the footer at 80 by 24', async () => {
    const screen = await renderFixture({ pane: 'notes' })
    const frame = await screen.until('Scratchpad')
    screen.done()

    const lines = frame.split('\n')
    // The topbar: the workspace, how many tasks are in it, and the branch of the one that is open.
    expect(lines[0]).toContain('acorn')
    expect(lines[0]).toContain('1 task')
    expect(lines[0]).toContain('fix-login')
    // The pane strip, with the pane it is showing marked.
    expect(frame).toContain('[Notes]')
    // The pane itself, which is the notes pane and knows nothing about any of this.
    expect(frame).toContain('Scratchpad')
    // The footer, drawn from the keymap's active layers.
    expect(lines[lines.length - 2]).toContain('j/k move')
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80)
  }, 30_000)

  it('holds together at 120 by 40, where the rail keeps its names', async () => {
    const screen = await renderFixture({ width: 120, height: 40, pane: 'notes' })
    const frame = await screen.frame()
    screen.done()

    // Wide enough for the rail to be a rail rather than a strip of marks.
    expect(frame).toContain('fix-login')
    expect(frame).toContain('[Notes]')
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(120)
  }, 30_000)

  it('opens on the first Menu source, with the keys on that row', async () => {
    const screen = await renderFixture({ width: 120, height: 40 })
    const frame = await screen.until('Reviews')
    screen.done()

    // There is no click to put the keys anywhere. Startup waits for provider/workspace gates, picks
    // the first source the Menu actually draws, and lands the caret on the same row.
    const row = frame.split('\n')[caretRow(frame)] ?? ''
    expect(row).toContain('GitHub')
    expect(frame).toContain('Reviews')
  }, 30_000)

  it('cycles rail, pane strip and pane on tab, and wraps', async () => {
    const screen = await renderFixture({ width: 120, height: 40, pane: 'notes' })
    const rail = await screen.frame()
    const strip = await screen.press('TAB').then(() => screen.frame())
    const pane = await screen.press('TAB').then(() => screen.frame())
    screen.done()

    expect(rail.split('\n')[caretRow(rail)]).toContain('fix-login')
    expect(strip.split('\n')[caretRow(strip)]).toContain('[Notes]')
    expect(pane.split('\n')[caretRow(pane)]).toContain('Scratchpad')
  }, 30_000)

  it('hides the left column on the chord and brings it back', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    expect(await screen.frame()).toContain('Browse')

    // One way to lose the column, and it is a chord: the two-cell strip of marks that used to replace
    // it below 100 cells went with the icons, because the strip only said anything when every row had
    // a glyph and most of those glyphs drew nothing (../kit/glyphs.ts).
    await screen.press('b', { ctrl: true })
    const hidden = await screen.frame()
    expect(hidden).not.toContain('Browse')
    expect(hidden).not.toContain('Tasks')

    await screen.press('b', { ctrl: true })
    const back = await screen.frame()
    screen.done()
    expect(back).toContain('Browse')
  }, 30_000)

  it('names the workspace and the project in the topbar, and p picks a project', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    // `Workspace > Project`. The project is not visible anywhere else on this host — the desktop
    // carries it in the address bar — so a reader with an empty browse list can tell a missing
    // integration from the wrong project (./Topbar.tsx).
    expect((await screen.frame()).split('\n')[0]).toContain('>')

    await screen.press('p')
    const open = await screen.frame()
    screen.done()
    expect(open).toContain('Project')
  }, 30_000)

  it('opens the palette on the chord, filters, and gives the keys back on escape', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    const before = caretRow(await screen.frame())

    await screen.press('k', { ctrl: true })
    const open = await screen.frame()
    expect(open).toContain('Commands')
    expect(open).toContain('Switch workspace')

    // The field owns the typing, and the list narrows to what matches.
    await screen.press('q')
    const filtered = await screen.frame()
    expect(filtered).toContain('Quit')
    expect(filtered).not.toContain('Switch workspace')

    await screen.press('ESCAPE')
    const closed = await screen.frame()
    screen.done()

    expect(closed).not.toContain('Switch workspace')
    expect(closed).toContain('Reviews')
    // Back where they were, which is what the DOM palette's `prevFocus` does with an element.
    expect(caretRow(closed)).toBe(before)
  }, 30_000)

  it('draws the cheat sheet on ? with the keys that are live', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    await screen.press('?')
    const frame = await screen.frame()
    screen.done()

    expect(frame).toContain('Keys')
    expect(frame).toContain('j/k')
    expect(frame).toContain('ctrl+k')
    // Read from the active layers, not from a written list: `tab` is this host's own key for a shared
    // intent and it is here because the region layer bound it (../keys/install.ts).
    expect(frame).toContain('tab')
  }, 30_000)

  it('draws a notification above the footer, and never takes the keys for it', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    const opening = await screen.frame()
    const before = opening.split('\n')[caretRow(opening)]
    toast('Saved.')
    const frame = await screen.frame()

    const lines = frame.split('\n')
    const at = lines.findIndex((line) => line.includes('Saved.'))
    expect(at).toBeGreaterThan(0)
    // Above the footer, which is the last drawn line.
    expect(lines[at + 1]).toContain('j/k move')
    // The keys are where they were. Compared by what the caret is on rather than its row number, so
    // a notification taking one line tests focus rather than panel arithmetic.
    expect(lines[caretRow(frame)]).toBe(before)

    await screen.press('ESCAPE')
    const cleared = await screen.frame()
    screen.done()
    expect(cleared).not.toContain('Saved.')
  }, 30_000)

  // The count and what is behind it (docs/tui.md § What is drawn bespoke). The number is the desktop
  // bell's, written here through the platform seam's `setBadge`, and `n` opens the same two sections
  // the bell's popover holds.
  it('counts what is waiting in the topbar, and opens the inbox on n', async () => {
    _resetNotices()
    pushNotice({ taskId: 'task-1', kind: 'agent-needs-input', title: 'claude needs you', at: Date.now() })
    pushNotice({ taskId: 'task-1', kind: 'agent-completed', title: 'claude finished', at: Date.now() })
    const screen = await renderFixture({ width: 100, height: 28 })
    const counted = await screen.until('\u25d4 2')
    expect(counted.split('\n')[0]).toContain('\u25d4 2')

    await screen.press('n')
    const inbox = await screen.until('claude needs you')
    screen.done()
    _resetNotices()

    expect(inbox).toContain('Notifications')
    expect(inbox).toContain('claude finished')
  }, 30_000)

  it('draws no count when nothing is waiting', async () => {
    _resetNotices()
    const screen = await renderFixture({ width: 100, height: 28 })
    const frame = await screen.frame()
    screen.done()
    expect(frame.split('\n')[0]).not.toContain('\u25d4')
  }, 30_000)

  it('asks before quitting a node it started, and does not when it only attached', async () => {
    const attached = await renderFixture({ width: 100, height: 28 })
    await attached.press('q')
    const straight = await attached.frame()
    expect(straight).not.toContain('Quit and stop the node')
    expect(attached.quits()).toBe(1)
    attached.done()

    const started = await renderFixture({ width: 100, height: 28, supervised: true })
    await started.press('q')
    const asked = await started.frame()
    expect(asked).toContain('Quit and stop the node')
    expect(started.quits()).toBe(0)

    // Enter on the first row quits. The overlay is still drawn afterwards and that is right: the real
    // `onQuit` takes the terminal back and ends the process, so there is no frame after it to close
    // anything in. A list inside a `Modal` answering Enter at all is the phase-2 trap bug this test
    // caught (../keys/trap.ts § SWALLOW_PRIORITY).
    await started.press('RETURN')
    started.done()
    expect(started.quits()).toBe(1)
  }, 30_000)
})

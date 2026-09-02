/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { hasFfi } from './ffi'
import { renderFixture } from './harness'
import { focusedRegion } from './keys/regions'

const caretLine = (frame: string): string =>
  frame.split('\n').find((line) => line.includes('\u203a')) ?? ''

describe.skipIf(!hasFfi)('spatial focus', () => {
  it('enters main from rail shortcuts, restores rail, and lets h/l walk detail tabs', async () => {
    const screen = await renderFixture({ width: 100, height: 32 })

    // The ordinary startup path opens on Menu. Enter performs its normal source activation and then
    // crosses to the content that activation opened; Escape returns to the source's Browse list.
    expect(await screen.reach('GitHub')).toBe(true)
    await screen.press('RETURN')
    expect(focusedRegion()?.regionId).toBe('source')
    await screen.press('ESCAPE')
    expect(focusedRegion()?.regionId).toBe('browse')

    // Menu selected GitHub when it took focus; once its list exists, entering Browse selects its
    // first row.
    await screen.until('Invalidate')
    expect(await screen.reach('Invalidate')).toBe(true)
    await screen.until('(fix-login) → (main)', 45)

    const browseCaret = caretLine(await screen.frame())
    expect(focusedRegion()?.regionId).toBe('browse')

    // Ctrl+Option+Right is the shared next-pane chord. On this host the main content is spatially to
    // the right of every rail section, so it must enter detail before the task-pane cycler gets a
    // chance to answer. This was the dead shortcut: a source view has no active task to cycle.
    await screen.press('ARROW_RIGHT', { ctrl: true, meta: true })
    expect(focusedRegion()?.regionId).toBe('source')

    // Once inside, the detail's Sections node owns bare h/l. The second tab is the PR description,
    // proving focus moved into the content rather than only lighting its frame.
    await screen.press('l')
    expect(await screen.frame()).toContain('Loads the account first')

    await screen.press('ARROW_LEFT', { ctrl: true, meta: true })
    const returned = await screen.frame()

    expect(focusedRegion()?.regionId).toBe('browse')
    // Compare the rail half only: the right half now deliberately still shows Description, so the
    // whole terminal line is different even though column memory restored the same Browse row.
    expect(caretLine(returned).split('│').slice(0, 2)).toEqual(browseCaret.split('│').slice(0, 2))

    // Enter is the discoverable spelling of the same rail-to-main edge, after the Browse row's own
    // activation. Escape is the reverse spelling when the right pane has the keys.
    await screen.press('RETURN')
    expect(focusedRegion()?.regionId).toBe('source')
    await screen.press('ESCAPE')
    expect(focusedRegion()?.regionId).toBe('browse')
    screen.done()
  }, 120_000)

  it('enters an explicitly opened task and escapes through the pane strip to Tasks', async () => {
    const screen = await renderFixture({ width: 100, height: 32, pane: 'notes' })

    expect(focusedRegion()?.regionId).toBe('tasks')
    await screen.press('RETURN')
    expect(focusedRegion()?.paneId).toBe('notes')
    await screen.press('ESCAPE')
    expect(focusedRegion()?.regionId).toBe('panes')
    await screen.press('ESCAPE')
    expect(focusedRegion()?.regionId).toBe('tasks')
    screen.done()
  }, 120_000)
})

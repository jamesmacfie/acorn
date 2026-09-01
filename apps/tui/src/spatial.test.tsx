/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { hasFfi } from './ffi'
import { renderFixture } from './harness'
import { focusedRegion } from './keys/regions'

const caretLine = (frame: string): string =>
  frame.split('\n').find((line) => line.includes('\u203a')) ?? ''

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

describe.skipIf(!hasFfi)('spatial focus', () => {
  it('moves right from Browse into detail and left from the first section back to the same row', async () => {
    const screen = await renderFixture({ width: 100, height: 32 })

    // Choose GitHub from Menu. Menu does not select on entry, so a move away and back is the explicit
    // source choice; once its list exists, entering Browse selects its first row.
    expect(await caretOn(screen, 'GitHub')).toBe(true)
    await screen.press('j')
    await screen.press('k')
    await screen.until('Invalidate')
    expect(await caretOn(screen, 'Invalidate')).toBe(true)
    await screen.until('(fix-login) → (main)', 45)

    const browseCaret = caretLine(await screen.frame())
    expect(focusedRegion()?.regionId).toBe('browse')

    // The vertical pull list has no expand action, so `l` bubbles from its collection layer to the
    // spatial region layer. The detail's Sections strip is on its first tab, where `h` yields rather
    // than wrapping to the last tab, and column memory restores the Browse row.
    await screen.press('l')
    expect(focusedRegion()?.regionId).toBe('source')
    await screen.press('h')
    const returned = await screen.frame()

    expect(focusedRegion()?.regionId).toBe('browse')
    expect(caretLine(returned)).toBe(browseCaret)
    screen.done()
  }, 120_000)
})

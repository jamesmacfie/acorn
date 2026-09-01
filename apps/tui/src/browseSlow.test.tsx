/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { hasFfi } from './ffi'
import { renderFixture } from './harness'

// Its own file for the same reason as ./browseLong.test.tsx: the query cache is module state, so a
// warm list from an earlier test in the same worker would hide exactly what this one is about.
//
// What this one is about: a transport slow enough that a `Suspense` which has already shown content
// suspends again and stays suspended past the next tick. That is the shape the app lives in and the
// zero-latency fixture never reached — the caches were warm before the first key press, so nothing
// ever suspended after first paint, and both browse tests passed while the app drew blank panels.
// Under that shape, OpenTUI used to destroy the removed subtree and refuse it back ("was already
// destroyed, skipping add"), leaving the panel empty forever (kit/reconciler.ts § Destroy on
// disposal). So this walks the caret past the prefetch horizon, where every landing mounts uncached
// queries, and asserts the two things a reader actually loses: the detail still draws, and the list
// is still there to come back to.
const caretLine = (frame: string): string => frame.split('\n').find((line) => line.includes('›')) ?? ''

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

describe.skipIf(!hasFfi)('browsing over a slow transport', () => {
  it('keeps drawing the list and the detail after a shown Suspense suspends again', async () => {
    process.env.ACORN_FIXTURE_PULLS = '40'
    process.env.ACORN_FIXTURE_DELAY_MS = '50'
    try {
      const screen = await renderFixture({ width: 100, height: 32 })
      expect(await caretOn(screen, 'GitHub')).toBe(true)
      await screen.press('j')
      await screen.press('k')
      await screen.until('Invalidate')
      expect(await caretOn(screen, 'Invalidate')).toBe(true)

      // Every line OpenTUI logs about a destroyed renderable is a subtree that will never draw
      // again; the walk below is long enough to slide the window and outrun the prefetch, so each
      // landing suspends the detail and mounts uncached row queries under the Browse panel.
      const logged: string[] = []
      const [error, warn] = [console.error, console.warn]
      console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
      console.warn = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
      try {
        for (let step = 0; step < 15; step += 1) await screen.press('j')

        // The detail resolved and drew. The branch pair is text only the loaded detail has — the
        // fixture answers every pull number with the same detail, so this is purely "drawn, not
        // blank" (browse.test.tsx says why neither `PULL REQUEST` nor `#42` can stand in for it).
        const opened = await screen.until('(fix-login) → (main)', 45)
        // The Browse list survived its own re-suspensions: the caret is still on a row.
        expect(caretLine(opened)).toContain('Older pull')

        // And navigating again from a subtree that has been through a suspend still renders.
        await screen.press('k')
        await screen.until('(fix-login) → (main)', 45)
      } finally {
        console.error = error
        console.warn = warn
      }
      screen.done()
      expect(logged.filter((line) => line.includes('destroyed'))).toEqual([])
    } finally {
      delete process.env.ACORN_FIXTURE_PULLS
      delete process.env.ACORN_FIXTURE_DELAY_MS
    }
  }, 120_000)
})

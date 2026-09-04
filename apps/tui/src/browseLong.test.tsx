/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { renderFixture } from './harness'

// Its own file, not a second case in ./browse.test.tsx: the query cache is module state and outlives
// a render, so the pull list the first test loaded is the one a second test in the same worker gets,
// however many the fixture is offering.
const caretLine = (frame: string): string => frame.split('\n').find((line) => line.includes('\u203a')) ?? ''

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

// A list longer than the panel it draws in.
//
// The failure this pins is the whole left column: the Browse panel grew to the height of its list,
// pushed the Tasks panel off the bottom and drew over the footer, and the rows inside it squeezed
// every field into an illegible smear — the caret column with them, so a focused list looked exactly
// like an unfocused one (../panel.tsx, ./kit/showing.tsx § Rows).
describe('a browse list longer than its panel', () => {
  it('windows to the panel, shows where it is, and leaves the panels below it alone', async () => {
    process.env.ACORN_FIXTURE_PULLS = '40'
    try {
      const screen = await renderFixture({ width: 100, height: 32 })
      expect(await caretOn(screen, 'GitHub')).toBe(true)
      await screen.until('Older pull')

      // Into Browse, and the caret is on a row rather than on the frame.
      expect(await caretOn(screen, 'Invalidate')).toBe(true)
      const drawn = await screen.frame()

      // Both terminal arrow spellings drive the Browse collection. This is asserted before the long
      // walk so a dead collection cannot pass merely because its initial row and scrollbar drew.
      await screen.press('ARROW_DOWN')
      expect(caretLine(await screen.frame())).toContain('#100 Older pull')
      await screen.press('ARROW_UP')
      expect(caretLine(await screen.frame())).toContain('Invalidate')

      // Then walk it. Each move loads a different pull into the main panel. The 'destroyed' filter
      // below is a canary from the era when a re-suspending boundary destroyed its own subtree
      // (./kit/reconciler.ts § Destroy on disposal; ./browseSlow.test.tsx is the test that reaches
      // that shape on purpose) — kept because it is one line and it catches a regression for free.
      const logged: string[] = []
      const [error, warn] = [console.error, console.warn]
      console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
      console.warn = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
      for (let step = 0; step < 6; step += 1) await screen.press('ARROW_DOWN')
      await screen.frame()
      screen.done()
      console.error = error
      console.warn = warn
      expect(logged.filter((line) => line.includes('destroyed'))).toEqual([])

      // The panels below it are still on the screen, and the list drew a scrollbar rather than the
      // other thirty rows.
      expect(drawn).toContain('Tasks')
      expect(drawn).toContain('█')
      expect(drawn).not.toContain('Older pull 139')
      for (const line of drawn.split('\n')) expect(line.length).toBeLessThanOrEqual(100)
    } finally {
      delete process.env.ACORN_FIXTURE_PULLS
    }
  }, 120_000)
})

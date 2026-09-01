/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { selectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { hasFfi } from './ffi'
import { renderFixture } from './harness'
import { focusedRegion } from './keys/regions'

const caretLine = (frame: string): string =>
  frame.split('\n').find((line) => line.includes('\u203a')) ?? ''

// Its own file because the shell QueryClient intentionally survives a render; changing fixture
// workspaces inside another shell test would otherwise reuse that file's already-cached roster.
describe.skipIf(!hasFfi)('workspace focus handoff', () => {
  it('selects and focuses the first Menu source after changing workspace', async () => {
    process.env.ACORN_FIXTURE_SECOND_WORKSPACE = '1'
    try {
      const screen = await renderFixture({ width: 100, height: 32 })
      await screen.until('Reviews')

      await screen.press('w')
      expect(await screen.frame()).toContain('Workspace')
      await screen.press('ARROW_DOWN')
      await screen.press('RETURN')

      await screen.until('second > second-project')
      let switched = await screen.frame()
      for (let turn = 0; turn < 20 && selectedSource() !== 'github'; turn += 1) {
        await new Promise((done) => setTimeout(done, 100))
        switched = await screen.frame()
      }
      expect(focusedRegion()?.regionId).toBe('menu')
      expect(selectedSource()).toBe('github')
      expect(caretLine(switched)).toContain('GitHub')
      screen.done()
    } finally {
      delete process.env.ACORN_FIXTURE_SECOND_WORKSPACE
    }
  }, 120_000)
})

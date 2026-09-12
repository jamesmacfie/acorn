/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { selectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { renderFixture } from './harness'
import { focusedRegion } from './keys/regions'

const caretLine = (frame: string): string =>
  frame.split('\n').find((line) => line.includes('\u203a')) ?? ''

// Its own file because the shell QueryClient intentionally survives a render; changing fixture
// workspaces inside another shell test would otherwise reuse that file's already-cached roster.
describe('workspace focus handoff', () => {
  it('opens a new workspace on its first Menu source and a visited one where it was left', async () => {
    process.env.ACORN_FIXTURE_SECOND_WORKSPACE = '1'
    try {
      const screen = await renderFixture({ width: 100, height: 32 })
      await screen.until('Reviews')

      // Move off this workspace's default source first, so coming back to it has something to come
      // back to. The Menu selects on the caret, so one press down is the whole choice (./chrome/Rail.tsx).
      await screen.press('ARROW_DOWN')
      expect(selectedSource()).toBe('docker')

      await screen.press('w')
      expect(await screen.frame()).toContain('Workspace')
      await screen.press('ARROW_DOWN')
      await screen.press('RETURN')

      // Two waits and no polling. The topbar says the switch landed; the Browse list says the new
      // workspace's default source was chosen, which is the model's own effect and the settle it
      // schedules (./chrome/model.ts § defaultSource). Before those existed this loop asked twenty
      // times whether the caret had caught up yet.
      await screen.until('second > second-project')
      const switched = await screen.until('Reviews')
      expect(focusedRegion()?.regionId).toBe('menu')
      expect(selectedSource()).toBe('github')
      expect(caretLine(switched)).toContain('GitHub')

      // …and back, onto the source that was open here rather than onto this workspace's default.
      // That memory is what a relaunch reads too (./chrome/restore.ts).
      await screen.press('w')
      await screen.press('ARROW_UP')
      await screen.press('RETURN')
      await screen.until('acorn > acorn')
      expect(selectedSource()).toBe('docker')
      screen.done()
    } finally {
      delete process.env.ACORN_FIXTURE_SECOND_WORKSPACE
    }
  }, 120_000)
})

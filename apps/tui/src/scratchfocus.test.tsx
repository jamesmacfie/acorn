/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { hasFfi } from './ffi'
import { renderFixture } from './harness'

describe.skipIf(!hasFfi)('scratch', () => {
  it('reports footer after two downs', async () => {
    const screen = await renderFixture({ pane: 'pr', width: 100, height: 32 })
    try {
      await screen.until('[Merge]', 45)
      const { focusedRegion } = await import('./keys/regions')
      const { focusedKind } = await import('./chrome/bindings')
      await screen.press('TAB')
      await screen.press('ARROW_DOWN')
      await screen.press('ARROW_DOWN')
      await screen.spans()
      await screen.spans()
      const f = await screen.frame()
      const lines = f.split('\n').filter((l: string) => l.trim())
      console.log('KIND=' + focusedKind(), JSON.stringify(focusedRegion()))
      console.log('FOOTER=' + JSON.stringify(lines[lines.length - 1]))
      expect(1).toBe(1)
    } finally {
      await screen.dispose()
    }
  }, 60_000)
})

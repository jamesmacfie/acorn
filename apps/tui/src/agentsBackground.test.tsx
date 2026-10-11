/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { renderFixture } from './harness'
import { enterDetail, openFirstSession, stopSaying } from './agentsDriving'

// A background command in the terminal: the same card the desktop draws
// (docs/managed-agents/background-commands.md). Its own file because the managed-session store is
// module state, as ./agentsWeb.test.tsx explains.

describe('a transcript with a background command in it', () => {
  it('says the command is still running, names it in the header, and shows its newest output', async () => {
    process.env.ACORN_FIXTURE_BACKGROUND_COMMAND = '1'
    try {
      const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
      try {
        await openFirstSession(screen)
        const folded = await screen.until('running in background')
        expect(folded).toContain('pnpm test')
        expect(folded).toContain('1 command running in background')

        await enterDetail(screen)
        await stopSaying(screen, 'pnpm test')
        await screen.press('RETURN')
        const open = await screen.until('test 20 passed')
        expect(open).not.toContain('test 8 passed')
        expect(open).toContain('Show all output (8 more lines)')
      } finally {
        screen.done()
      }
    } finally {
      delete process.env.ACORN_FIXTURE_BACKGROUND_COMMAND
    }
  }, 180_000)
})

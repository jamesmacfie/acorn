/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { renderFixture } from './harness'
import { enterDetail, openFirstSession, stopSaying } from './agentsDriving'

// A web call in the terminal.
//
// Every other tool card opens onto text, which a cell buffer draws much as a browser does. This one
// opens onto links, and this host has no browser to hand one to — so the promise is different and a
// desktop render is no evidence for it. The address has to be readable, and pressing a focused link
// has to be what puts it on screen (../kit/showing.tsx § Link).
//
// Its own file for the reason ./agentsFollow.test.tsx is: the managed-session store is module state
// and its snapshots outlive a render, so a case that wants a different transcript from its
// neighbours' has to be the only case in the process.

describe('a transcript with web activity in it', () => {
  it('shows what an agent searched for and where the answer came from', async () => {
    process.env.ACORN_FIXTURE_WEB_ACTIVITY = '1'
    try {
      const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
      try {
        await openFirstSession(screen)
        // Folded, the row says what it did and what it looked for. That summary beside the title is
        // why the query is not in the title: the title stays `Search web` for every one of these,
        // which is what a reader scans a transcript by.
        const folded = await screen.until('Search web')
        expect(folded).toContain('bcrypt compare timing')
        expect(folded).not.toContain('docs.example/bcrypt')

        await enterDetail(screen)
        await stopSaying(screen, 'Search web')
        await screen.press('RETURN')
        const open = await screen.until('Comparing hashes')
        expect(open).toContain('docs.example')

        // The link, pressed. There is nowhere to send it, so this host prints the address instead,
        // which is what it does with every address it cannot open.
        await stopSaying(screen, 'Comparing hashes')
        await screen.press('RETURN')
        expect(await screen.until('https://docs.example/bcrypt')).toContain('https://docs.example/bcrypt')
      } finally {
        screen.done()
      }
    } finally {
      delete process.env.ACORN_FIXTURE_WEB_ACTIVITY
    }
  }, 180_000)
})

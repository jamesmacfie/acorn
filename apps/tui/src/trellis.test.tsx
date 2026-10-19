/** @jsxImportSource @acorn/tui/jsx */
import { expect, it, vi } from 'vitest'
import { renderCells } from './kit/render'
import { HeaderBodyFooter } from './layouts/HeaderBodyFooter'

const fixture = vi.hoisted(() => ({ compose: vi.fn(async () => ({ ok: true })) }))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  composeForAgent: fixture.compose,
  taskById: () => ({ title: 'Migrate billing', branch: 'migrate' }),
}))
import { AppView } from '@acorn/plugin-trellis/testkit/client'

it("draws an app's kit components in the terminal, its Panel as one line, and keeps a tick", async () => {
  const program = [
    'root = Card("Migration", [Checkbox("backup", "Back up the database", $backup, "Take a snapshot first"), Text(done + " of 1 done", "muted"), Panel("cost")])',
    '$backup = false',
    'done = $backup ? 1 : 0',
  ].join('\n')
  // Drawn as a pane's body, so the keys land in it the way they do in a transcript.
  let screen = await renderCells(
    () => (
      <HeaderBodyFooter
        stateKey="trellis"
        label="App"
        regions={{
          body: () => (
            <AppView
              appId="app-0123456789ab"
              taskId="task"
              workspaceId="w"
              nodeId="n"
              files={{ program, plans: { cost: { version: 2, title: 'Agent cost' } } }}
              readOnly={false}
            />
          ),
        }}
      />
    ),
    { width: 100, height: 20 },
  )
  await vi.waitFor(async () => {
    screen = await screen.frame()
    expect(screen.text).toContain('Back up the database')
  })
  expect(screen.text).toContain('[ ] Back up the database Take a snapshot first')
  expect(screen.text).toContain('Migration')
  expect(screen.text).toContain('0 of 1 done')
  expect(screen.text).toContain('Agent cost: this panel draws in the desktop app.')
  screen = await screen.press(' ')
  await vi.waitFor(async () => {
    screen = await screen.frame()
    expect(screen.text).toContain('1 of 1 done')
  })
  screen.done()
})

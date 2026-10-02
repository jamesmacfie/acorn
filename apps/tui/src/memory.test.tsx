/** @jsxImportSource @acorn/tui/jsx */
import { expect, it, vi } from 'vitest'
import { renderCells } from './kit/render'
import { focusedRenderable, regionFocus } from './keys/regions'
import { runText } from './tree/renderer'

const fixture = vi.hoisted(() => ({ exists: true, undo: vi.fn() }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: [] }) }))
vi.mock('@solidjs/router', () => ({ useParams: () => ({ projectId: 'project-1' }), useNavigate: () => vi.fn() }))
vi.mock('@acorn/plugin-api/client', async original => ({
  ...await original<Record<string, unknown>>(),
  onPluginFrame: () => () => {},
  readJson: async () => fixture.exists ? [{ name: 'terminal-rule', scope: 'project', type: 'project', description: 'Release rule', updatedAt: 1 }] : [],
  writeJson: async (url: string) => {
    if (url.endsWith('/undo')) { fixture.undo(url); fixture.exists = false; return {} }
    switch (url.split('/library/')[1]?.split('?')[0]) {
      case 'changes': return fixture.exists ? [{ id: 'change-1', name: 'terminal-rule', scope: 'project', projectId: 'project-1', by: 'agent', at: '2026-10-02T00:00:00Z', action: 'write', canUndo: true }] : []
      case 'get': return fixture.exists ? { name: 'terminal-rule', scope: 'project', type: 'project', description: 'Release rule', hash: 'h', body: 'Run the pipeline before release.', updatedAt: 1 } : null
      case 'history': case 'sources': return []
      case 'preview': return { text: 'Exact agent context', counts: { private: 0, project: 51 }, shown: { private: 0, project: 51 }, caps: { private: 4000, project: 12000 } }
      default: throw new Error(`Unexpected fixture request: ${url}`)
    }
  },
}))
import { MemoryCenter, selectMemory } from '@acorn/plugin-memory/testkit/client'

it('lets the terminal keyboard read a memory, inspect context, and undo an agent write', async () => {
  fixture.exists = true
  selectMemory(undefined)
  let screen = await renderCells(() => <box flexDirection="column" flexGrow={1} ref={regionFocus({ paneId: 'memory', regionId: 'library' }, 0)}><MemoryCenter /></box>, { width: 120, height: 40 })
  const reach = async (label: string) => {
    for (let step = 0; step < 40; step += 1) {
      const node = focusedRenderable()
      if (node && runText(node).includes(label)) return true
      screen = await screen.press('ARROW_DOWN')
    }
    return false
  }
  const waitFor = async (label: string) => {
    await vi.waitFor(async () => { screen = await screen.frame(); expect(screen.text).toContain(label) })
  }
  try {
    await waitFor('terminal-rule')
    expect(await reach('terminal-rule')).toBe(true)
    screen = await screen.press('RETURN')
    await waitFor('Run the pipeline before release.')
    expect(await reach('What agents see')).toBe(true)
    screen = await screen.press('RETURN')
    await waitFor('Exact agent context')
    // Move back through the same reachable controls to the feed's guarded Undo.
    for (let step = 0; step < 40 && !runText(focusedRenderable()!).includes('Undo'); step += 1) screen = await screen.press('ARROW_UP')
    expect(runText(focusedRenderable()!)).toContain('Undo')
    screen = await screen.press('RETURN')
    await waitFor('No memories yet')
    expect(fixture.undo).toHaveBeenCalledWith('/v1/p/memory/memory/changes/change-1/undo')
  } finally { screen.done(); selectMemory(undefined) }
}, 30_000)

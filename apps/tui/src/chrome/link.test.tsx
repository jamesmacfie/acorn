/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { contentLinkRegistry, projectSurfaceRegistry } from '@acorn/client-core/host/registries/panes'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { TASK } from '../fixture'
import { renderFixture } from '../harness'
import { Line } from '../kit/cells'

describe('terminal startup links', () => {
  it('opens the requested task pane over a remembered browse source', async () => {
    const screen = await renderFixture({ link: { nodeId: 'node-1', kind: 'task', taskId: TASK.id, pane: 'notes' } })
    const frame = await screen.until('Scratchpad')
    expect(frame).toContain('Task: fix-login')
    expect(frame).toContain('[Notes]')
    screen.done()
  }, 30_000)

  it('routes an external URL through its registered recogniser and terminal source', async () => {
    const screen = await renderFixture({
      link: { nodeId: 'node-1', kind: 'open', url: 'https://example.test/issue/ABC-7' },
      register: () => {
        const source = sourceRegistry.register({
          id: 'fixture.link', order: 5, glyph: 'link', label: 'Linked item',
          routes: [{ id: 'fixture.link.item', path: '/p/:projectId/fixture/:item', order: 5 }],
          component: () => <Line>Linked item ABC-7</Line>,
        })
        const recogniser = contentLinkRegistry.register({
          id: 'fixture.link', providerId: 'fixture',
          parse: (href) => href === 'https://example.test/issue/ABC-7' ? { kind: 'fixture.link', item: 'ABC-7' } : null,
          path: () => `/p/${TASK.projectId}/fixture/ABC-7`,
        })
        return () => { recogniser.dispose(); source.dispose() }
      },
    })
    const frame = await screen.until('Linked item ABC-7')
    expect(frame).toContain('Linked item')
    screen.done()
  }, 30_000)

  it('opens the project and explains a plugin page without a terminal source', async () => {
    const screen = await renderFixture({
      link: { nodeId: 'node-1', kind: 'project', projectId: TASK.projectId, rest: ['x', 'ghost', 'item-1'] },
      register: () => {
        const surface = projectSurfaceRegistry.register({
          id: 'fixture.ghost', path: '/p/:projectId/x/ghost/:item', item: 'item', order: 1,
          component: () => <Line>Desktop only</Line>,
        })
        return surface.dispose
      },
    })
    const frame = await screen.until('opened the project')
    expect(frame).toContain('fixture.ghost has no terminal view')
    expect(frame).not.toContain('Desktop only')
    screen.done()
  }, 30_000)
})

/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { createSignal } from 'solid-js'
import { contentLinkRegistry, projectSurfaceRegistry } from '@acorn/client-core/host/registries/panes'
import { paneRegistry } from '@acorn/client-core/host/registries/panes/panes.ts'
import { settingsRegistry } from '@acorn/client-core/host/registries/shell'
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

  it('waits for a loaded pane contribution before resolving its task link', async () => {
    const [ready, setReady] = createSignal(false)
    const screen = await renderFixture({
      link: { nodeId: 'node-1', kind: 'task', taskId: TASK.id, pane: 'fixture.late' },
      linkReady: ready,
    })
    expect(await screen.frame()).not.toContain('The pane fixture.late is not available')
    const pane = paneRegistry.register({
      id: 'fixture.late', label: 'Late pane', glyph: 'link', order: 1,
      component: () => <Line>Loaded pane content</Line>,
    })
    try {
      setReady(true)
      const frame = await screen.until('Loaded pane content')
      expect(frame).toContain('[Late pane]')
      screen.done()
    } finally {
      pane.dispose()
    }
  }, 30_000)

  it('refuses an unavailable pane when contribution preparation reaches its deadline', async () => {
    const [ready, setReady] = createSignal(false)
    const screen = await renderFixture({
      link: { nodeId: 'node-1', kind: 'task', taskId: TASK.id, pane: 'fixture.missing' },
      linkReady: ready,
    })
    setReady(true)
    const frame = await screen.until('The pane fixture.missing is not available')
    expect(frame).not.toContain('Task: fix-login')
    screen.done()
  }, 30_000)

  it('waits for a named loaded Settings page before resolving its link', async () => {
    const [ready, setReady] = createSignal(false)
    const screen = await renderFixture({
      link: { nodeId: 'node-1', kind: 'settings', pageId: 'fixture.settings' },
      linkReady: ready,
    })
    const page = settingsRegistry.register({
      id: 'fixture.settings', label: 'Loaded settings', order: 50,
      component: () => <Line>Loaded settings page</Line>,
    })
    try {
      setReady(true)
      expect(await screen.until('Loaded settings page')).toContain('Loaded settings')
      screen.done()
    } finally {
      page.dispose()
    }
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

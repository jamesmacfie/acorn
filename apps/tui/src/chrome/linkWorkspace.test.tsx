/** @jsxImportSource @acorn/tui/jsx */
import { createSignal } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { activeTaskId, rememberWorkspaceView, selectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { contentLinkRegistry } from '@acorn/client-core/host/registries/panes'
import { SECOND_TASK } from '../fixture'
import { renderFixture } from '../harness'
import { currentPath } from '../kit/router'
import { Line } from '../kit/cells'

describe('linked destination in another workspace', () => {
  it('keeps an explicit task over that workspace’s remembered source', async () => {
    process.env.ACORN_FIXTURE_SECOND_WORKSPACE = '1'
    process.env.ACORN_FIXTURE_LINK_SCOPES = '1'
    try {
      const [ready, setReady] = createSignal(false)
      const screen = await renderFixture({
        link: { nodeId: 'node-1', kind: 'task', taskId: SECOND_TASK.id },
        linkReady: ready,
      })
      rememberWorkspaceView('ws-2', { source: 'docker' })
      setReady(true)
      const frame = await screen.until('Task: second task')
      expect(frame).toContain('second · 1 task')
      expect(activeTaskId()).toBe(SECOND_TASK.id)
      expect(selectedSource()).toBeNull()
      expect(currentPath()).toBe('/t/task-2')
      screen.done()
    } finally {
      delete process.env.ACORN_FIXTURE_SECOND_WORKSPACE
      delete process.env.ACORN_FIXTURE_LINK_SCOPES
    }
  }, 30_000)

  it('does not select a source hidden by the destination workspace’s provider scope', async () => {
    process.env.ACORN_FIXTURE_SECOND_WORKSPACE = '1'
    process.env.ACORN_FIXTURE_LINK_SCOPES = '1'
    try {
      const [ready, setReady] = createSignal(false)
      const screen = await renderFixture({
        link: { nodeId: 'node-1', kind: 'project', projectId: 'project-3', rest: ['pulls', '42'] },
        linkReady: ready,
      })
      rememberWorkspaceView('ws-2', { taskId: SECOND_TASK.id })
      setReady(true)
      const frame = await screen.until('opened the project')
      expect(frame).toContain('second > second-project')
      expect(currentPath()).toBe('/p/project-3')
      expect(selectedSource()).not.toBe('github')
      expect(activeTaskId()).toBeNull()
      screen.done()
    } finally {
      delete process.env.ACORN_FIXTURE_SECOND_WORKSPACE
      delete process.env.ACORN_FIXTURE_LINK_SCOPES
    }
  }, 30_000)

  it('keeps an available project source over a remembered task after focus settles', async () => {
    process.env.ACORN_FIXTURE_SECOND_WORKSPACE = '1'
    process.env.ACORN_FIXTURE_LINK_SCOPES = '1'
    const source = sourceRegistry.register({
      id: 'fixture.project', order: 4, glyph: 'link', label: 'Linked project',
      routes: [{ id: 'fixture.project.item', path: '/p/:projectId/fixture/:item', order: 4 }],
      component: () => <Line>{currentPath() === '/p/project-3/fixture/item-1' ? 'Linked project item' : 'Choose a project item'}</Line>,
    })
    try {
      const [ready, setReady] = createSignal(false)
      const screen = await renderFixture({
        link: { nodeId: 'node-1', kind: 'project', projectId: 'project-3', rest: ['fixture', 'item-1'] },
        linkReady: ready,
      })
      rememberWorkspaceView('ws-2', { taskId: SECOND_TASK.id })
      setReady(true)
      const frame = await screen.until('Linked project item')
      expect(frame).toContain('second > second-project')
      expect(currentPath()).toBe('/p/project-3/fixture/item-1')
      expect(selectedSource()).toBe('fixture.project')
      expect(activeTaskId()).toBeNull()
      screen.done()
    } finally {
      source.dispose()
      delete process.env.ACORN_FIXTURE_SECOND_WORKSPACE
      delete process.env.ACORN_FIXTURE_LINK_SCOPES
    }
  }, 30_000)

  it.each([
    { destinationLinked: true, expectedPath: '/p/project-3/fixture/item-1', expectedSource: 'fixture.provider' },
    { destinationLinked: false, expectedPath: '/p/project-3', expectedSource: 'docker' },
  ])('opens a claimed URL in the destination workspace (provider linked: $destinationLinked)', async ({ destinationLinked, expectedPath, expectedSource }) => {
    process.env.ACORN_FIXTURE_SECOND_WORKSPACE = '1'
    process.env.ACORN_FIXTURE_LINK_SCOPES = '1'
    if (destinationLinked) process.env.ACORN_FIXTURE_LINK_DESTINATION_PROVIDER = '1'
    let parsed = 0
    const source = sourceRegistry.register({
      id: 'fixture.provider', providerId: 'github', order: 4, glyph: 'link', label: 'Provider item',
      routes: [{ id: 'fixture.provider.item', path: '/p/:projectId/fixture/:item', order: 4 }],
      component: () => <Line>{currentPath() === '/p/project-3/fixture/item-1' ? 'Provider item content' : 'Choose a provider item'}</Line>,
    })
    const recogniser = contentLinkRegistry.register({
      id: 'fixture.provider', providerId: 'github',
      parse: (url) => { parsed += 1; return url === 'https://example.test/item-1' ? { kind: 'fixture.provider', item: 'item-1' } : null },
      path: () => '/p/project-3/fixture/item-1',
    })
    try {
      const [ready, setReady] = createSignal(false)
      const screen = await renderFixture({
        link: { nodeId: 'node-1', kind: 'open', url: 'https://example.test/item-1' },
        linkReady: ready,
      })
      rememberWorkspaceView('ws-2', { taskId: SECOND_TASK.id })
      setReady(true)
      const frame = await screen.until('second > second-project')
      expect(frame).toContain('second > second-project')
      expect(currentPath()).toBe(expectedPath)
      expect(selectedSource()).toBe(expectedSource)
      expect(activeTaskId()).toBeNull()
      expect(parsed).toBe(1)
      if (destinationLinked) expect(frame).toContain('Provider item content')
      else expect(frame).toContain('opened the project')
      screen.done()
    } finally {
      recogniser.dispose()
      source.dispose()
      delete process.env.ACORN_FIXTURE_LINK_DESTINATION_PROVIDER
      delete process.env.ACORN_FIXTURE_SECOND_WORKSPACE
      delete process.env.ACORN_FIXTURE_LINK_SCOPES
    }
  }, 30_000)
})

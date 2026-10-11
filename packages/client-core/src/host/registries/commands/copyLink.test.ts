import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseLink } from './addresses'
import { copyLink, projectPlaceFromPath, sourcePlaceFromPath, taskPlace } from './copyLink'
import { projectSurfaceRegistry } from '../panes/projectSurfaces'
import { paneRegistry } from '../panes/panes'
import { sourceRegistry } from '../sources/sources'
import type { Task } from '../../../infra/queries'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('../../../features/notifications/toast', () => ({ toast }))

describe('copy link', () => {
  const nodeId = 'a5290f29-1111-4222-8333-aabbccddeeff'
  const writeText = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    toast.mockClear()
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText } } })
  })

  it('round trips an encoded plugin path without changing its segments', async () => {
    const route = '/p/project%2Fone/x/example.plugin/items/a%25b/%E2%9C%93'
    const place = projectPlaceFromPath(route)
    expect(place).toEqual({
      kind: 'project',
      projectId: 'project/one',
      rest: ['x', 'example.plugin', 'items', 'a%b', '✓'],
    })
    await copyLink(nodeId, place!)
    expect(writeText).toHaveBeenCalledWith(`acorn://${nodeId}${route}`)
    expect(parseLink(writeText.mock.calls[0][0])).toEqual({ kind: 'address', address: { nodeId, ...place } })
    expect(toast).toHaveBeenCalledWith('Link copied', { tone: 'success' })
  })

  it('copies the explicit task row and pane item when supplied', async () => {
    await copyLink(nodeId, { kind: 'task', taskId: 'other-task', pane: 'notes', item: 'draft/one' })
    expect(parseLink(writeText.mock.calls[0][0])).toEqual({
      kind: 'address',
      address: { nodeId, kind: 'task', taskId: 'other-task', pane: 'notes', item: 'draft/one' },
    })
  })

  it('includes an item only when the focused pane reports one', () => {
    const task = { id: 'task-one' } as Task
    const pane = paneRegistry.register({
      id: 'notes',
      label: 'Notes',
      glyph: 'file',
      order: 1,
      component: () => null,
      selectedItem: () => 'draft/one',
    })
    try {
      expect(taskPlace(task, 'notes')).toEqual({ kind: 'task', taskId: 'task-one', pane: 'notes', item: 'draft/one' })
      expect(taskPlace(task, 'missing')).toEqual({ kind: 'task', taskId: 'task-one' })
    } finally {
      pane.dispose()
    }
  })

  it('keeps a loaded plugin route even when its source is not project-scoped', () => {
    const source = sourceRegistry.register({
      id: 'http-requests',
      label: 'API',
      glyph: 'send',
      order: 1,
      projectSurfaceId: 'http-project',
    })
    const surface = projectSurfaceRegistry.register({
      id: 'http-project',
      path: '/p/:projectId/x/http/requests/:requestId',
      item: 'requestId',
      order: 1,
      component: () => null,
    })
    try {
      expect(sourcePlaceFromPath('/p/project/x/http/requests/item%20one', 'http-requests', false)).toEqual({
        kind: 'project',
        projectId: 'project',
        rest: ['x', 'http', 'requests', 'item one'],
      })
      expect(sourcePlaceFromPath('/p/project/x/http/requests/item%20one', 'home', false)).toEqual({
        kind: 'source',
        sourceId: 'home',
      })
      expect(sourcePlaceFromPath('/p/project', 'home', false)).toEqual({ kind: 'source', sourceId: 'home' })
      expect(sourcePlaceFromPath('/p/project', 'github', true)).toEqual({
        kind: 'project',
        projectId: 'project',
        rest: [],
      })
    } finally {
      surface.dispose()
      source.dispose()
    }
  })

  it('does not claim success when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('Clipboard unavailable'))
    await copyLink(nodeId, { kind: 'source', sourceId: 'github' })
    expect(toast).toHaveBeenCalledWith('Could not copy link: Clipboard unavailable', { tone: 'danger' })
    expect(toast).not.toHaveBeenCalledWith('Link copied', expect.anything())
  })
})

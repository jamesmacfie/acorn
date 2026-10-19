import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginSourceDescriptor } from '@acorn/protocol/api.ts'
import { createFleetQuery } from '../../infra/node/fanout'

const readJson = vi.fn()
vi.mock('../../infra/node/apiClient', () => ({
  readJson: (...args: unknown[]) => readJson(...args),
  writeJson: vi.fn(),
}))
vi.mock('../../infra/node/fanout', () => ({ createFleetQuery: vi.fn(() => [() => ({ rows: [] }), {}]) }))
const params: { projectId?: string } = {}
vi.mock('@solidjs/router', () => ({ useParams: () => params }))
const [workspaceId, setWorkspaceId] = createSignal<string | undefined>()
vi.mock('../../features/workspaces/activeWorkspaceId', () => ({ createActiveWorkspaceId: () => workspaceId }))

const { createSourceItems } = await import('./sourceItems')

const descriptor = (scope: Partial<PluginSourceDescriptor>) =>
  ({ id: 'sessions', label: 'Sessions', order: 1, items: '/v1/p/board/items', ...scope }) as PluginSourceDescriptor

let dispose = () => {}
beforeEach(() => {
  readJson.mockReset()
  readJson.mockResolvedValue({ items: [{ id: 'a', title: 'A' }] })
  params.projectId = 'project-1'
  setWorkspaceId('ws-1')
})
afterEach(() => {
  dispose()
  vi.mocked(createFleetQuery).mockClear()
})

// What the hook hands the fan-out: the cache key and the route it reads for the current scope.
function mount(source: PluginSourceDescriptor) {
  dispose = render(() => {
    createSourceItems('board', source, 'node-1')
    return null
  }, document.createElement('div'))
  const [key, fetch, deps] = vi.mocked(createFleetQuery).mock.calls[0]!
  return {
    key: () => key(deps!()),
    read: async () => {
      readJson.mockClear()
      const rows = await fetch('node-1', deps!(), new AbortController().signal)
      return { path: readJson.mock.calls[0]?.[0], rows }
    },
  }
}

describe('a rail source’s rows', () => {
  it('reads the active workspace for a workspace-scoped source, one cache entry per workspace', async () => {
    const list = mount(descriptor({ workspaceScoped: true }))
    expect(list.key()).toEqual(['plugin-chrome', 'board', 'sessions', 'ws-1'])
    expect((await list.read()).path).toBe('/v1/p/board/items?workspace=ws-1')

    setWorkspaceId('ws-2')
    expect(list.key()).toEqual(['plugin-chrome', 'board', 'sessions', 'ws-2'])
    expect((await list.read()).path).toBe('/v1/p/board/items?workspace=ws-2')
  })

  it('calls no route while no workspace is known, so the source draws its empty state', async () => {
    setWorkspaceId(undefined)
    const list = mount(descriptor({ workspaceScoped: true }))
    expect(await list.read()).toEqual({ path: undefined, rows: [] })
  })

  it('reads the routed project for a project-scoped source', async () => {
    const list = mount(descriptor({ projectScoped: true }))
    expect(list.key()).toEqual(['plugin-chrome', 'board', 'sessions', 'project-1'])
    expect((await list.read()).path).toBe('/v1/p/board/items?project=project-1')
  })

  it('keeps one cache entry across workspaces for a source with no scope', async () => {
    const list = mount(descriptor({}))
    expect(list.key()).toEqual(['plugin-chrome', 'board', 'sessions'])
    setWorkspaceId('ws-2')
    expect(list.key()).toEqual(['plugin-chrome', 'board', 'sessions'])
    expect((await list.read()).path).toBe('/v1/p/board/items')
  })
})

import { expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  on: vi.fn(), evict: vi.fn(), evictAll: vi.fn(),
}))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => 'local', activeTaskId: () => null,
  clientEvents: { on: host.on }, previewViews: () => host,
  openPane: vi.fn(), writeJson: vi.fn(), clientCapabilityId: (id: string) => id,
}))
vi.mock('./configuredStore', () => ({ previewConfigured: () => true, previewConfiguredSchedule: {} }))
vi.mock('./paneContribution', () => ({ previewPaneContribution: {} }))

it('retires hidden previews on Node switches and owner removal, and one preview on archive', async () => {
  const { previewClientPlugin } = await import('./index')
  const register = vi.fn()
  previewClientPlugin.init({
    capabilities: { provide: vi.fn() }, panes: { register }, schedules: { register }, commands: { register },
  } as unknown as Parameters<typeof previewClientPlugin.init>[0])
  const listener = (event: string) => host.on.mock.calls.find(([kind]) => kind === event)![1]
  listener('runtime:node-switched')({ from: 'local', to: 'remote' })
  expect(host.evictAll).toHaveBeenCalledOnce()
  listener('runtime:node-removed')({ nodeId: 'other' })
  expect(host.evictAll).toHaveBeenCalledOnce()
  listener('runtime:node-removed')({ nodeId: 'local' })
  expect(host.evictAll).toHaveBeenCalledTimes(2)
  listener('runtime:task-archived')({ taskId: 'task-1' })
  expect(host.evict).toHaveBeenCalledWith('task-1')
})

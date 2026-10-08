import { createRoot, createSignal } from 'solid-js'
import { afterEach, expect, it, vi } from 'vitest'

const [nodeId, setNodeId] = createSignal<string | null>('node-a')
const [rows, setRows] = createSignal<{ id: string; observation: string }[]>([])
const subscriptions = {
  worktree: new Set<() => void>(),
  tasks: new Set<() => void>(),
  reconnect: new Set<() => void>(),
}
const invalidateQueries = vi.fn()
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ get data() { return { worktrees: rows() } } }),
  useQueryClient: () => ({ invalidateQueries }),
}))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: nodeId,
  nodeReady: () => true,
  wsOnNodeEvent: (_channel: string, cb: () => void) => { subscriptions.worktree.add(cb); return () => subscriptions.worktree.delete(cb) },
  wsOnReconnect: (cb: () => void) => { subscriptions.reconnect.add(cb); return () => subscriptions.reconnect.delete(cb) },
  clientEvents: { on: (_channel: string, cb: () => void) => { subscriptions.tasks.add(cb); return () => subscriptions.tasks.delete(cb) } },
}))

const { createGitPaneModel } = await import('./paneModel')
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
let dispose = () => {}
afterEach(() => {
  dispose()
  setNodeId('node-a')
  setRows([])
  invalidateQueries.mockClear()
})

it('keeps selection through observation changes and clears it only when its entry or Node leaves', async () => {
  setRows([{ id: 'stable', observation: 'first' }])
  const model = createRoot((stop) => { dispose = stop; return createGitPaneModel({ projectId: 'project' } as never) })
  model.setSelected('stable')
  setRows([{ id: 'stable', observation: 'new-head' }])
  await flush()
  expect(model.selected()).toBe('stable')
  setRows([{ id: 'different', observation: 'new-head' }])
  await flush()
  expect(model.selected()).toBeNull()
  model.setSelected('different')
  setNodeId('node-b')
  await flush()
  expect(model.selected()).toBeNull()
})

it('invalidates for worktree, local and remote task, and reconnect events for its lifetime', () => {
  createRoot((stop) => { dispose = stop; createGitPaneModel({ projectId: 'project' } as never) })
  for (const callbacks of Object.values(subscriptions)) for (const callback of callbacks) callback()
  expect(invalidateQueries).toHaveBeenCalledTimes(6)
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['git-worktrees', 'node-a', 'project'] })
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['git-history', 'node-a', 'project', null, 'message', ''] })
  dispose()
  expect(Object.values(subscriptions).every((callbacks) => callbacks.size === 0)).toBe(true)
})

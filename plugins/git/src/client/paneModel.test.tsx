import { createRoot, createSignal } from 'solid-js'
import { afterEach, expect, it, vi } from 'vitest'

const [nodeId, setNodeId] = createSignal<string | null>('node-a')
const [rows, setRows] = createSignal<{ id: string; observation: string }[]>([])
const [historyError, setHistoryError] = createSignal<{ code: string } | null>(null)
const subscriptions = {
  worktree: new Set<() => void>(),
  tasks: new Set<() => void>(),
  reconnect: new Set<() => void>(),
}
const invalidateQueries = vi.fn()
const consumePaneIntent = vi.fn((): unknown => undefined)
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: readonly unknown[] }) => ({
    get data() {
      return options().queryKey[0] === 'git-history'
        ? { commits: [], refs: [], nextCursor: null }
        : { worktrees: rows() }
    },
    get error() {
      return options().queryKey[0] === 'git-history' ? historyError() : null
    },
    isFetching: false,
  }),
  useQueryClient: () => ({ invalidateQueries }),
}))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  latestSignal: (await original<typeof import('@acorn/plugin-api/client')>()).latestSignal,
  onScopeEvicted: () => () => {},
  activeNodeId: nodeId,
  nodeReady: () => true,
  wsOnNodeEvent: (_channel: string, cb: () => void) => {
    subscriptions.worktree.add(cb)
    return () => subscriptions.worktree.delete(cb)
  },
  wsOnReconnect: (cb: () => void) => {
    subscriptions.reconnect.add(cb)
    return () => subscriptions.reconnect.delete(cb)
  },
  clientEvents: {
    on: (channel: string, cb: () => void) => {
      if (channel === 'presentation:pane-intent') return () => {}
      subscriptions.tasks.add(cb)
      return () => subscriptions.tasks.delete(cb)
    },
  },
  consumePaneIntent,
}))

const { createGitPaneModel } = await import('./paneModel')
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
let dispose = () => {}
afterEach(() => {
  dispose()
  setNodeId('node-a')
  setRows([])
  setHistoryError(null)
  invalidateQueries.mockClear()
})

it('retries a missing task branch on refresh and restores the task filter on Node change', async () => {
  const model = createRoot((stop) => {
    dispose = stop
    return createGitPaneModel({ id: 'task', projectId: 'project', branch: 'topic' } as never)
  })
  expect(model.history.ref()).toBe('refs/heads/topic')
  setHistoryError({ code: 'bad_ref' })
  await flush()
  expect(model.missingBranch()).toBe(true)
  expect(model.history.ref()).toBeNull()

  setHistoryError(null)
  model.refreshHistory()
  expect(model.missingBranch()).toBe(false)
  expect(model.history.ref()).toBe('refs/heads/topic')

  model.history.setRef(null)
  setNodeId('node-b')
  await flush()
  expect(model.history.ref()).toBe('refs/heads/topic')
  expect(model.missingBranch()).toBe(false)
})

it('keeps selection through observation changes and clears it only when its entry or Node leaves', async () => {
  setRows([{ id: 'stable', observation: 'first' }])
  const model = createRoot((stop) => {
    dispose = stop
    return createGitPaneModel({ projectId: 'project' } as never)
  })
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
  createRoot((stop) => {
    dispose = stop
    createGitPaneModel({ projectId: 'project' } as never)
  })
  for (const callbacks of Object.values(subscriptions)) for (const callback of callbacks) callback()
  expect(invalidateQueries).toHaveBeenCalledTimes(6)
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['git-worktrees', 'node-a', 'project'] })
  expect(invalidateQueries).toHaveBeenCalledWith({
    queryKey: ['git-history', 'node-a', 'project', null, 'message', ''],
  })
  dispose()
  expect(Object.values(subscriptions).every((callbacks) => callbacks.size === 0)).toBe(true)
})

it('opens on Changes, and on the tab another pane asked for before it mounted', () => {
  const first = createRoot((stop) => {
    dispose = stop
    return createGitPaneModel({ id: 'fresh', projectId: 'project' } as never)
  })
  expect(first.section()).toBe('changes')
  dispose()
  consumePaneIntent.mockReturnValueOnce({ kind: 'plugin:select', item: 'stashes' })
  const asked = createRoot((stop) => {
    dispose = stop
    return createGitPaneModel({ id: 'asked', projectId: 'project' } as never)
  })
  expect(consumePaneIntent).toHaveBeenLastCalledWith('asked', 'git')
  expect(asked.section()).toBe('stashes')
})

import { createRoot, createSignal } from 'solid-js'
import { afterEach, expect, it, vi } from 'vitest'
import type { HistoryPage } from '../shared/api'

const [nodeId, setNodeId] = createSignal<string | null>('node-a')
const firstPage = { commits: [{ id: 'first' }], nextCursor: 'next' } as unknown as HistoryPage
let finishPage: ((page: HistoryPage) => void) | undefined
let pendingSignal: AbortSignal | undefined
const invalidateQueries = vi.fn()
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: firstPage }),
  useQueryClient: () => ({ invalidateQueries }),
}))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: nodeId,
  wsOnNodeEvent: () => () => {},
  wsOnReconnect: () => () => {},
  clientEvents: { on: () => () => {} },
}))
vi.mock('./historyClient', () => ({
  historyKey: () => ['git-history'],
  historyOptions: () => ({ queryFn: ({ signal }: { signal: AbortSignal }) => {
    pendingSignal = signal
    return new Promise<HistoryPage>((resolve) => { finishPage = resolve })
  } }),
}))

const { createHistoryModel } = await import('./historyModel')
let dispose = () => {}
afterEach(() => { dispose(); setNodeId('node-a'); pendingSignal = undefined; finishPage = undefined; invalidateQueries.mockClear() })

it('aborts and discards a late continuation when its Node or filter changes', async () => {
  const model = createRoot((stop) => { dispose = stop; return createHistoryModel(() => 'project', () => null) })
  const first = model.loadMore()
  expect(pendingSignal?.aborted).toBe(false)
  setNodeId('node-b')
  expect(pendingSignal?.aborted).toBe(true)
  finishPage?.({ commits: [{ id: 'late' }], nextCursor: null } as unknown as HistoryPage)
  await first
  expect(model.commits().map((commit) => commit.id)).toEqual(['first'])

  const second = model.loadMore()
  model.setQuery('different')
  expect(pendingSignal?.aborted).toBe(true)
  finishPage?.({ commits: [{ id: 'late-filter' }], nextCursor: null } as unknown as HistoryPage)
  await second
  expect(model.commits().map((commit) => commit.id)).toEqual(['first'])
})

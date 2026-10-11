import { createRoot, createSignal } from 'solid-js'
import { afterEach, expect, it, vi } from 'vitest'
import type { HistoryPage } from '../shared/api'

const [nodeId, setNodeId] = createSignal<string | null>('node-a')
const firstPage = { commits: [{ id: 'first' }], nextCursor: 'next' } as unknown as HistoryPage
let finishPage: ((page: HistoryPage) => void) | undefined
let pendingSignal: AbortSignal | undefined
let nextRead: (() => Promise<HistoryPage>) | undefined
const invalidateQueries = vi.fn()
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: firstPage }),
  useQueryClient: () => ({ invalidateQueries }),
}))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  latestSignal: (await original<typeof import('@acorn/plugin-api/client')>()).latestSignal, onScopeEvicted: () => () => {},
  activeNodeId: nodeId,
  wsOnNodeEvent: () => () => {},
  wsOnReconnect: () => () => {},
  clientEvents: { on: () => () => {} },
}))
vi.mock('./historyClient', () => ({
  historyKey: () => ['git-history'],
  historyOptions: () => ({ queryFn: ({ signal }: { signal: AbortSignal }) => {
    pendingSignal = signal
    if (nextRead) {
      const read = nextRead
      nextRead = undefined
      return read()
    }
    return new Promise<HistoryPage>((resolve) => { finishPage = resolve })
  } }),
}))

const { createHistoryModel } = await import('./historyModel')
let dispose = () => {}
afterEach(() => { dispose(); setNodeId('node-a'); pendingSignal = undefined; finishPage = undefined; nextRead = undefined; invalidateQueries.mockClear() })

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

it('refresh clears a pending continuation and its error, then permits another load', async () => {
  const model = createRoot((stop) => { dispose = stop; return createHistoryModel(() => 'project', () => null) })
  nextRead = () => Promise.reject(new Error('offline'))
  await model.loadMore()
  expect(model.moreError()).toBe('offline')

  const staleRead = model.loadMore()
  expect(model.loadingMore()).toBe(true)
  const staleSignal = pendingSignal
  const finishStale = finishPage
  model.refresh()
  expect(staleSignal?.aborted).toBe(true)
  expect(model.loadingMore()).toBe(false)
  expect(model.moreError()).toBe('')
  finishStale?.({ commits: [{ id: 'stale' }], nextCursor: 'stale-next' } as unknown as HistoryPage)
  await staleRead
  expect(model.commits().map((commit) => commit.id)).toEqual(['first'])

  nextRead = () => Promise.resolve({ commits: [{ id: 'fresh' }], nextCursor: null } as unknown as HistoryPage)
  await model.loadMore()
  expect(model.commits().map((commit) => commit.id)).toEqual(['first', 'fresh'])
  expect(model.loadingMore()).toBe(false)
})

it('restores filters and loaded pages after leaving, with separate project and Node views', async () => {
  const [project, setProject] = createSignal('retained-project')
  const draw = () => createRoot((stop) => { dispose = stop; return createHistoryModel(project, () => null) })
  let model = draw()
  model.setField('author'); model.setQuery('Ada'); model.setRef('refs/heads/topic')
  nextRead = () => Promise.resolve({ commits: [{ id: 'second-page' }], nextCursor: 'third' } as unknown as HistoryPage)
  await model.loadMore()
  dispose()
  model = draw()
  expect(model.filter()).toEqual({ ref: 'refs/heads/topic', field: 'author', query: 'Ada' })
  expect(model.commits().map((commit) => commit.id)).toEqual(['first', 'second-page'])
  expect(model.next()).toBe('third')
  setProject('other-project')
  expect(model.query()).toBe('')
  expect(model.commits().map((commit) => commit.id)).toEqual(['first'])
  model.setQuery('Grace')
  setProject('retained-project')
  expect(model.query()).toBe('Ada')
  setNodeId('node-b')
  expect(model.query()).toBe('')
  setNodeId('node-a')
  expect(model.query()).toBe('Ada')
  expect(model.commits().map((commit) => commit.id)).toEqual(['first', 'second-page'])
})

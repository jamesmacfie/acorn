import { createSignal, Suspense } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import { historyRoute, inventoryRoute, type HistoryPage, type WorktreeInventory } from '../shared/api'
import type { GitTaskPaneModel } from './paneContribution'

// Every Git read waits until the test settles it, so a test can hold one tab's request open.
const reads: { url: string; settle: (value: unknown) => void }[] = []
const worktreeEvents = new Set<() => void>()
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => 'node', nodeReady: () => true, onScopeEvicted: () => () => {},
  featureUsable: vi.fn(), setSelectedSource: vi.fn(), consumePaneIntent: () => undefined,
  clientEvents: { on: () => () => {} }, wsOnReconnect: () => () => {},
  wsOnNodeEvent: (_channel: string, callback: () => void) => { worktreeEvents.add(callback); return () => worktreeEvents.delete(callback) },
  readJson: (url: string) => new Promise((settle) => { reads.push({ url, settle }) }),
}))
vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
vi.mock('./changes/ChangesPane', () => ({ ChangesList: () => <p>Changes ready</p> }))
vi.mock('./HistoryRows', () => ({ HistoryRows: (props: { model: { first: { data?: HistoryPage } } }) => <p>{props.model.first.data?.commits.length} commits</p> }))
vi.mock('./StashBrowse', () => ({}))
vi.mock('./RevisionView', () => ({}))
vi.mock('./OperationBanner', () => ({}))
vi.mock('./ConflictResolver', () => ({}))

const { createGitPaneModel } = await import('./paneModel')
const { GitPaneList } = await import('./TaskGitPane')
const task = { id: 'task', projectId: 'project', branch: null } as never
const inventory = { projectId: 'project', repository: '/repo', error: null, observedAt: 1,
  worktrees: [{ id: 'main', branch: 'main', path: '/repo', owners: [] }] } as unknown as WorktreeInventory
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const readsOf = (route: string) => reads.filter((read) => read.url.startsWith(route))
let dispose = () => {}
let host: HTMLDivElement | undefined
afterEach(() => { dispose(); host?.remove(); reads.length = 0 })

// The list region as the host mounts it: lazy, behind its own loading boundary, building the model.
function mount() {
  let model!: GitTaskPaneModel
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <QueryClientProvider client={client}>
    <Suspense fallback={<p>Loading Git…</p>}>{(() => {
      model = { ...createGitPaneModel(task, createSignal(true)[0]), changes: {} } as GitTaskPaneModel
      return <GitPaneList task={task} model={model} />
    })()}</Suspense>
  </QueryClientProvider>, host)
  return { model, text: () => host!.textContent ?? '' }
}

it('opens on Changes without reading other tabs, and keeps Changes usable while they load or fail', async () => {
  const { model, text } = mount()
  worktreeEvents.forEach((refresh) => refresh())
  await tick()
  expect(text()).toContain('Changes ready')
  expect(reads).toEqual([])

  model.setSection('worktrees')
  await tick()
  expect(readsOf(inventoryRoute('project'))).toHaveLength(1)
  expect(text()).toContain('Loading worktrees')
  model.setSection('history')
  await tick()
  expect(readsOf(historyRoute('project'))).toHaveLength(1)
  model.setSection('changes')
  await tick()
  expect(text()).toContain('Changes ready')
  expect(text()).not.toContain('Loading Git')

  readsOf(inventoryRoute('project'))[0]!.settle({ ...inventory, worktrees: [], error: 'Git unavailable' })
  await tick()
  expect(text()).toContain('Changes ready')
})

it('marks a hidden tab stale on Git events and refetches once when it opens, showing the cached rows', async () => {
  const { model, text } = mount()
  model.setSection('worktrees')
  await tick()
  readsOf(inventoryRoute('project'))[0]!.settle(inventory)
  await tick()
  expect(text()).toContain('main')

  model.setSection('changes')
  await tick()
  for (let event = 0; event < 3; event++) worktreeEvents.forEach((refresh) => refresh())
  await tick()
  expect(readsOf(inventoryRoute('project'))).toHaveLength(1)

  model.setSection('worktrees')
  await tick()
  expect(readsOf(inventoryRoute('project'))).toHaveLength(2)
  expect(text()).toContain('main')
})

import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router'
import { afterEach, expect, it, vi } from 'vitest'

const [node, setNode] = createSignal('browse-node')
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: node,
  onScopeEvicted: () => () => {},
  setSelectedSource: vi.fn(),
  wsOnNodeEvent: () => () => {},
  wsOnReconnect: () => () => {},
}))
vi.mock('@tanstack/solid-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('./historyModel', () => ({ createHistoryModel: () => ({ filter: () => ({ query: '' }) }) }))
vi.mock('./HistoryRows', () => ({ HistoryRows: () => <div>History rows</div> }))
vi.mock('./RevisionView', () => ({ RevisionView: () => <div>Revision detail</div> }))
vi.mock('./WorktreeBrowse', () => ({
  WorktreeList: () => <div>Worktree rows</div>,
  WorktreeDetail: () => <div>Worktree detail</div>,
}))
vi.mock('./StashBrowse', () => ({
  StashSourceList: () => <div>Stash rows</div>,
  StashSourceDetail: () => <div>Stash detail</div>,
}))
vi.mock('./RefBrowse', () => ({
  RefSourceList: () => <div>Ref rows</div>,
  RefSourceDetail: () => <div>Ref detail</div>,
}))
vi.mock('./RemoteBrowse', () => ({
  RemoteSourceList: () => <div>Remote rows</div>,
  RemoteSourceDetail: () => <div>Remote detail</div>,
}))
vi.mock('./CompareBrowse', () => ({
  CompareSourceList: () => <div>Compare rows</div>,
  CompareSourceDetail: () => <div>Compare detail</div>,
}))

const { GitSourceList, GitSourceDetail } = await import('./HistoryBrowse')
let dispose = () => {}
let host: HTMLDivElement | undefined
afterEach(() => {
  dispose()
  host?.remove()
  setNode('browse-node')
})
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

it('returns to the selected section and item with both scroll positions, without overriding a link', async () => {
  const history = createMemoryHistory()
  history.set({ value: '/p/first/x/git/refs/local%3Atopic' })
  const [visible, setVisible] = createSignal(true)
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <MemoryRouter
        history={history}
        root={(props) => (
          <>
            {props.children}
            <Show when={visible()}>
              <GitSourceList />
              <GitSourceDetail />
            </Show>
          </>
        )}
      >
        <Route path="/p/:projectId/*rest" component={() => null} />
      </MemoryRouter>
    ),
    host,
  )
  await tick()
  const panels = () => [...host!.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
  for (const [index, panel] of panels().entries()) {
    panel.scrollTop = (index + 1) * 120
    panel.dispatchEvent(new Event('scroll'))
  }
  setVisible(false)
  history.set({ value: '/p/first' })
  setVisible(true)
  await tick()
  await tick()
  expect(history.get()).toBe('/p/first/x/git/refs/local%3Atopic')
  expect(panels().map((panel) => panel.scrollTop)).toEqual([120, 240])
  history.set({ value: '/p/second' })
  await tick()
  await tick()
  expect(history.get()).toBe('/p/second/x/git/history')
  history.set({ value: '/p/first' })
  await tick()
  await tick()
  expect(history.get()).toBe('/p/first/x/git/refs/local%3Atopic')
  const tab = [...host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent === 'Remotes',
  )!
  tab.click()
  await tick()
  expect(history.get()).toBe('/p/first/x/git/remotes')
  const refs = [...host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent === 'Refs',
  )!
  refs.click()
  await tick()
  expect(history.get()).toBe('/p/first/x/git/refs/local%3Atopic')
  history.set({ value: '/p/first/x/git/remotes/origin' })
  await tick()
  expect(history.get()).toBe('/p/first/x/git/remotes/origin')
  setNode('other-browse-node')
  await tick()
  await tick()
  expect(history.get()).toBe('/p/first/x/git/history')
  setNode('browse-node')
  await tick()
  await tick()
  expect(history.get()).toBe('/p/first/x/git/remotes/origin')
})

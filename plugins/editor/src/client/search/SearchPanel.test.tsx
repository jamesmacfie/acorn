import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { SearchResult } from '../../shared/search'
import type { SearchOpts } from '../../shared/search'

const requests: {
  query: string
  task: string
  opts: SearchOpts
  signal: AbortSignal
  resolve: (result: SearchResult) => void
}[] = []
vi.mock('./searchClient', () => ({
  findInFiles: (task: string, query: string, opts: SearchOpts, options: { signal: AbortSignal }) =>
    new Promise<SearchResult>((resolve) => {
      requests.push({ task, query, opts, signal: options.signal, resolve })
    }),
}))
const { default: SearchPanel } = await import('./SearchPanel')
const { taskSearchState, updateTaskSearchState } = await import('./searchState')
let dispose: (() => void) | undefined
let host: HTMLElement
const result = (path: string): SearchResult => ({
  files: [{ path, hits: [{ line: 1, col: 1, endCol: 2, preview: 'x' }] }],
  truncated: false,
})
const input = (value: string) => {
  const element = host.querySelector('input')!
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
afterEach(() => {
  dispose?.()
  host?.remove()
  requests.length = 0
})

it('aborts replacement searches, fences stale completion, and retains a hidden request', async () => {
  const [active, setActive] = createSignal(true)
  const [task, setTask] = createSignal('first-task')
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <SearchPanel taskId={task()} active={active()} />
      </QueryClientProvider>
    ),
    host,
  )
  input('first')
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  input('second')
  expect(requests[0].signal.aborted).toBe(true)
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  setActive(false)
  expect(requests[1].signal.aborted).toBe(false)
  requests[1].resolve(result('second.ts'))
  await vi.waitFor(() => expect(host.textContent).toContain('second.ts'))
  requests[0].resolve(result('stale.ts'))
  await Promise.resolve()
  expect(host.textContent).not.toContain('stale.ts')
  setTask('next-task')
  expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('')
  input('next')
  await vi.waitFor(() => expect(requests).toHaveLength(3))
  expect(requests[2].task).toBe('next-task')
  dispose()
  dispose = undefined
  expect(requests[2].signal.aborted).toBe(true)
})

it('cancels a pending debounce on disposal', async () => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <SearchPanel taskId="task" active />
      </QueryClientProvider>
    ),
    host,
  )
  input('pending')
  dispose()
  dispose = undefined
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(requests).toHaveLength(0)
})

it('retains the task query, folder, filters, and results after remount', async () => {
  const task = 'retained-search-test'
  updateTaskSearchState(task, (state) => ({
    ...state,
    opts: { folder: 'src', include: ['*.tsx'] },
    includeText: '*.tsx',
  }))
  host = document.createElement('div')
  document.body.append(host)
  const mount = () =>
    render(
      () => (
        <QueryClientProvider client={new QueryClient()}>
          <SearchPanel taskId={task} active />
        </QueryClientProvider>
      ),
      host,
    )
  dispose = mount()
  input('needle')
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  requests[0].resolve(result('src/good.tsx'))
  await vi.waitFor(() => expect(host.textContent).toContain('src/good.tsx'))
  dispose()
  host.replaceChildren()
  dispose = mount()
  expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('needle')
  expect(host.textContent).toContain('src')
  expect(host.textContent).toContain('src/good.tsx')
})

it('restores the result viewport when search remounts', async () => {
  const task = 'reading-place-test'
  updateTaskSearchState(task, (state) => ({ ...state, query: 'needle', results: result('src/far.ts') }))
  host = document.createElement('div')
  document.body.append(host)
  const mount = () =>
    render(
      () => (
        <QueryClientProvider client={new QueryClient()}>
          <SearchPanel taskId={task} active />
        </QueryClientProvider>
      ),
      host,
    )
  dispose = mount()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  const viewport = host.querySelector<HTMLElement>('.ui-tab-panel')!
  viewport.scrollTop = 321
  viewport.dispatchEvent(new Event('scroll'))
  expect(taskSearchState(task).scrollOffset).toBe(321)
  dispose()
  host.replaceChildren()
  dispose = mount()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  expect(host.querySelector<HTMLElement>('.ui-tab-panel')?.scrollTop).toBe(321)
  expect(host.textContent).toContain('src/far.ts')
})

it('keeps the result viewport when the hidden panel resets its DOM scroll', async () => {
  const task = 'hidden-reading-place-test'
  updateTaskSearchState(task, (state) => ({ ...state, query: 'needle', results: result('src/far.ts') }))
  const [active, setActive] = createSignal(true)
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <SearchPanel taskId={task} active={active()} />
      </QueryClientProvider>
    ),
    host,
  )
  await new Promise((resolve) => requestAnimationFrame(resolve))
  const viewport = host.querySelector<HTMLElement>('.ui-tab-panel')!
  viewport.scrollTop = 321
  setActive(false)
  viewport.scrollTop = 0
  viewport.dispatchEvent(new Event('scroll'))
  expect(taskSearchState(task).scrollOffset).toBe(321)
  setActive(true)
  await new Promise((resolve) => requestAnimationFrame(resolve))
  expect(viewport.scrollTop).toBe(321)
})

it('aborts work when scope or filters change and ignores late results', async () => {
  const task = 'scoped-search-test'
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <SearchPanel taskId={task} active />
      </QueryClientProvider>
    ),
    host,
  )
  input('needle')
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  updateTaskSearchState(task, (state) => ({ ...state, opts: { ...state.opts, folder: 'src' }, results: undefined }))
  expect(requests[0].signal.aborted).toBe(true)
  expect(requests).toHaveLength(1)
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  expect(requests[1].opts.folder).toBe('src')
  const details = [...host.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === 'Search details',
  )!
  details.click()
  const include = host.querySelectorAll<HTMLInputElement>('input')[1]
  include.value = '*.tsx'
  include.dispatchEvent(new Event('input', { bubbles: true }))
  expect(requests[1].signal.aborted).toBe(true)
  await vi.waitFor(() => expect(requests).toHaveLength(3))
  requests[0].resolve(result('wrong.ts'))
  requests[1].resolve(result('also-wrong.ts'))
  requests[2].resolve(result('src/right.ts'))
  await vi.waitFor(() => expect(host.textContent).toContain('src/right.ts'))
  expect(host.textContent).not.toContain('wrong.ts')
  include.value = 'x'.repeat(257)
  include.dispatchEvent(new Event('input', { bubbles: true }))
  await vi.waitFor(() => expect(host.textContent).toContain('Each pattern must be at most 256 characters.'))
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(requests).toHaveLength(3)
})

it('debounces clearing a folder scope and sends the task root after aborting', async () => {
  const task = 'scope-clear-test'
  updateTaskSearchState(task, (state) => ({ ...state, opts: { folder: 'src' } }))
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <SearchPanel taskId={task} active />
      </QueryClientProvider>
    ),
    host,
  )
  input('needle')
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  const clear = [...host.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === 'Clear folder scope',
  )!
  clear.click()
  expect(requests[0].signal.aborted).toBe(true)
  expect(requests).toHaveLength(1)
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  expect(requests[1].opts.folder).toBeUndefined()
})

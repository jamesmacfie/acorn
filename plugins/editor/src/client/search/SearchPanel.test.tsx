import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { SearchResult } from '../../shared/search'

const requests: { query: string; task: string; signal: AbortSignal; resolve: (result: SearchResult) => void }[] = []
vi.mock('./searchClient', () => ({
  findInFiles: (task: string, query: string, _opts: unknown, options: { signal: AbortSignal }) =>
    new Promise<SearchResult>((resolve) => { requests.push({ task, query, signal: options.signal, resolve }) }),
}))
const { default: SearchPanel } = await import('./SearchPanel')
let dispose: (() => void) | undefined
let host: HTMLElement
const result = (path: string): SearchResult => ({ files: [{ path, hits: [{ line: 1, col: 1, endCol: 2, preview: 'x' }] }], truncated: false })
const input = (value: string) => {
  const element = host.querySelector('input')!
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
afterEach(() => { dispose?.(); host?.remove(); requests.length = 0 })

it('aborts replacement searches, fences stale completion, and retains a hidden request', async () => {
  const [active, setActive] = createSignal(true)
  const [task, setTask] = createSignal('first-task')
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <QueryClientProvider client={new QueryClient()}><SearchPanel taskId={task()} active={active()} /></QueryClientProvider>, host)
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
  await vi.waitFor(() => expect(requests).toHaveLength(3))
  expect(requests[2].task).toBe('next-task')
  dispose(); dispose = undefined
  expect(requests[2].signal.aborted).toBe(true)
})

it('cancels a pending debounce on disposal', async () => {
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <QueryClientProvider client={new QueryClient()}><SearchPanel taskId="task" active /></QueryClientProvider>, host)
  input('pending')
  dispose(); dispose = undefined
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(requests).toHaveLength(0)
})

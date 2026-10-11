import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PluginRailItem, PluginSourceDescriptor } from '@acorn/protocol/api.ts'

const readJson = vi.fn()
vi.mock('../../infra/node/apiClient', () => ({
  readJson: (...args: unknown[]) => readJson(...args),
  writeJson: vi.fn(),
}))

const { createSourceSearch } = await import('./sourceSearch')
type Search = ReturnType<typeof createSourceSearch>

const loaded: PluginRailItem[] = [
  { id: 'a:1', title: 'Login crash' },
  { id: 'a:2', title: 'Slow page' },
]
const descriptor = (search?: string) =>
  ({
    id: 'issues',
    label: 'Issues',
    order: 1,
    items: '/v1/p/board/items',
    ...(search ? { search } : {}),
  }) as PluginSourceDescriptor

let dispose = () => {}
beforeEach(() => {
  vi.useFakeTimers()
  readJson.mockReset()
})
afterEach(() => {
  dispose()
  vi.useRealTimers()
})

function mount(source: PluginSourceDescriptor) {
  const [text, setText] = createSignal('')
  const [projectId, setProjectId] = createSignal<string | undefined>('project-1')
  let search!: Search
  const client = new QueryClient()
  // A component body, which is untracked, as the real hosts' are.
  const Probe = () => {
    search = createSourceSearch({
      pluginId: 'board',
      nodeId: 'node-1',
      descriptor: () => source,
      projectId,
      text,
      loaded: () => loaded,
    })
    return null
  }
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ),
    document.body.appendChild(document.createElement('div')),
  )
  return { search, setText, setProjectId }
}

const settle = () => vi.advanceTimersByTimeAsync(300)

it('narrows the loaded rows at once, then adds the provider rows after them', async () => {
  let answer!: (value: unknown) => void
  readJson.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve
    }),
  )
  const { search, setText } = mount(descriptor('/v1/p/board/search'))

  setText('crash')
  expect(search.status()).toBe('searching')
  expect(search.items().map((item) => item.id)).toEqual(['a:1'])

  await settle()
  expect(readJson).toHaveBeenCalledTimes(1)
  expect(readJson.mock.calls[0][0]).toBe('/v1/p/board/search?project=project-1&q=crash')
  answer({
    items: [
      { id: 'a:1', title: 'Login crash' },
      { id: 'a:900', title: 'Crash on login' },
    ],
    incomplete: true,
  })
  await settle()
  expect(search.status()).toBe('done')
  expect(search.items().map((item) => item.id)).toEqual(['a:1', 'a:900'])
  expect(search.incomplete()).toBe(true)

  setText('')
  expect(search.status()).toBe('idle')
  expect(search.items()).toBe(loaded)
})

it('asks once for the settled text, not per keystroke', async () => {
  readJson.mockResolvedValue({ items: [] })
  const { setText } = mount(descriptor('/v1/p/board/search'))
  setText('cr')
  await vi.advanceTimersByTimeAsync(100)
  setText('cra')
  await vi.advanceTimersByTimeAsync(100)
  setText('crash')
  await settle()
  expect(readJson).toHaveBeenCalledTimes(1)
  expect(readJson.mock.calls[0][0]).toContain('q=crash')
})

it('keeps the local matches when the provider fails', async () => {
  readJson.mockRejectedValueOnce(new Error('offline'))
  const { search, setText } = mount(descriptor('/v1/p/board/search'))
  setText('slow')
  await settle()
  expect(search.status()).toBe('failed')
  expect(search.items().map((item) => item.id)).toEqual(['a:2'])
})

it("never draws an earlier project's answer for a new one", async () => {
  readJson.mockResolvedValueOnce({ items: [{ id: 'a:900', title: 'Old project' }] })
  let answer!: (value: unknown) => void
  readJson.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve
    }),
  )
  const { search, setText, setProjectId } = mount(descriptor('/v1/p/board/search'))
  setText('crash')
  await settle()
  expect(search.items().map((item) => item.id)).toEqual(['a:1', 'a:900'])

  setProjectId('project-2')
  await settle()
  expect(search.status()).toBe('searching')
  expect(search.items().map((item) => item.id)).toEqual(['a:1'])
  // An empty answer never hides a loaded row that matches, since the provider matches differently.
  answer({ items: [] })
  await settle()
  expect(search.status()).toBe('done')
  expect(search.items().map((item) => item.id)).toEqual(['a:1'])
})

it('searches only the loaded rows for a source with no search route or a one-letter query', async () => {
  const withoutRoute = mount(descriptor())
  withoutRoute.setText('crash')
  await settle()
  expect(withoutRoute.search.status()).toBe('local')
  dispose()

  const withRoute = mount(descriptor('/v1/p/board/search'))
  withRoute.setText('c')
  await settle()
  expect(withRoute.search.status()).toBe('local')
  expect(readJson).not.toHaveBeenCalled()
})

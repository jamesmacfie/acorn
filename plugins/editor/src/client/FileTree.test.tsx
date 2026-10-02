import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorEntry } from './editorClient'
import { evictEditorTreeState, setEditorTreeDirectoryOpen } from './editorTreeState'

Element.prototype.scrollIntoView ??= () => {}

const listing = vi.fn(async (_taskId: string, path: string): Promise<EditorEntry[]> => {
  if (path === '') return [{ name: 'src', dir: true }]
  if (path === 'src') return [{ name: 'nested', dir: true }, { name: 'app.ts', dir: false }]
  if (path === 'src/nested') return [{ name: 'model.ts', dir: false }]
  return []
})

vi.mock('./editorClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./editorClient')>()),
  editorApi: () => ({ list: listing }),
}))

const { default: FileTree } = await import('./FileTree')

let dispose: (() => void) | undefined
let host: HTMLElement
const taskId = 'file-tree-test'

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  listing.mockClear()
  evictEditorTreeState(taskId)
})

const mount = (onOpen = vi.fn(), options?: { task?: () => string; reveal?: () => { path: string; revision: number } | null; onRevealed?: (revision: number) => void }) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => (
    <QueryClientProvider client={new QueryClient()}><FileTree
      taskId={options?.task?.() ?? taskId}
      openPath={null}
      reveal={options?.reveal?.() ?? null}
      onOpen={onOpen}
      onRevealed={options?.onRevealed ?? (() => {})}
    /></QueryClientProvider>
  ), host)
  return onOpen
}

describe('the editor file tree', () => {
  it('reloads retained expanded branches when the tree mounts again', async () => {
    setEditorTreeDirectoryOpen(taskId, 'src', true)
    setEditorTreeDirectoryOpen(taskId, 'src/nested', true)
    mount()

    await vi.waitFor(() => expect(host.textContent).toContain('model.ts'))
    expect(listing.mock.calls.map(([, path]) => path)).toEqual(['', 'src', 'src/nested'])
    expect(host.querySelector<HTMLElement>('[title="src"] [aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector<HTMLElement>('[title="src/nested"] [aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens a file as a preview on one click and keeps it on double-click', async () => {
    setEditorTreeDirectoryOpen(taskId, 'src', true)
    const onOpen = mount()
    const file = await vi.waitFor(() => {
      const row = host.querySelector<HTMLElement>('[title="src/app.ts"]')
      if (!row) throw new Error('file row not loaded')
      return row
    })

    file.click()
    expect(onOpen).toHaveBeenLastCalledWith('src/app.ts', true)

    file.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(onOpen).toHaveBeenLastCalledWith('src/app.ts', false)
  })
})

it('keeps a successful listing on refresh failure and retries from its error state', async () => {
  listing.mockResolvedValueOnce([{ name: 'retained.ts', dir: false }])
  mount()
  await vi.waitFor(() => expect(host.textContent).toContain('retained.ts'))
  listing.mockRejectedValueOnce(new Error('Temporary listing failure'))
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(host.textContent).toContain('Temporary listing failure'))
  expect(host.textContent).toContain('retained.ts')
  listing.mockResolvedValueOnce([{ name: 'fresh.ts', dir: false }])
  const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!
  retry.click()
  await vi.waitFor(() => expect(host.textContent).toContain('fresh.ts'))
  expect(host.textContent).not.toContain('Temporary listing failure')
})

it('rejects an old task listing without clearing the replacement read', async () => {
  let rejectOld!: (error: Error) => void
  let completeNew!: (entries: EditorEntry[]) => void
  listing.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject }))
  listing.mockImplementationOnce(() => new Promise((resolve) => { completeNew = resolve }))
  const [task, setTask] = createSignal(taskId)
  mount(vi.fn(), { task })
  await vi.waitFor(() => expect(rejectOld).toBeDefined())
  setTask('replacement-task')
  await vi.waitFor(() => expect(completeNew).toBeDefined())
  rejectOld(new Error('Obsolete failure'))
  completeNew([{ name: 'replacement.ts', dir: false }])
  await vi.waitFor(() => expect(host.textContent).toContain('replacement.ts'))
  expect(host.textContent).not.toContain('Obsolete failure')
})

it('stops a superseded reveal before opening its next directory or acknowledging it', async () => {
  let completeOld!: (entries: EditorEntry[]) => void
  listing.mockImplementation(async (_task, dir) => {
    if (!dir) return [{ name: 'one', dir: true }, { name: 'two', dir: true }]
    if (dir === 'one') return new Promise((resolve) => { completeOld = resolve })
    if (dir === 'two') return [{ name: 'goal.ts', dir: false }]
    return []
  })
  const [reveal, setReveal] = createSignal<{ path: string; revision: number } | null>(null)
  const onRevealed = vi.fn()
  mount(vi.fn(), { reveal, onRevealed })
  await vi.waitFor(() => expect(host.textContent).toContain('one'))
  setReveal({ path: 'one/nested/obsolete.ts', revision: 1 })
  await vi.waitFor(() => expect(completeOld).toBeDefined())
  setReveal({ path: 'two/goal.ts', revision: 2 })
  await vi.waitFor(() => expect(onRevealed).toHaveBeenCalledWith(2))
  completeOld([{ name: 'nested', dir: true }])
  await Promise.resolve(); await Promise.resolve()
  expect(listing.mock.calls.some(([, path]) => path === 'one/nested')).toBe(false)
  expect(onRevealed).toHaveBeenCalledTimes(1)
})

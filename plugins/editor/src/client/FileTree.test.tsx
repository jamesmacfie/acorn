import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorEntry } from './editorClient'
import type { createFileActionModel } from './fileActionModel'
import { evictEditorTreeState, setEditorTreeDirectoryOpen } from './editorTreeState'
import { projectFileStatus } from './fileStatusModel'
import type { FileStatusProjection } from './fileStatusModel'
import { prefsKey } from '@acorn/protocol/api.ts'
import { saveEditorShowIgnored } from './editorPrefs'

Element.prototype.scrollIntoView ??= () => {}

const defaultListing = async (_taskId: string, path: string): Promise<EditorEntry[]> => {
  if (path === '') return [{ name: 'src', dir: true }]
  if (path === 'src') return [{ name: 'nested', dir: true }, { name: 'app.ts', dir: false }]
  if (path === 'src/nested') return [{ name: 'model.ts', dir: false }]
  return []
}
const listing = vi.fn(defaultListing)
const ignored = vi.fn(async (_task: string, _dir: string, _names: string[]) => ({ available: true as const, ignored: [] as string[] }))

vi.mock('./editorClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./editorClient')>()),
  editorApi: () => ({ list: listing, ignored, entry: async (_taskId: string, path: string) => ({ root: '/test', path, kind: 'folder', identity: path || 'root', entryId: path || 'root' }),
    trashAvailability: async () => ({ available: false, reason: 'Unsupported in this test.' }), renameAvailability: async () => ({ available: true }) }),
}))

const { default: FileTree } = await import('./FileTree')

let dispose: (() => void) | undefined
let host: HTMLElement
const taskId = 'file-tree-test'
const actions = { arm: vi.fn(), create: vi.fn(), rename: vi.fn(), trash: vi.fn() } as unknown as ReturnType<typeof createFileActionModel>

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  listing.mockReset().mockImplementation(defaultListing)
  ignored.mockReset().mockResolvedValue({ available: true, ignored: [] })
  vi.mocked(actions.arm).mockReset()
  vi.mocked(actions.create).mockReset()
  vi.mocked(actions.rename).mockReset()
  evictEditorTreeState(taskId)
  localStorage.clear()
})

it('renames the focused tree target with F2 without opening its file', async () => {
  listing.mockResolvedValueOnce([{ name: 'draft.txt', dir: false, kind: 'file', identity: 'seen', entryId: 'seen', root: '/work' }])
  const release = vi.fn()
  vi.mocked(actions.arm).mockImplementation((target) => ({ target, ready: Promise.resolve(), release, hold: () => () => {}, block: () => {}, dirty: () => [], custodies: new Map(), sourceCustodies: () => new Map(), savedRevisions: new Map(), tabs: { files: [], active: null } }))
  vi.mocked(actions.rename).mockResolvedValue('renamed.txt')
  const onOpen = mount()
  const row = await vi.waitFor(() => {
    const element = host.querySelector<HTMLElement>('[title="draft.txt"]')
    if (!element) throw new Error('row not loaded')
    return element
  })
  row.focus()
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
  const input = await vi.waitFor(() => {
    const element = row.querySelector<HTMLInputElement>('input')
    if (!element) throw new Error('inline rename not open')
    return element
  })
  input.value = 'renamed.txt'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() => expect(actions.rename).toHaveBeenCalledWith(expect.objectContaining({ target: {
    root: '/work', path: 'draft.txt', kind: 'file', identity: 'seen', entryId: 'seen',
  } }), 'renamed.txt'))
  expect(onOpen).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
})

it('keeps the armed action through Enter, Escape, and a delayed Node response', async () => {
  listing.mockResolvedValueOnce([{ name: 'draft.txt', dir: false, kind: 'file', identity: 'seen', entryId: 'inode', root: '/work' }])
  const release = vi.fn()
  const end = vi.fn()
  vi.mocked(actions.arm).mockImplementation((target) => ({ target, ready: Promise.resolve(), release, hold: () => end, block: () => {}, dirty: () => [], custodies: new Map(), sourceCustodies: () => new Map(), savedRevisions: new Map(), tabs: { files: [], active: null } }))
  let complete!: (path: string) => void
  vi.mocked(actions.rename).mockImplementation(() => new Promise((resolve) => { complete = resolve }))
  mount()
  const row = await vi.waitFor(() => {
    const element = host.querySelector<HTMLElement>('[title="draft.txt"]')
    if (!element) throw new Error('row not loaded')
    return element
  })
  row.focus()
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
  const input = await vi.waitFor(() => {
    const element = row.querySelector<HTMLInputElement>('input')
    if (!element) throw new Error('inline rename not open')
    return element
  })
  input.value = 'renamed.txt'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() => expect(actions.rename).toHaveBeenCalledOnce())
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(row.querySelector('input')).toBe(input)
  expect(release).not.toHaveBeenCalled()
  expect(end).not.toHaveBeenCalled()
  complete('renamed.txt')
  await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  expect(end).toHaveBeenCalledOnce()
})

it('keeps the captured root target and uses an explicit destination folder', async () => {
  const release = vi.fn()
  vi.mocked(actions.arm).mockImplementation((target) => ({ target, ready: Promise.resolve(), release, hold: () => () => {}, block: () => {}, dirty: () => [], custodies: new Map(), sourceCustodies: () => new Map(), savedRevisions: new Map(), tabs: { files: [], active: null } }))
  vi.mocked(actions.create).mockResolvedValue('src/new.txt')
  mount()
  const trigger = await vi.waitFor(() => {
    const element = [...host.querySelectorAll('button')].find((button) => button.textContent === 'New…')
    if (!element) throw new Error('root action not loaded')
    return element
  })
  trigger.click()
  const item = await vi.waitFor(() => {
    const element = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((button) => button.textContent === 'New file…')
    if (!element) throw new Error('new file item not open')
    return element
  })
  item.click()
  const dialog = await vi.waitFor(() => {
    const element = document.querySelector<HTMLElement>('[role="dialog"]')
    if (!element) throw new Error('create dialog not open')
    return element
  })
  expect(release).not.toHaveBeenCalled()
  const [name, folder] = [...dialog.querySelectorAll('input')]
  for (const [input, value] of [[name, 'new.txt'], [folder, 'src']] as const) {
    input!.value = value
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const confirm = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Confirm')!
  confirm.click()
  await vi.waitFor(() => expect(actions.create).toHaveBeenCalledWith({ root: '/test', path: 'src', kind: 'folder', identity: 'src', entryId: 'src' }, 'new.txt', 'file'))
})

const mount = (onOpen = vi.fn(), options?: { task?: () => string; reveal?: () => { path: string; revision: number } | null; onRevealed?: (revision: number) => void; fileStatus?: FileStatusProjection; openPath?: () => string | null; hideIgnored?: boolean }) => {
  host = document.createElement('div')
  document.body.append(host)
  const queryClient = new QueryClient()
  if (options?.hideIgnored) {
    queryClient.setQueryData(prefsKey, { editor_show_ignored: '0' })
    void saveEditorShowIgnored(queryClient, false)
  }
  dispose = render(() => (
    <QueryClientProvider client={queryClient}><FileTree
      taskId={options?.task?.() ?? taskId}
      fileStatus={() => options?.fileStatus ?? { files: new Map(), folders: new Map() }}
      statusStale={() => false}
      onStatusChanged={() => {}}
      openPath={options?.openPath?.() ?? null}
      reveal={options?.reveal?.() ?? null}
      onOpen={onOpen}
      onRevealed={options?.onRevealed ?? (() => {})}
      onRevealActive={() => {}}
      actions={actions}
    /></QueryClientProvider>
  ), host)
  return onOpen
}

describe('the editor file tree', () => {
  it('hides ignored rows, temporarily reveals an ignored active path, and clears it on file change', async () => {
    listing.mockImplementation(async (_task, dir) => dir === ''
      ? [{ name: 'build', dir: true }, { name: 'source.ts', dir: false }]
      : [{ name: 'output.ts', dir: false }])
    ignored.mockImplementation(async (_task, dir) => ({ available: true, ignored: dir ? ['output.ts'] : ['build'] }))
    const [reveal, setReveal] = createSignal<{ path: string; revision: number } | null>(null)
    const [openPath, setOpenPath] = createSignal<string | null>('build/output.ts')
    mount(vi.fn(), { hideIgnored: true, reveal, openPath })
    await vi.waitFor(() => expect(host.textContent).toContain('source.ts'))
    expect([...host.querySelectorAll('button')].find((button) => button.textContent === 'Show ignored files')?.getAttribute('aria-pressed')).toBe('false')
    expect(ignored).toHaveBeenCalled()
    await vi.waitFor(() => expect(host.textContent).not.toContain('build'))
    expect(host.textContent).not.toContain('output.ts')
    setReveal({ path: 'build/output.ts', revision: 1 })
    await vi.waitFor(() => expect(host.textContent).toContain('output.ts'))
    setOpenPath('source.ts')
    await vi.waitFor(() => expect(host.textContent).not.toContain('output.ts'))
  })

  it('keeps a listing usable when Git ignore metadata fails', async () => {
    ignored.mockRejectedValue(new Error('Git unavailable'))
    mount()
    await vi.waitFor(() => expect(host.textContent).toContain('src'))
    await vi.waitFor(() => expect(host.textContent).toContain('Ignore filtering unavailable'))
    expect(host.textContent).toContain('Git unavailable')
  })

  it('shows a refreshed listing while its replacement ignore metadata is pending', async () => {
    listing.mockImplementation(async () => [{ name: 'build', dir: true }])
    let finishIgnore!: (result: { available: true; ignored: string[] }) => void
    ignored.mockResolvedValueOnce({ available: true, ignored: ['build'] })
      .mockImplementationOnce(() => new Promise((resolve) => { finishIgnore = resolve }))
    mount(vi.fn(), { hideIgnored: true })
    await vi.waitFor(() => expect(ignored).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(host.textContent).not.toContain('build'))
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(ignored).toHaveBeenCalledTimes(2))
    expect(host.textContent).toContain('build')
    finishIgnore({ available: true, ignored: [] })
    await vi.waitFor(() => expect(host.querySelector('[title="build"]')).not.toBeNull())
  })

  it('keeps a large listing virtual and shows a status badge without opening the file', async () => {
    listing.mockResolvedValueOnce(Array.from({ length: 10_000 }, (_, index) => ({ name: `${index}.txt`, dir: false })))
    const status = projectFileStatus({ kind: 'ready', changes: [{ path: '0.txt', status: 'untracked', staged: false }] })
    const onOpen = mount(vi.fn(), { fileStatus: status })
    await vi.waitFor(() => expect(host.querySelector('[title^="0.txt"]')).not.toBeNull())
    expect(host.querySelectorAll('[role="treeitem"]').length).toBeLessThan(100)
    expect(host.textContent).toContain('?')
    expect(onOpen).not.toHaveBeenCalled()
  })

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

it('does not finish a cached-listing reveal after Collapse all', async () => {
  setEditorTreeDirectoryOpen(taskId, 'src', true)
  const [reveal, setReveal] = createSignal<{ path: string; revision: number } | null>(null)
  const onRevealed = vi.fn()
  mount(vi.fn(), { reveal, onRevealed })
  await vi.waitFor(() => expect(host.textContent).toContain('app.ts'))
  setReveal({ path: 'src/app.ts', revision: 1 })
  const collapse = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Collapse all folders')!
  collapse.click()
  await Promise.resolve(); await Promise.resolve()
  expect(onRevealed).not.toHaveBeenCalled()
  expect(host.textContent).not.toContain('app.ts')
})

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
import { registerContextMenuItems } from '@acorn/plugin-api/client'
import { extensionPointRegistry, extensionRegistry, setActiveNode, type ExtensionContribution } from '@acorn/plugin-api/testkit/client'
import { EDITOR_FILE_KEY, EDITOR_FILE_POINT, MAX_EDITOR_FILE_MARKS, type EditorFileAnnotationKey } from '../contract/fileAnnotations'

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
    const element = [...host.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'New file or folder')
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
  expect(dialog.textContent).toContain('Create file')
  expect(dialog.textContent).toContain('File name')
  expect(dialog.textContent).toContain('Destination folder (optional)')
  expect(dialog.textContent).toContain('Leave blank to create in the root.')
  const [name, folder] = [...dialog.querySelectorAll('input')]
  for (const [input, value] of [[name, 'new.txt'], [folder, 'src']] as const) {
    input!.value = value
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const confirm = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Create file')!
  confirm.click()
  await vi.waitFor(() => expect(actions.create).toHaveBeenCalledWith({ root: '/test', path: 'src', kind: 'folder', identity: 'src', entryId: 'src' }, 'new.txt', 'file'))
})

const mount = (onOpen = vi.fn(), options?: { task?: () => string; reveal?: () => { path: string; revision: number } | null; onRevealed?: (revision: number) => void; fileStatus?: FileStatusProjection; openPath?: () => string | null; hideIgnored?: boolean; onVisibleFiles?: (paths: readonly string[]) => void }) => {
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
      projectId="p1"
      taskTitle="Editor task"
      fileStatus={() => options?.fileStatus ?? { files: new Map(), folders: new Map() }}
      statusStale={() => false}
      onStatusChanged={() => {}}
      openPath={options?.openPath?.() ?? null}
      reveal={options?.reveal?.() ?? null}
      onOpen={onOpen}
      onRevealed={options?.onRevealed ?? (() => {})}
      onRevealActive={() => {}}
      actions={actions}
      onVisibleFiles={options?.onVisibleFiles ?? (() => {})}
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
    expect([...host.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Show ignored files')?.getAttribute('aria-pressed')).toBe('false')
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
  const collapse = [...host.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Collapse all folders')!
  collapse.click()
  await Promise.resolve(); await Promise.resolve()
  expect(onRevealed).not.toHaveBeenCalled()
  expect(host.textContent).not.toContain('app.ts')
})

describe('other plugins’ file actions', () => {
  const armed = () => {
    const release = vi.fn()
    vi.mocked(actions.arm).mockImplementation((target) => ({ target, ready: Promise.resolve(), release, hold: () => () => {}, block: () => {}, dirty: () => [], custodies: new Map(), sourceCustodies: () => new Map(), savedRevisions: new Map(), tabs: { files: [], active: null } }))
    return release
  }
  const file = (name: string, dir = false): EditorEntry => ({ name, dir, kind: dir ? 'folder' : 'file', identity: name, entryId: name, root: '/work' })
  const rowFor = (title: string) => vi.waitFor(() => {
    const element = host.querySelector<HTMLElement>(`[title="${title}"]`)
    if (!element) throw new Error(`${title} not loaded`)
    return element
  })
  const rightClick = (row: HTMLElement) => {
    row.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }))
    row.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true }))
  }
  const menuLabels = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => item.textContent)
  const menuItem = (label: string) => vi.waitFor(() => {
    const element = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === label)
    if (!element) throw new Error(`${label} not in the menu`)
    return element
  })
  const registered: { dispose(): void }[] = []
  afterEach(() => registered.splice(0).forEach((handle) => handle.dispose()))

  it('draws them after its own rows and runs them on the entry the menu opened on, without opening it', async () => {
    listing.mockImplementation(async (_task, path) => path === '' ? [file('fixtures', true), file('Data.JSON')] : [])
    const release = armed()
    const inspect = vi.fn()
    registered.push(registerContextMenuItems([
      { id: 'inspect', location: 'file.row', label: 'Inspect JSON', order: 0, when: (target) => target.extension === 'json' && !target.directory, run: inspect },
      { id: 'tab-only', location: 'document.tab', label: 'Tab only', order: 0, run: () => {} },
    ]))
    const onOpen = mount()
    rightClick(await rowFor('Data.JSON'))
    await menuItem('Inspect JSON')
    expect(menuLabels().slice(-2)).toEqual(['Move to trash…', 'Inspect JSON'])
    expect(menuLabels()).not.toContain('Tab only')
    ;(await menuItem('Inspect JSON')).click()
    expect(inspect).toHaveBeenCalledWith({
      location: 'file.row', nodeId: '', ownerPluginId: 'editor', taskId, projectId: 'p1', path: 'Data.JSON',
      title: 'Data.JSON', directory: false, readOnly: false, extension: 'json',
    })
    expect(onOpen).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  })

  it('names a folder as a directory, so a file-only row stays off it', async () => {
    listing.mockImplementation(async (_task, path) => path === '' ? [file('fixtures.json', true)] : [])
    armed()
    registered.push(registerContextMenuItems([
      { id: 'inspect', location: 'file.row', label: 'Inspect JSON', order: 0, when: (target) => target.extension === 'json' && !target.directory, run: () => {} },
      { id: 'folder', location: 'file.row', label: 'Folder action', order: 0, when: (target) => target.directory, run: () => {} },
    ]))
    mount()
    rightClick(await rowFor('fixtures.json'))
    await menuItem('Folder action')
    expect(menuLabels()).not.toContain('Inspect JSON')
  })

  it('keeps the captured entry when a refresh moves rows under the open menu', async () => {
    let names = ['data.json']
    listing.mockImplementation(async (_task, path) => path === '' ? names.map((name) => file(name)) : [])
    armed()
    const inspect = vi.fn()
    registered.push(registerContextMenuItems([{ id: 'inspect', location: 'file.row', label: 'Inspect', order: 0, run: inspect }]))
    mount()
    rightClick(await rowFor('data.json'))
    await menuItem('Inspect')
    // A new first row: the virtual slot that drew data.json now draws another entry.
    names = ['a-new.json', 'data.json']
    window.dispatchEvent(new Event('focus'))
    await rowFor('a-new.json')
    ;(await menuItem('Inspect')).click()
    expect(inspect).toHaveBeenCalledOnce()
    expect(inspect.mock.calls[0][0]).toMatchObject({ path: 'data.json' })
  })

  it('closes with an entry a refresh removed, and runs nothing on it', async () => {
    // The desktop menu belongs to its row, so it goes with the row. The terminal's menu doesn't, which
    // is what the tree's own visible-entry check before a contributed row runs is for.
    let names = ['data.json', 'other.json']
    listing.mockImplementation(async (_task, path) => path === '' ? names.map((name) => file(name)) : [])
    armed()
    const inspect = vi.fn()
    registered.push(registerContextMenuItems([{ id: 'inspect', location: 'file.row', label: 'Inspect', order: 0, run: inspect }]))
    mount()
    rightClick(await rowFor('data.json'))
    const row = await menuItem('Inspect')
    names = ['other.json']
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(host.querySelector('[title="data.json"]')).toBeNull())
    expect(row.isConnected).toBe(false)
    expect(menuLabels()).not.toContain('Inspect')
  })

  it('runs nothing once the tree’s Node is no longer the one in view', async () => {
    listing.mockImplementation(async (_task, path) => path === '' ? [file('data.json')] : [])
    armed()
    const inspect = vi.fn()
    registered.push(registerContextMenuItems([{ id: 'inspect', location: 'file.row', label: 'Inspect', order: 0, run: inspect }]))
    mount()
    rightClick(await rowFor('data.json'))
    const row = await menuItem('Inspect')
    setActiveNode('another-node')
    try {
      row.click()
      expect(inspect).not.toHaveBeenCalled()
    } finally { setActiveNode(null) }
    expect(inspect).not.toHaveBeenCalled()
  })
})

describe('other plugins’ file marks', () => {
  const registered: { dispose(): void }[] = []
  afterEach(() => registered.splice(0).forEach((handle) => handle.dispose()))
  // A loaded contributor as the chrome pass would bind it, with the transport stubbed out.
  const contribute = (marks: ExtensionContribution['marks']) => {
    registered.push(
      extensionPointRegistry.register({ id: EDITOR_FILE_POINT, ownerId: 'editor', label: 'Editor file', kind: 'annotation', key: [...EDITOR_FILE_KEY], acceptedMarks: MAX_EDITOR_FILE_MARKS, max: 1 }),
      extensionRegistry.register({ id: 'plugin:review:files', pluginId: 'review', point: EDITOR_FILE_POINT, label: 'Review', order: 500, carrier: 'items', marks, requestScope: () => 'local' } as ExtensionContribution),
    )
  }

  it('asks once for a large tree and again only when expansion changes which files show', async () => {
    const { requestFileAnnotations } = await import('./fileAnnotations')
    listing.mockImplementation(async (_task, dir) => dir === ''
      ? [{ name: 'src', dir: true }, ...Array.from({ length: 10_000 }, (_, index) => ({ name: `${index}.txt`, dir: false }))]
      : [{ name: 'app.ts', dir: false }])
    const marks = vi.fn(async (keys: Record<string, string | number>[]) =>
      keys.filter((key) => key.path === '0.txt').map((key) => ({ key, severity: 'warn' as const, text: 'Needs review' })))
    contribute(marks)
    mount(vi.fn(), { onVisibleFiles: (paths) => requestFileAnnotations(taskId, paths) })

    const row = await vi.waitFor(() => {
      const element = host.querySelector<HTMLElement>('[title^="0.txt"]')
      if (!element?.title.includes('Needs review')) throw new Error('mark not drawn yet')
      return element
    })
    expect(row.title).toBe('0.txt — Needs review — review')
    expect(row.querySelector('.ui-dot[data-tone="warn"]')).not.toBeNull()
    expect(host.querySelectorAll('[role="treeitem"]').length).toBeLessThan(100)
    expect(marks).toHaveBeenCalledTimes(1)
    const asked = marks.mock.calls[0]![0] as EditorFileAnnotationKey[]
    expect(asked).toHaveLength(10_000)
    expect(asked.some((key) => key.path === 'src')).toBe(false)

    // A refresh that lists the same files asks nothing new.
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(listing.mock.calls.length).toBeGreaterThan(1))
    await Promise.resolve()
    expect(marks).toHaveBeenCalledTimes(1)

    setEditorTreeDirectoryOpen(taskId, 'src', true)
    await vi.waitFor(() => expect(marks).toHaveBeenCalledTimes(2))
    expect((marks.mock.calls[1]![0] as EditorFileAnnotationKey[]).some((key) => key.path === 'src/app.ts')).toBe(true)

    setEditorTreeDirectoryOpen(taskId, 'src', false)
    await vi.waitFor(() => expect(marks).toHaveBeenCalledTimes(3))
    expect((marks.mock.calls[2]![0] as EditorFileAnnotationKey[]).some((key) => key.path === 'src/app.ts')).toBe(false)
  })

  it('draws a mark without opening, selecting or arming the file', async () => {
    const { requestFileAnnotations } = await import('./fileAnnotations')
    listing.mockResolvedValueOnce([{ name: 'gen.ts', dir: false }])
    contribute(async (keys) => keys.map((key) => ({ key, severity: 'danger' as const, text: 'Generated file', icon: 'lock' })))
    const onOpen = mount(vi.fn(), { onVisibleFiles: (paths) => requestFileAnnotations(taskId, paths) })
    const row = await vi.waitFor(() => {
      const element = host.querySelector<HTMLElement>('[title^="gen.ts"]')
      if (!element?.querySelector('.ui-icon[data-tone="danger"]')) throw new Error('mark not drawn yet')
      return element
    })
    expect(row.getAttribute('aria-label') ?? row.querySelector('[aria-label]')?.getAttribute('aria-label')).toContain('Generated file — review')
    expect(row.getAttribute('aria-selected')).not.toBe('true')
    expect(onOpen).not.toHaveBeenCalled()
    expect(actions.arm).not.toHaveBeenCalled()
  })

  it('reports no files once the tree is gone', async () => {
    const onVisibleFiles = vi.fn()
    mount(vi.fn(), { onVisibleFiles })
    setEditorTreeDirectoryOpen(taskId, 'src', true)
    await vi.waitFor(() => expect(onVisibleFiles).toHaveBeenLastCalledWith(['src/app.ts']))
    dispose?.()
    dispose = undefined
    expect(onVisibleFiles).toHaveBeenLastCalledWith([])
  })
})

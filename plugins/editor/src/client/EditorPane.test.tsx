import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { EditorView } from '@codemirror/view'
import { prefsKey } from '@acorn/protocol/api.ts'
import type { Task } from '@acorn/plugin-api/client'
import { Rectangle } from '@acorn/plugin-api/ui'

// The editor pane against a real CodeMirror, in jsdom. What is stubbed is the worktree behind it and
// the two sidebar panels, because neither is what this file is about; the editor, its per-file state,
// the dirty derivation and the save paths are the shipped code.
//
// This is the tier the Monaco pane never had: the swap-and-swap-back behaviour was only ever checked
// by hand, and it is exactly the behaviour an engine change could break quietly.

// jsdom does no layout, so two things the real browser provides are simply absent: a Range cannot
// report rectangles (CodeMirror measures selections) and an element cannot scroll itself into view
// (the kit's tab strip keeps the active tab visible). Both are cosmetic here and both throw, loudly
// and asynchronously, if left missing.
Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

const disk = new Map<string, string>([['a.ts', 'const a = 1\n'], ['b.ts', 'const b = 2\n']])
const write = vi.fn(async (_taskId: string, path: string, content: string) => {
  disk.set(path, content)
  return { ok: true as const }
})
const read = vi.fn(async (_taskId: string, path: string) => disk.get(path) ?? '')
// The checkout path, which the pane now reads through the query cache. A test that wants to see what
// the pane does *while* that request is outstanding replaces this with a promise it holds open.
let root: () => Promise<string | null> = async () => '/worktree'
// Only the API is stubbed; the query key and the freshness window are the shipped ones, because what
// this file checks about them is that a warm cache means no second request.
vi.mock('./editorClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./editorClient')>()),
  editorApi: () => ({
    root: () => root(),
    list: async () => [],
    files: async () => [...disk.keys()],
    read: (taskId: string, path: string) => read(taskId, path),
    write: (taskId: string, path: string, content: string) => write(taskId, path, content),
  }),
}))
// The sidebar's two panels fetch a tree and run ripgrep. Neither is this file's subject.
vi.mock('./FileTree', () => ({ default: () => null }))
vi.mock('./search/SearchPanel', () => ({ default: () => null }))
// Terminal mode's half. The real one is xterm over a websocket, which jsdom cannot give it; what this
// file is about is which box the pane mounts and what it does when the process ends, so the stand-in
// draws the same rectangle and hands the exit callback back to the test.
let quitEditor: ((code: number) => void) | undefined
vi.mock('./EditorTerminal', () => ({
  default: (props: { taskId: string; path: string; onExit: (code: number) => void }) => {
    quitEditor = props.onExit
    return <Rectangle kind="pty" label={`Editing ${props.path}`} />
  },
}))

const { default: EditorPane } = await import('./EditorPane')
const { editorOpen, openFiles } = await import('./editorState')
const { saveEditorMode } = await import('./editorPrefs')

// A task per test. The per-file document pool is held by the host per (pane, task) and outlives a
// mount on purpose, so two tests sharing a task id would share the first one's open documents.
let tasks = 0
let taskId = 't0'
const task = (): Task => ({ id: taskId }) as unknown as Task

const cleanups: (() => void)[] = []
let queryClient = new QueryClient()
beforeEach(() => {
  taskId = `t${++tasks}`
  root = async () => '/worktree'
  // The worktree, back as it was: one test quits `$EDITOR` over a file and another asserts what the
  // file holds.
  disk.set('a.ts', 'const a = 1\n')
  disk.set('b.ts', 'const b = 2\n')
})
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose())
  write.mockClear()
  read.mockClear()
  quitEditor = undefined
  localStorage.clear()
})

// The pane reads the editor-mode preference off the prefs query, so it needs a client with the cache
// seeded — the fetch behind it has no node to reach here, and `savePref` writes the cache directly.
const mount = (keepCache = false) => {
  // `keepCache` for the one test that mounts twice: the second mount is the same pane in the same
  // window, so it reads the client the first one warmed.
  if (!keepCache) {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
    queryClient.setQueryData(prefsKey, {})
  }
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => (
    <QueryClientProvider client={queryClient}><EditorPane task={task()} /></QueryClientProvider>
  ), host)
  cleanups.push(dispose)
  cleanups.push(() => host.remove())
  return { host, unmount: () => { dispose(); host.remove() } }
}

const rectangle = (host: HTMLElement, kind: 'editor' | 'pty') => host.querySelector(`.ui-rect[data-kind="${kind}"]`)

const editor = async (host: HTMLElement): Promise<EditorView> =>
  vi.waitFor(() => {
    const dom = host.querySelector<HTMLElement>('.cm-editor')
    const view = dom && EditorView.findFromDOM(dom)
    if (!view) throw new Error('no editor yet')
    return view
  })

/** The pane swaps files asynchronously (it reads the file first), so wait for the text to arrive. */
const showing = async (view: () => EditorView, text: string) =>
  vi.waitFor(() => expect(view().state.doc.toString()).toContain(text))

describe('the editor pane', () => {
  it('keeps a document, its edits and its cursor per file across tab swaps', async () => {
    const { host } = mount()
    const view = await editor(host)

    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')

    // Type, and put the cursor somewhere findable.
    view.dispatch({ changes: { from: 11, insert: '23' }, selection: { anchor: 5 } })
    expect(view.state.doc.toString()).toBe('const a = 123\n')
    await vi.waitFor(() => expect(openFiles(taskId).find((f) => f.path === 'a.ts')?.dirty).toBe(true))

    editorOpen(taskId, 'b.ts', false)
    await showing(() => view, 'const b = 2')

    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 123')
    // The unsaved edit and the cursor both came back: the state is cached, the view state restored.
    expect(view.state.selection.main.anchor).toBe(5)
  })

  it('writes on the save chord, and the dirty marker clears', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a =')

    view.dispatch({ changes: { from: 0, insert: '// edited\n' } })
    await vi.waitFor(() => expect(openFiles(taskId).find((f) => f.path === 'a.ts')?.dirty).toBe(true))

    // `Mod` is Cmd on a Mac and Ctrl everywhere else, and jsdom is everywhere else.
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true }))
    await vi.waitFor(() => expect(write).toHaveBeenCalled())
    expect(disk.get('a.ts')).toContain('// edited')
    await vi.waitFor(() => expect(openFiles(taskId).find((f) => f.path === 'a.ts')?.dirty).toBe(false))
  })

  it('mounts the reader\'s own editor instead of CodeMirror when the preference says terminal', async () => {
    const { host } = mount()
    await editor(host)
    editorOpen(taskId, 'a.ts', false)

    await saveEditorMode(queryClient, 'terminal')
    await vi.waitFor(() => expect(rectangle(host, 'pty')).toBeTruthy())
    expect(rectangle(host, 'editor')).toBeNull()

    // And back: the graphical editor returns, showing the file.
    await saveEditorMode(queryClient, 'graphical')
    await vi.waitFor(() => expect(rectangle(host, 'editor')).toBeTruthy())
    expect(rectangle(host, 'pty')).toBeNull()
  })

  it('re-reads the file when the reader quits their editor, and says so on a non-zero exit', async () => {
    const { host } = mount()
    await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await saveEditorMode(queryClient, 'terminal')
    await vi.waitFor(() => expect(quitEditor).toBeTruthy())

    // What `$EDITOR` did to the file while the pane was not looking.
    disk.set('a.ts', 'const a = 99\n')
    quitEditor!(0)
    const view = await editor(host)
    await showing(() => view, 'const a = 99')

    // A refusal is reported rather than passed off as a save.
    await saveEditorMode(queryClient, 'terminal')
    await vi.waitFor(() => expect(quitEditor).toBeTruthy())
    quitEditor!(3)
    await vi.waitFor(() => expect(host.textContent).toContain('exited with status 3'))
  })

  // The waterfall the pane used to make a reader sit through: the checkout path, then the mount that
  // path gated, then the file. The file the reader left open does not depend on the path, so it goes
  // out beside it (docs/editor.md § One round trip to text).
  it('reads the remembered file while the checkout path is still in flight', async () => {
    editorOpen(taskId, 'a.ts', false)
    let releaseRoot!: (path: string) => void
    root = () => new Promise<string | null>((resolve) => { releaseRoot = resolve })

    const { host } = mount()
    // The read is issued while the root request is still open — the assertion the old order failed.
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith(taskId, 'a.ts'))
    releaseRoot('/worktree')

    const view = await editor(host)
    await showing(() => view, 'const a = 1')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('asks for the checkout path once per task, however often the pane is opened', async () => {
    const first = mount()
    await editor(first.host)
    first.unmount()

    const rootCalls = vi.fn(root)
    root = rootCalls
    const second = mount(true) // same window, same query client
    await editor(second.host)
    // A warm, fresh cache entry answers it: reopening a pane on a task the reader was just in costs
    // no request at all.
    expect(rootCalls).not.toHaveBeenCalled()
  })

  // The per-file documents belong to the task, not to the pane's mount (client-core paneModels.ts).
  it('keeps a file\'s text and undo history when the pane is closed and reopened in the same task', async () => {
    const first = mount()
    const view = await editor(first.host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    view.dispatch({ changes: { from: 0, insert: '// typed\n' } })
    await showing(() => view, '// typed')
    first.unmount()

    const second = mount(true)
    const reopened = await editor(second.host)
    await showing(() => reopened, '// typed')
    // The proof that this is the same document rather than a re-read of the file the unmount saved:
    // a freshly read state has nothing to undo.
    reopened.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true, bubbles: true }))
    await vi.waitFor(() => expect(reopened.state.doc.toString()).not.toContain('// typed'))
    expect(reopened.state.doc.toString()).toContain('const a = 1')
  })

  it('does not reopen with a dirty marker on a file the close already saved', async () => {
    const first = mount()
    const view = await editor(first.host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    view.dispatch({ changes: { from: 0, insert: '// typed\n' } })
    await vi.waitFor(() => expect(openFiles(taskId).find((f) => f.path === 'a.ts')?.dirty).toBe(true))

    // Closing the pane flushes the pending autosave. The write's own bookkeeping has to finish even
    // though the mount that started it is gone, or the file comes back marked dirty against content
    // that is already on disk.
    first.unmount()
    await vi.waitFor(() => expect(disk.get('a.ts')).toContain('// typed'))
    await vi.waitFor(() => expect(openFiles(taskId).find((f) => f.path === 'a.ts')?.dirty).toBe(false))

    const second = mount(true)
    await editor(second.host)
    expect(openFiles(taskId).find((f) => f.path === 'a.ts')?.dirty).toBe(false)
  })

  it('flushes a pending autosave when the editor loses focus', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'b.ts', false)
    await showing(() => view, 'const b =')

    view.dispatch({ changes: { from: 0, insert: '// blurred\n' } })
    await vi.waitFor(() => expect(openFiles(taskId).find((f) => f.path === 'b.ts')?.dirty).toBe(true))
    // Without the flush this is a 1.5s debounce the test would have to sit through.
    view.contentDOM.dispatchEvent(new Event('blur', { bubbles: true }))
    await vi.waitFor(() => expect(disk.get('b.ts')).toContain('// blurred'))
  })
})

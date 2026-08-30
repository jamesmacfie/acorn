import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('./editorClient', () => ({
  editorApi: () => ({
    root: async () => '/worktree',
    list: async () => [],
    files: async () => [...disk.keys()],
    read: async (_taskId: string, path: string) => disk.get(path) ?? '',
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

const task = { id: 't1' } as unknown as Task

const cleanups: (() => void)[] = []
let queryClient = new QueryClient()
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose())
  write.mockClear()
  quitEditor = undefined
  localStorage.clear()
})

// The pane reads the editor-mode preference off the prefs query, so it needs a client with the cache
// seeded — the fetch behind it has no node to reach here, and `savePref` writes the cache directly.
const mount = () => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  queryClient.setQueryData(prefsKey, {})
  const host = document.createElement('div')
  document.body.append(host)
  cleanups.push(render(() => (
    <QueryClientProvider client={queryClient}><EditorPane task={task} /></QueryClientProvider>
  ), host))
  cleanups.push(() => host.remove())
  return host
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
    const host = mount()
    const view = await editor(host)

    editorOpen('t1', 'a.ts', false)
    await showing(() => view, 'const a = 1')

    // Type, and put the cursor somewhere findable.
    view.dispatch({ changes: { from: 11, insert: '23' }, selection: { anchor: 5 } })
    expect(view.state.doc.toString()).toBe('const a = 123\n')
    await vi.waitFor(() => expect(openFiles('t1').find((f) => f.path === 'a.ts')?.dirty).toBe(true))

    editorOpen('t1', 'b.ts', false)
    await showing(() => view, 'const b = 2')

    editorOpen('t1', 'a.ts', false)
    await showing(() => view, 'const a = 123')
    // The unsaved edit and the cursor both came back: the state is cached, the view state restored.
    expect(view.state.selection.main.anchor).toBe(5)
  })

  it('writes on the save chord, and the dirty marker clears', async () => {
    const host = mount()
    const view = await editor(host)
    editorOpen('t1', 'a.ts', false)
    await showing(() => view, 'const a =')

    view.dispatch({ changes: { from: 0, insert: '// edited\n' } })
    await vi.waitFor(() => expect(openFiles('t1').find((f) => f.path === 'a.ts')?.dirty).toBe(true))

    // `Mod` is Cmd on a Mac and Ctrl everywhere else, and jsdom is everywhere else.
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true }))
    await vi.waitFor(() => expect(write).toHaveBeenCalled())
    expect(disk.get('a.ts')).toContain('// edited')
    await vi.waitFor(() => expect(openFiles('t1').find((f) => f.path === 'a.ts')?.dirty).toBe(false))
  })

  it('mounts the reader\'s own editor instead of CodeMirror when the preference says terminal', async () => {
    const host = mount()
    await editor(host)
    editorOpen('t1', 'a.ts', false)

    await saveEditorMode(queryClient, 'terminal')
    await vi.waitFor(() => expect(rectangle(host, 'pty')).toBeTruthy())
    expect(rectangle(host, 'editor')).toBeNull()

    // And back: the graphical editor returns, showing the file.
    await saveEditorMode(queryClient, 'graphical')
    await vi.waitFor(() => expect(rectangle(host, 'editor')).toBeTruthy())
    expect(rectangle(host, 'pty')).toBeNull()
  })

  it('re-reads the file when the reader quits their editor, and says so on a non-zero exit', async () => {
    const host = mount()
    await editor(host)
    editorOpen('t1', 'a.ts', false)
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

  it('flushes a pending autosave when the editor loses focus', async () => {
    const host = mount()
    const view = await editor(host)
    editorOpen('t1', 'b.ts', false)
    await showing(() => view, 'const b =')

    view.dispatch({ changes: { from: 0, insert: '// blurred\n' } })
    await vi.waitFor(() => expect(openFiles('t1').find((f) => f.path === 'b.ts')?.dirty).toBe(true))
    // Without the flush this is a 1.5s debounce the test would have to sit through.
    view.contentDOM.dispatchEvent(new Event('blur', { bubbles: true }))
    await vi.waitFor(() => expect(disk.get('b.ts')).toContain('// blurred'))
  })
})

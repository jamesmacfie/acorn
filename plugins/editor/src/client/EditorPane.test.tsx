import { createHash, webcrypto } from 'node:crypto'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { prefsKey } from '@acorn/protocol/api.ts'
import type { Task } from '@acorn/plugin-api/client'
import { paneCollapseKey, Rectangle, sidebarCollapse } from '@acorn/plugin-api/ui'
import { commandRegistry, extensionPointRegistry, extensionRegistry, setActiveNode, setActiveTaskId, setFocusedPane, type ExtensionContribution } from '@acorn/plugin-api/testkit/client'
import { EDITOR_DOCUMENT_POINT, type EditorDocumentProps } from '@acorn/protocol/extensionPoints.ts'

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
const readImage = vi.fn(async (_taskId: string, _path: string) => ({ bytes: Uint8Array.from([0x52, 0x49, 0x46, 0x46]), type: 'image/webp' }))
const lineMarkers = vi.fn(async (_taskId: string, _path: string, revision: string) => ({ revision, markers: [
  { kind: 'pull-request' as const, ranges: [{ from: 1, to: 1 }] },
  { kind: 'uncommitted' as const, ranges: [{ from: 1, to: 1 }] },
] }))
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
    fileStatus: async () => ({ kind: 'unavailable' }),
    entry: async (_taskId: string, path: string) => ({ root: '/worktree', path, kind: 'file', entryId: path }),
    read: async (taskId: string, path: string) => {
      const text = await read(taskId, path)
      return { text, revision: createHash('sha256').update(text).digest('hex') }
    },
    readImage: (taskId: string, path: string) => readImage(taskId, path),
    lineMarkers: (taskId: string, path: string, revision: string) => lineMarkers(taskId, path, revision),
    write: async (taskId: string, path: string, content: string) => {
      const result = await write(taskId, path, content)
      if (!result.ok) return result
      const text = 'text' in result && typeof result.text === 'string' ? result.text : content
      disk.set(path, text)
      return { ok: true, text, revision: createHash('sha256').update(text).digest('hex') }
    },
  }),
}))
// The sidebar's two panels fetch a tree and run ripgrep. Neither is this file's subject.
vi.mock('./FileTree', () => ({
  default: (props: { openPath: string | null }) => <div data-testid="file-tree-selection">{props.openPath}</div>,
}))
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
const { activeFile, editorActivate, editorClose, editorOpen, openFiles, requestEditorReveal } = await import('./editorState')
const { saveEditorMode } = await import('./editorPrefs')
const { editorViewState } = await import('./editorViewState')

// A task per test. The per-file document pool is held by the host per (pane, task) and outlives a
// mount on purpose, so two tests sharing a task id would share the first one's open documents.
let tasks = 0
let taskId = 't0'
const task = (): Task => ({ id: taskId }) as unknown as Task

const cleanups: (() => void)[] = []
let queryClient = new QueryClient()
beforeEach(() => {
  setActiveNode(null)
  vi.stubGlobal('crypto', webcrypto)
  taskId = `t${++tasks}`
  root = async () => '/worktree'
  // The worktree, back as it was: one test quits `$EDITOR` over a file and another asserts what the
  // file holds.
  disk.set('a.ts', 'const a = 1\n')
  disk.set('b.ts', 'const b = 2\n')
})
afterEach(() => {
  setActiveTaskId(null)
  cleanups.splice(0).forEach((dispose) => dispose())
  write.mockReset()
  write.mockImplementation(async (_taskId, path, content) => { disk.set(path, content); return { ok: true } })
  read.mockClear()
  readImage.mockClear()
  lineMarkers.mockClear()
  read.mockImplementation(async (_taskId, path) => disk.get(path) ?? '')
  quitEditor = undefined
  sidebarCollapse(paneCollapseKey('editor'))[1](false)
  localStorage.clear()
  setActiveNode(null)
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

const editorCommand = (id: string) => {
  const command = commandRegistry.entries().find((entry) => entry.id === id)
  if (!command || !('run' in command)) throw new Error(`Missing action command: ${id}`)
  return command
}
const runEditorCommand = (id: string) => {
  const command = editorCommand(id)
  command.run({ nodeId: null, workspaceId: null, projectId: null, taskId: null, paneId: null, surfaceId: null })
}

describe('the editor pane', () => {
  it('counts a million selected UTF-16 units without changing the file', async () => {
    disk.set('large.txt', 'x'.repeat(1_000_000))
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'large.txt', false)
    await showing(() => view, 'xxxx')
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    expect(host.querySelector('[aria-label="File status"]')?.textContent).toContain('1000000 selected')
    expect(write).not.toHaveBeenCalled()
  })

  it('keeps status actions on their admitted tab when a menu outlives a switch', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    host.querySelector<HTMLButtonElement>('[aria-label="File status"] button:last-child')!.click()
    const oldWrap = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find((item) => item.textContent?.includes('Word wrap'))!
    editorOpen(taskId, 'b.ts', false)
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe('const b = 2\n'))
    expect(document.querySelector('[aria-label="File status details"]')).toBeNull()
    oldWrap.click()
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('runs discovered graphical commands on the live document and saves their edits', async () => {
    disk.set('a.ts', 'const a = 1\nconst b = 2\n')
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    setActiveTaskId(taskId)
    setFocusedPane(taskId, 'editor')
    await vi.waitFor(() => expect(view.state.languageDataAt('commentTokens', 0).length).toBeGreaterThan(0))
    const available = (action: string) => editorCommand(`editor.edit.${action}`).when?.() ?? true
    expect(available('undo')).toBe(false)
    expect(available('redo')).toBe(false)
    for (const action of ['find', 'replace', 'comment', 'duplicate', 'move-up', 'move-down', 'select-next', 'indent', 'outdent']) {
      expect(available(action)).toBe(true)
    }
    runEditorCommand('editor.edit.find')
    await vi.waitFor(() => expect(host.querySelector('.cm-panels [main-field]')).not.toBeNull())
    runEditorCommand('editor.edit.replace')
    expect(host.querySelector<HTMLInputElement>('.cm-panels input[aria-label="Replace"]')).toBe(document.activeElement)
    view.dispatch({ selection: { anchor: 0 } })
    runEditorCommand('editor.edit.select-next')
    expect(write).not.toHaveBeenCalled()
    runEditorCommand('editor.edit.comment')
    expect(view.state.doc.toString()).toContain('// const a = 1')
    expect(available('undo')).toBe(true)
    runEditorCommand('editor.edit.duplicate')
    const duplicated = view.state.doc.toString()
    expect(duplicated.match(/const a = 1/g)).toHaveLength(2)
    runEditorCommand('editor.edit.move-down')
    expect(view.state.doc.toString()).not.toBe(duplicated)
    runEditorCommand('editor.edit.move-up')
    runEditorCommand('editor.edit.undo')
    expect(available('redo')).toBe(true)
    runEditorCommand('editor.edit.redo')
    saveChord(view)
    await vi.waitFor(() => expect(write).toHaveBeenCalled())
    expect(disk.get('a.ts')).toBe(view.state.doc.toString())
    editorOpen(taskId, 'b.ts', false)
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe('const b = 2\n'))
    runEditorCommand('editor.edit.duplicate')
    expect(view.state.doc.toString()).toContain('const b = 2\nconst b = 2')
    expect(disk.get('a.ts')).not.toContain('const b = 2\nconst b = 2')
    setActiveNode('other-node')
    expect(available('duplicate')).toBe(false)
    const before = view.state.doc.toString()
    runEditorCommand('editor.edit.duplicate')
    expect(view.state.doc.toString()).toBe(before)
  })

  it('keeps dirty undo, search, markers, and session presentation across reconfiguration', async () => {
    disk.set('a.ts', 'first\n  second\n')
    const first = mount()
    const view = await editor(first.host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'second')
    setActiveTaskId(taskId)
    setFocusedPane(taskId, 'editor')
    await vi.waitFor(() => expect(view.contentDOM.querySelector('.cm-line-pull-request')).not.toBeNull())
    view.dispatch({ selection: { anchor: 3 } })
    view.scrollDOM.scrollTop = 25
    runEditorCommand('editor.edit.find')
    const search = first.host.querySelector('.cm-panels .cm-panel')
    expect(search).not.toBeNull()
    runEditorCommand('editor.toggle-word-wrap')
    expect(view.contentDOM.querySelector('.cm-line-pull-request')).not.toBeNull()
    expect(first.host.querySelector('.cm-panels .cm-panel')).toBe(search)
    expect(view.state.selection.main.head).toBe(3)
    expect(view.scrollDOM.scrollTop).toBe(25)
    view.dispatch({ changes: { from: 0, insert: 'changed ' } })
    expect(editorCommand('editor.edit.undo').when?.()).toBe(true)
    first.host.querySelector<HTMLButtonElement>('[aria-label="File status"] button:last-child')!.click()
    const tabs4 = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((item) => item.textContent?.includes('Tabs: 4'))!
    tabs4.click()
    expect(first.host.querySelector('[aria-label="File status"]')?.textContent).toContain('Tabs: 4')
    expect(first.host.querySelector('.cm-panels .cm-panel')).toBe(search)
    expect(editorCommand('editor.edit.undo').when?.()).toBe(true)
    expect(write).not.toHaveBeenCalled()
    editorOpen(taskId, 'b.ts', false)
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe('const b = 2\n'))
    editorActivate(taskId, 'a.ts')
    await showing(() => view, 'changed first')
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true)
    expect(first.host.querySelector('[aria-label="File status"]')?.textContent).toContain('Tabs: 4')
    first.unmount()
    const second = mount(true)
    const remounted = await editor(second.host)
    await showing(() => remounted, 'changed first')
    expect(remounted.contentDOM.classList.contains('cm-lineWrapping')).toBe(true)
    expect(second.host.querySelector('[aria-label="File status"]')?.textContent).toContain('Tabs: 4')
    expect(editorCommand('editor.edit.undo').when?.()).toBe(true)
    runEditorCommand('editor.edit.undo')
    expect(remounted.state.doc.toString()).toBe('first\n  second\n')
  })

  it('uses chosen indentation for later commands without rewriting CRLF text', async () => {
    disk.set('a.ts', 'first\r\n  second\r\n')
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'second')
    setActiveTaskId(taskId)
    setFocusedPane(taskId, 'editor')
    host.querySelector<HTMLButtonElement>('[aria-label="File status"] button:last-child')!.click()
    const tabs4 = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((item) => item.textContent?.includes('Tabs: 4'))!
    tabs4.click()
    expect(view.state.doc.toString()).toBe('first\r\n  second\r\n')
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } })
    runEditorCommand('editor.edit.indent')
    expect(view.state.doc.toString()).toBe('first\r\n\t  second\r\n')
    runEditorCommand('editor.edit.outdent')
    expect(view.state.doc.toString()).toBe('first\r\n  second\r\n')
  })

  it('shows live file facts and reconfigures wrap without a write or state replacement', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    setActiveTaskId(taskId)
    setFocusedPane(taskId, 'editor')
    expect(host.querySelector('[aria-label="File status"]')?.textContent).toContain('a.ts')
    expect(host.querySelector('[aria-label="File status"]')?.textContent).toContain('Ln 1, Col 1')
    expect(host.querySelector('[aria-label="File status"]')?.textContent).toContain('Saved')
    expect(rectangle(host, 'editor')!.compareDocumentPosition(host.querySelector('[aria-label="File status"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(6, 7)]) })
    expect(host.querySelector('[aria-label="File status"]')?.textContent).toContain('6 selected')
    const originalState = view.state
    runEditorCommand('editor.toggle-word-wrap')
    expect(view.state).not.toBe(originalState)
    expect(view.state.doc.eq(originalState.doc)).toBe(true)
    expect(view.state.selection.eq(originalState.selection)).toBe(true)
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true)
    expect(write).not.toHaveBeenCalled()
    runEditorCommand('editor.toggle-word-wrap')
    expect(write).not.toHaveBeenCalled()
    setFocusedPane(taskId, 'agent')
    host.querySelector<HTMLButtonElement>('[aria-label="File status"] button:last-child')!.click()
    const wrap = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find((item) => item.textContent?.includes('Word wrap'))!
    wrap.click()
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })
  const saveChord = (view: EditorView) => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
    key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true,
  }))

  it('skips clean writes, retains a refused close, and closes after retry', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    saveChord(view)
    await Promise.resolve()
    expect(write).not.toHaveBeenCalled()
    write.mockRejectedValueOnce(new Error('formatter veto'))
    view.dispatch({ changes: { from: 0, insert: '// unsent\n' } })
    host.querySelector<HTMLButtonElement>('[aria-label="Close a.ts"]')!.click()
    await vi.waitFor(() => expect(host.textContent).toContain('formatter veto'))
    expect(host.querySelector('[aria-label="File status"]')?.textContent).toContain('Save failed')
    expect(openFiles(taskId)).toMatchObject([{ path: 'a.ts', dirty: true }])
    expect(view.state.doc.toString()).toContain('// unsent')
    host.querySelector<HTMLButtonElement>('[aria-label="Close a.ts"]')!.click()
    await vi.waitFor(() => expect(openFiles(taskId)).toHaveLength(0))
    expect(disk.get('a.ts')).toContain('// unsent')
  })

  it('releases menu custody before guarding a dirty tab close', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    view.dispatch({ changes: { from: 0, insert: '// menu draft\n' } })
    host.querySelector<HTMLButtonElement>('[aria-label="Actions for a.ts"]')!.click()
    const close = await vi.waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'Close')!)
    close.click()
    await vi.waitFor(() => expect(openFiles(taskId)).toHaveLength(0))
    expect(disk.get('a.ts')).toContain('// menu draft')
  })

  it('keeps a later edit and its tab when close waits on an earlier revision', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    let resolve!: (result: { ok: true }) => void
    write.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    view.dispatch({ changes: { from: 0, insert: '// first\n' } })
    host.querySelector<HTMLButtonElement>('[aria-label="Close a.ts"]')!.click()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    view.dispatch({ changes: { from: 0, insert: '// later\n' } })
    resolve({ ok: true })
    await vi.waitFor(() => expect(openFiles(taskId)[0]?.dirty).toBe(true))
    expect(openFiles(taskId)[0]?.path).toBe('a.ts')
    expect(view.state.doc.toString()).toContain('// later')
  })

  it('does not close a replacement tab at the same path after a delayed save', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    let resolve!: (result: { ok: true }) => void
    write.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    view.dispatch({ changes: { from: 0, insert: '// first\n' } })
    host.querySelector<HTMLButtonElement>('[aria-label="Close a.ts"]')!.click()
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
    editorClose(taskId, 'a.ts')
    editorOpen(taskId, 'a.ts', false)
    resolve({ ok: true })
    await vi.waitFor(() => expect(disk.get('a.ts')).toContain('// first'))
    await vi.waitFor(() => expect(openFiles(taskId).map((file) => file.path)).toEqual(['a.ts']))
  })

  it('closes the captured tab order until a guarded save fails, leaving later tabs open', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    editorOpen(taskId, 'b.ts', false)
    await showing(() => view, 'const b = 2')
    view.dispatch({ changes: { from: 0, insert: '// draft\n' } })
    write.mockRejectedValueOnce(new Error('disk conflict'))
    host.querySelector<HTMLButtonElement>('[aria-label="Actions for a.ts"]')!.click()
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull())
    const closeAll = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'Close all')!
    closeAll.click()
    await vi.waitFor(() => expect(host.textContent).toContain('Closed 1 of 2 files'))
    expect(openFiles(taskId).map((file) => file.path)).toEqual(['b.ts'])
    expect(openFiles(taskId)[0].dirty).toBe(true)
  })

  it('cancels a pending bulk close without taking a newly opened tab', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    editorOpen(taskId, 'b.ts', false)
    await showing(() => view, 'const b = 2')
    let resolve!: (result: { ok: true }) => void
    write.mockReset()
    write.mockImplementation(async (_taskId, path) => path === 'b.ts'
      ? new Promise((done) => { resolve = done }) : { ok: true })
    view.dispatch({ changes: { from: 0, insert: '// draft\n' } })
    host.querySelector<HTMLButtonElement>('[aria-label="Actions for b.ts"]')!.click()
    const closeAll = await vi.waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'Close all')!)
    closeAll.click()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    editorOpen(taskId, 'new.ts', false)
    const cancel = await vi.waitFor(() => [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Cancel close')!)
    cancel.click()
    resolve({ ok: true })
    await vi.waitFor(() => expect(host.textContent).toContain('Closed 1 of 2 files. Canceled'))
    expect(openFiles(taskId).map((file) => file.path)).toEqual(['b.ts', 'new.ts'])
  })

  it('replays file jumps without truncating forward, then branches on a same-file jump', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    requestEditorReveal(taskId, 'b.ts', 1, 3)
    await showing(() => view, 'const b = 2')
    requestEditorReveal(taskId, 'a.ts', 1, 4)
    await showing(() => view, 'const a = 1')
    runEditorCommand('editor.navigation.back')
    await vi.waitFor(() => expect(activeFile(taskId)).toBe('b.ts'))
    runEditorCommand('editor.navigation.forward')
    await vi.waitFor(() => expect(activeFile(taskId)).toBe('a.ts'))
    runEditorCommand('editor.navigation.back')
    await vi.waitFor(() => expect(activeFile(taskId)).toBe('b.ts'))
    requestEditorReveal(taskId, 'b.ts', 1, 6)
    await vi.waitFor(() => expect(view.state.selection.main.head).toBe(5))
    runEditorCommand('editor.navigation.forward')
    await Promise.resolve()
    expect(activeFile(taskId)).toBe('b.ts')
  })

  it('does not let a delayed back read replace a newer deliberate position', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    requestEditorReveal(taskId, 'b.ts', 1, 3)
    await showing(() => view, 'const b = 2')
    requestEditorReveal(taskId, 'a.ts', 1, 4)
    await showing(() => view, 'const a = 1')
    let finishBack!: (text: string) => void
    read.mockImplementationOnce(() => new Promise((resolve) => { finishBack = resolve }))
    runEditorCommand('editor.navigation.back')
    await vi.waitFor(() => expect(finishBack).toBeTypeOf('function'))
    requestEditorReveal(taskId, 'a.ts', 1, 7)
    await vi.waitFor(() => expect(view.state.selection.main.head).toBe(6))
    finishBack('const b = 2\n')
    await Promise.resolve()
    expect(activeFile(taskId)).toBe('a.ts')
    expect(view.state.selection.main.head).toBe(6)
  })

  it('lets the latest history invocation win while an earlier back read waits', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    requestEditorReveal(taskId, 'b.ts', 1, 3)
    await showing(() => view, 'const b = 2')
    requestEditorReveal(taskId, 'a.ts', 1, 4)
    await showing(() => view, 'const a = 1')
    let finishBack!: (text: string) => void
    let finishForward!: (text: string) => void
    read.mockImplementationOnce(() => new Promise((resolve) => { finishBack = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishForward = resolve }))
    runEditorCommand('editor.navigation.back')
    await vi.waitFor(() => expect(finishBack).toBeTypeOf('function'))
    runEditorCommand('editor.navigation.forward')
    await vi.waitFor(() => expect(finishForward).toBeTypeOf('function'))
    finishBack('const b = 2\n')
    await Promise.resolve()
    expect(activeFile(taskId)).toBe('a.ts')
    finishForward('const a = 1\n')
    await vi.waitFor(() => expect(view.state.selection.main.head).toBe(3))
    expect(activeFile(taskId)).toBe('a.ts')
  })

  it('keeps a history destination retryable after a transient read error', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    requestEditorReveal(taskId, 'b.ts', 1, 3)
    await showing(() => view, 'const b = 2')
    requestEditorReveal(taskId, 'a.ts', 1, 4)
    await showing(() => view, 'const a = 1')
    const readsBefore = read.mock.calls.length
    read.mockRejectedValueOnce(new Error('temporary read failure'))
    runEditorCommand('editor.navigation.back')
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(readsBefore + 1))
    await Promise.resolve()
    await Promise.resolve()
    expect(activeFile(taskId)).toBe('a.ts')
    runEditorCommand('editor.navigation.back')
    await vi.waitFor(() => expect(activeFile(taskId)).toBe('b.ts'))
  })

  it('keeps a closed entry when an older reopen read loses to new navigation', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    host.querySelector<HTMLButtonElement>('[aria-label="Close a.ts"]')!.click()
    await vi.waitFor(() => expect(openFiles(taskId)).toHaveLength(0))
    editorOpen(taskId, 'b.ts', false)
    await showing(() => view, 'const b = 2')
    let finishReopen!: (text: string) => void
    read.mockImplementationOnce(() => new Promise((resolve) => { finishReopen = resolve }))
    runEditorCommand('editor.tabs.reopen-closed')
    await vi.waitFor(() => expect(finishReopen).toBeTypeOf('function'))
    requestEditorReveal(taskId, 'b.ts', 1, 5)
    await vi.waitFor(() => expect(view.state.selection.main.head).toBe(4))
    finishReopen('const a = 1\n')
    await Promise.resolve()
    expect(openFiles(taskId).map((file) => file.path)).toEqual(['b.ts'])
    runEditorCommand('editor.tabs.reopen-closed')
    await vi.waitFor(() => expect(openFiles(taskId).map((file) => file.path)).toEqual(['a.ts', 'b.ts']))
    expect(openFiles(taskId)[0]?.ephemeral).toBe(false)
  })

  it('places a new file reveal at its clamped line and column', async () => {
    disk.set('position.ts', Array.from({ length: 16 }, (_, index) => `line ${index + 1}`).join('\n'))
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    requestEditorReveal(taskId, 'position.ts', 12, 4)
    await showing(() => view, 'line 12')
    await vi.waitFor(() => expect(view.state.selection.main.head).toBe(view.state.doc.line(12).from + 3))
    requestEditorReveal(taskId, 'position.ts', 200, 400)
    await vi.waitFor(() => expect(view.state.selection.main.head).toBe(view.state.doc.length))
  })

  it('rejects a held focus reload after typing and does not save an acknowledged reload', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    let resolve!: (text: string) => void
    read.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(resolve).toBeDefined())
    view.dispatch({ changes: { from: 0, insert: '// human edit\n' } })
    resolve('external text')
    await Promise.resolve()
    expect(view.state.doc.toString()).toContain('// human edit')
    saveChord(view)
    await vi.waitFor(() => expect(openFiles(taskId)[0]?.dirty).toBe(false))
    write.mockClear()
    read.mockResolvedValueOnce('acknowledged external text')
    window.dispatchEvent(new Event('focus'))
    await showing(() => view, 'acknowledged external text')
    view.contentDOM.dispatchEvent(new Event('blur', { bubbles: true }))
    saveChord(view)
    expect(write).not.toHaveBeenCalled()
  })

  it('opens text before held markers and refuses fabricated editable text after a failed load', async () => {
    const { host } = mount()
    const view = await editor(host)
    let resolve!: (markers: Awaited<ReturnType<typeof lineMarkers>>) => void
    lineMarkers.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    await vi.waitFor(() => expect(resolve).toBeDefined())
    read.mockRejectedValueOnce(new Error('unsupported UTF-8'))
    editorOpen(taskId, 'binary.dat', false)
    await vi.waitFor(() => expect(host.textContent).toContain('unsupported UTF-8'))
    expect(view.state.readOnly).toBe(true)
    saveChord(view)
    expect(write).not.toHaveBeenCalled()
    resolve({ revision: '', markers: [] })
  })

  it('keeps displayed markers and the editor state after an unchanged disk read', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    const marked = () => view.contentDOM.querySelector('.cm-line-pull-request')
    await vi.waitFor(() => expect(marked()).not.toBeNull())
    const calls = lineMarkers.mock.calls.length
    const reads = read.mock.calls.length
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(reads))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(lineMarkers.mock.calls.length).toBe(calls)
    expect(marked()).not.toBeNull()
  })

  it('keeps selection and undo history when disk bytes are unchanged', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    view.dispatch({ changes: { from: 0, insert: '// undoable\n' } })
    view.dispatch({ selection: { anchor: 4 } })
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(view.state.selection.main.anchor).toBe(4)
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true, bubbles: true }))
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe('const a = 1\n'))
  })

  it('keeps an unchanged explicit reload in the same editor state', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    view.dispatch({ changes: { from: 0, insert: '// draft\n' }, selection: { anchor: 4 } })
    disk.set('a.ts', view.state.doc.toString())
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(host.textContent).toContain('Changed on disk'))
    const before = view.state
    const reload = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Reload from disk')!
    reload.click()
    expect(reload.textContent).toContain('a.ts')
    reload.click()
    await vi.waitFor(() => expect(host.textContent).not.toContain('Changed on disk'))
    expect(view.state).toBe(before)
    expect(view.state.selection.main.anchor).toBe(4)
    expect(write).not.toHaveBeenCalled()
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true, bubbles: true }))
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe('const a = 1\n'))
  })

  it('refuses an armed overwrite after the shown disk revision changes', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    view.dispatch({ changes: { from: 0, insert: '// my draft\n' } })
    disk.set('a.ts', '// first external\n')
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(host.textContent).toContain('Changed on disk'))
    const compare = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Compare')!
    compare.click()
    await vi.waitFor(() => expect(host.textContent).toContain('first external'))
    const overwrite = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Overwrite disk…')!
    overwrite.click()
    expect(overwrite.textContent).toContain('a.ts')
    const reads = read.mock.calls.length
    disk.set('a.ts', '// newer external\n')
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(reads))
    await vi.waitFor(() => expect(host.textContent).toContain('newer external'))
    overwrite.click()
    expect(write).not.toHaveBeenCalled()
    expect(disk.get('a.ts')).toBe('// newer external\n')
    expect(view.state.doc.toString()).toContain('// my draft')
  })

  it('does not redirect an armed overwrite after a tab switch', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    view.dispatch({ changes: { from: 0, insert: '// a draft\n' } })
    disk.set('a.ts', '// a external\n')
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(host.textContent).toContain('Changed on disk'))
    const overwrite = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Overwrite disk…')!
    overwrite.click()
    expect(overwrite.textContent).toContain('a.ts')

    editorOpen(taskId, 'b.ts', false)
    await showing(() => view, 'const b = 2')
    view.dispatch({ changes: { from: 0, insert: '// b draft\n' } })
    disk.set('b.ts', '// b external\n')
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(host.textContent).toContain('Changed on disk'))
    const nextOverwrite = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Overwrite disk…')!
    nextOverwrite.click()
    expect(write).not.toHaveBeenCalled()
    expect(disk.get('a.ts')).toBe('// a external\n')
    expect(disk.get('b.ts')).toBe('// b external\n')
    expect(openFiles(taskId).find((file) => file.path === 'a.ts')?.dirty).toBe(true)
  })

  it('coalesces focus bursts and applies the newest disk response', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    read.mockClear()
    let release!: (text: string) => void
    read.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve }))
    for (let i = 0; i < 8; i++) window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    disk.set('a.ts', '// latest\n')
    for (let i = 0; i < 8; i++) window.dispatchEvent(new Event('focus'))
    release('const a = 1\n')
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe('// latest\n'))
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('keeps useful text and distinguishes a failed refresh from deletion', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    read.mockRejectedValueOnce(new Error('Node unavailable'))
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(host.textContent).toContain('Could not read disk'))
    expect(host.textContent).not.toContain('Deleted on disk')
    expect(view.state.doc.toString()).toBe('const a = 1\n')
    read.mockRejectedValueOnce(Object.assign(new Error('File not found.'), { status: 404, code: 'not_found' }))
    const reloadStatus = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Reload status')!
    reloadStatus.click()
    await vi.waitFor(() => expect(host.textContent).toContain('Deleted on disk'))
    expect(view.state.doc.toString()).toBe('const a = 1\n')
  })

  it.each(['node-switch', 'task-eviction'] as const)('discards a late refresh after %s', async (change) => {
    const { host, unmount } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    let release!: (text: string) => void
    read.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve }))
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(typeof release).toBe('function'))
    if (change === 'node-switch') setActiveNode('other-node')
    else {
      const { paneModel } = await import('@acorn/plugin-api/client')
      paneModel('editor', 'other-task', () => ({}))
      unmount()
    }
    release('// stale response\n')
    await Promise.resolve()
    expect(view.state.doc.toString()).toBe('const a = 1\n')
    expect(write).not.toHaveBeenCalled()
  })

  it('keeps a dirty draft and opens a read-only comparison when disk changes', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    view.dispatch({ changes: { from: 0, insert: '// my draft\n' } })
    disk.set('a.ts', '// external writer\n')
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(host.textContent).toContain('Changed on disk'))
    view.contentDOM.dispatchEvent(new Event('blur', { bubbles: true }))
    host.querySelector<HTMLButtonElement>('[aria-label="Close a.ts"]')!.click()
    expect(write).not.toHaveBeenCalled()
    expect(openFiles(taskId)[0]?.path).toBe('a.ts')
    expect(view.state.doc.toString()).toContain('// my draft')
    const compare = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Compare')!
    compare.click()
    await vi.waitFor(() => expect(host.textContent).toContain('Disk snapshot → Live draft'))
    expect(host.textContent).toContain('external writer')
    expect(host.textContent).toContain('my draft')
  })

  it('pauses blur and close saves after external deletion and recreates only by confirmation', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    view.dispatch({ changes: { from: 0, insert: '// keep me\n' } })
    disk.delete('a.ts')
    read.mockRejectedValueOnce(Object.assign(new Error('File not found.'), { status: 404, code: 'not_found' }))
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(host.textContent).toContain('Deleted on disk'))
    view.contentDOM.dispatchEvent(new Event('blur', { bubbles: true }))
    host.querySelector<HTMLButtonElement>('[aria-label="Close a.ts"]')!.click()
    expect(write).not.toHaveBeenCalled()
    expect(disk.has('a.ts')).toBe(false)
    const recreate = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Recreate file…')!
    recreate.click()
    expect(disk.has('a.ts')).toBe(false)
    recreate.click()
    await vi.waitFor(() => expect(disk.get('a.ts')).toContain('// keep me'))
  })

  it.each([
    { record: 'known-baseline', revision: true, status: 'Recovered draft' },
    { record: 'legacy', revision: false, status: 'Changed on disk' },
  ])('keeps a $record recovered draft blocked through close and retirement until resolution', async ({ revision, status }) => {
    const base = disk.get('a.ts')!
    const draft = `// recovered\n${base}`
    localStorage.setItem(`acorn.document.recovery.${JSON.stringify([null, 'file', taskId, 'a.ts'])}`, JSON.stringify({
      text: draft, acknowledged: base,
      ...(revision ? { acknowledgedRevision: createHash('sha256').update(base).digest('hex') } : {}),
    }))
    const first = mount()
    const view = await editor(first.host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, '// recovered')
    await vi.waitFor(() => expect(first.host.textContent).toContain(status))
    view.contentDOM.dispatchEvent(new Event('blur', { bubbles: true }))
    first.host.querySelector<HTMLButtonElement>('[aria-label="Close a.ts"]')!.click()
    await Promise.resolve()
    expect(write).not.toHaveBeenCalled()
    expect(openFiles(taskId)[0]?.path).toBe('a.ts')
    const { paneModel } = await import('@acorn/plugin-api/client')
    paneModel('editor', 'other-task', () => ({}))
    first.unmount()
    await Promise.resolve()
    expect(write).not.toHaveBeenCalled()

    const second = mount(true)
    const reopened = await editor(second.host)
    await showing(() => reopened, '// recovered')
    await vi.waitFor(() => expect(second.host.textContent).toContain(status))
    const compare = [...second.host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Compare')!
    compare.click()
    await vi.waitFor(() => expect(second.host.textContent).toContain('Disk snapshot → Live draft'))
    const overwrite = [...second.host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Overwrite disk…')!
    overwrite.click()
    overwrite.click()
    await vi.waitFor(() => expect(disk.get('a.ts')).toBe(draft))
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('refuses Save as when the destination has recovered custody without clearing the source draft', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    view.dispatch({ changes: { from: 0, insert: '// source draft\n' } })
    disk.delete('a.ts')
    read.mockRejectedValueOnce(Object.assign(new Error('File not found.'), { status: 404, code: 'not_found' }))
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(host.textContent).toContain('Deleted on disk'))
    const destinationKey = `acorn.document.recovery.${JSON.stringify([null, 'file', taskId, 'new.ts'])}`
    localStorage.setItem(destinationKey, JSON.stringify({ text: 'other draft', acknowledged: '' }))
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Save as path"]')!
    input.value = 'new.ts'
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const saveAs = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Save as…')!
    saveAs.click()
    await vi.waitFor(() => expect(host.textContent).toContain('destination document already has open or recovered text'))
    expect(write).not.toHaveBeenCalled()
    expect(view.state.doc.toString()).toContain('// source draft')
    expect(openFiles(taskId)[0]?.path).toBe('a.ts')
    expect(localStorage.getItem(destinationKey)).toContain('other draft')

    // A destination can also become owned while the Node is writing. The source must still retain
    // its dirty recovery when the post-write rebind refuses that new owner.
    const { documentCustody } = await import('@acorn/plugin-api/ui/editor')
    const source = documentCustody([null, 'file', taskId, 'a.ts'], '')
    const sourceKey = `acorn.document.recovery.${JSON.stringify([null, 'file', taskId, 'a.ts'])}`
    source.flushRecovery()
    const recoveryBefore = localStorage.getItem(sourceKey)
    expect(recoveryBefore).toContain('// source draft')
    localStorage.removeItem(destinationKey)
    let finish!: (value: { ok: true }) => void
    write.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    saveAs.click()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    localStorage.setItem(destinationKey, JSON.stringify({ text: 'late draft', acknowledged: '' }))
    finish({ ok: true })
    await vi.waitFor(() => expect(disk.get('new.ts')).toContain('// source draft'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(source.dirty).toBe(true)
    expect(localStorage.getItem(sourceKey)).toBe(recoveryBefore)
    expect(source.current.toString()).toContain('// source draft')
    expect(openFiles(taskId)[0]?.path).toBe('a.ts')
    expect(localStorage.getItem(destinationKey)).toContain('late draft')
  })

  it('requests the exact displayed UTF-8 body including BOM, Unicode, and CRLF', async () => {
    const body = '\ufeff😀 café\r\nsecond\n'
    disk.set('exact.txt', body)
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'exact.txt', false)
    await showing(() => view, 'second')
    expect(view.state.doc.toString()).toBe(body)
    await vi.waitFor(() => expect(lineMarkers).toHaveBeenCalledWith(taskId, 'exact.txt', createHash('sha256').update(body).digest('hex')))
  })

  it('requires the cached document body when returning to a tab after disk changes', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    await vi.waitFor(() => expect(view.contentDOM.querySelector('.cm-line-pull-request')).not.toBeNull())
    editorOpen(taskId, 'b.ts', false)
    await showing(() => view, 'const b = 2')
    await vi.waitFor(() => expect(lineMarkers.mock.calls.some(([, path]) => path === 'b.ts')).toBe(true))
    disk.set('a.ts', 'external body\n')
    const { markerRevision } = await import('./markerRevision')
    lineMarkers.mockResolvedValueOnce({ revision: await markerRevision(disk.get('a.ts')!), markers: [] })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_000)
    const calls = lineMarkers.mock.calls.length
    try {
      editorOpen(taskId, 'a.ts', false)
      await showing(() => view, 'const a = 1')
      await vi.waitFor(() => expect(lineMarkers.mock.calls.length).toBeGreaterThan(calls))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(view.contentDOM.querySelector('.cm-line-pull-request')).not.toBeNull()
    } finally { clock.mockRestore() }
  })

  it.each(['edit', 'save', 'reload', 'node-switch', 'dispose'])('rejects held markers across %s', async (action) => {
    const mounted = mount()
    const view = await editor(mounted.host)
    let release!: () => void
    lineMarkers.mockImplementationOnce((_task, _path, revision) => new Promise((resolve) => {
      release = () => resolve({ revision, markers: [{ kind: 'pull-request', ranges: [{ from: 1, to: 1 }] }] })
    }))
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    await vi.waitFor(() => expect(release).toBeDefined())
    if (action === 'dispose') mounted.unmount()
    else if (action === 'node-switch') setActiveNode('other-node')
    else if (action === 'reload') {
      disk.set('a.ts', 'external body\n')
      lineMarkers.mockResolvedValueOnce({ revision: '', markers: [] })
      window.dispatchEvent(new Event('focus'))
      await showing(() => view, 'external body')
    } else {
      view.dispatch({ changes: { from: 0, insert: '// typed\n' } })
      if (action === 'save') {
        lineMarkers.mockResolvedValueOnce({ revision: '', markers: [] })
        saveChord(view)
        await vi.waitFor(() => expect(openFiles(taskId)[0]?.dirty).toBe(false))
      }
    }
    release()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mounted.host.querySelector('.cm-line-pull-request')).toBeNull()
  })


  it('retires superseded previews and held reads without losing a promoted tab', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    for (let i = 0; i < 24; i++) {
      disk.set(`preview-${i}.txt`, `preview ${i}`)
      editorOpen(taskId, `preview-${i}.txt`, true)
      await showing(() => view, `preview ${i}`)
    }
    expect(openFiles(taskId).map((file) => file.path)).toEqual(['a.ts', 'preview-23.txt'])
    expect(editorViewState(taskId, 'preview-0.txt')).toBeUndefined()
    let resolve!: (text: string) => void
    read.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    editorOpen(taskId, 'discarded.txt', true)
    await vi.waitFor(() => expect(resolve).toBeDefined())
    editorOpen(taskId, 'b.ts', true)
    await showing(() => view, 'const b = 2')
    resolve('discarded response')
    await Promise.resolve()
    expect(openFiles(taskId).some((file) => file.path === 'discarded.txt')).toBe(false)
    expect(view.state.doc.toString()).toContain('const b = 2')
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
  })

  it('restores dirty text, undo, and cursor after model retirement and failed persistence', async () => {
    const first = mount()
    const view = await editor(first.host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')
    view.dispatch({ changes: { from: 0, insert: '// recovery\n' }, selection: { anchor: 5 } })
    write.mockRejectedValue(new Error('offline'))
    const { paneModel } = await import('@acorn/plugin-api/client')
    paneModel('editor', 'other-task', () => ({}))
    first.unmount()
    await Promise.resolve()
    read.mockRejectedValue(new Error('still offline'))
    const second = mount(true)
    const reopened = await editor(second.host)
    await showing(() => reopened, '// recovery')
    expect(reopened.state.selection.main.anchor).toBe(5)
    reopened.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true, bubbles: true }))
    await vi.waitFor(() => expect(reopened.state.doc.toString()).not.toContain('// recovery'))
  })

  it('uses the shared collapse control and keeps the sidebar panels mounted in an empty rail', async () => {
    const { host } = mount()
    await editor(host)
    const sidebar = host.querySelector<HTMLElement>('.ui-listdetail-list')!
    const tree = host.querySelector<HTMLElement>('[data-testid="file-tree-selection"]')!
    const toggle = host.querySelector<HTMLButtonElement>('.ui-listdetail-edge .ui-btn')!

    toggle.click()
    expect(host.querySelector<HTMLElement>('.ui-listdetail')?.dataset.list).toBe('collapsed')
    expect(sidebar.style.visibility).toBe('hidden')
    expect(sidebar.querySelector('[data-testid="file-tree-selection"]')).toBe(tree)

    toggle.click()
    expect(host.querySelector<HTMLElement>('.ui-listdetail')?.dataset.list).toBe('default')
    expect(sidebar.style.visibility).toBe('')
    expect(sidebar.querySelector('[data-testid="file-tree-selection"]')).toBe(tree)
  })

  it('draws independent adjacent markers for PR and uncommitted lines', async () => {
    const { host } = mount()
    const view = await editor(host)
    editorOpen(taskId, 'a.ts', false)
    await showing(() => view, 'const a = 1')

    await vi.waitFor(() => {
      const firstLine = view.contentDOM.querySelector('.cm-line')
      expect(firstLine?.classList.contains('cm-line-pull-request')).toBe(true)
      expect(firstLine?.classList.contains('cm-line-uncommitted')).toBe(true)
    })
  })

  it('selects a tab and its file-tree row before the document read finishes', async () => {
    editorOpen(taskId, 'a.ts', false)
    editorOpen(taskId, 'b.ts', false)
    let releaseRead!: (content: string) => void
    read.mockImplementation(async (_taskId, path) => {
      if (path !== 'a.ts') return disk.get(path) ?? ''
      return new Promise<string>((resolve) => { releaseRead = resolve })
    })

    const { host } = mount()
    const view = await editor(host)
    await showing(() => view, 'const b = 2')

    const tab = document.getElementById('editor-tab-a.ts') as HTMLButtonElement
    tab.click()

    expect(openFiles(taskId).find((file) => file.path === 'a.ts')).toBeTruthy()
    expect(host.querySelector('[data-testid="file-tree-selection"]')?.textContent).toBe('a.ts')
    await vi.waitFor(() => expect(document.getElementById('editor-tab-a.ts')?.getAttribute('aria-selected')).toBe('true'))

    releaseRead('const a = 1\n')
    await showing(() => view, 'const a = 1')
    read.mockImplementation(async (_taskId, path) => disk.get(path) ?? '')
  })

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

  it('shows image bytes in the same tabs without reading or saving them as text', async () => {
    const createObjectURL = vi.fn(() => 'blob:editor-image')
    const revokeObjectURL = vi.fn()
    const oldCreate = URL.createObjectURL
    const oldRevoke = URL.revokeObjectURL
    let unmount = () => {}
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    try {
      const pane = mount()
      const { host } = pane
      unmount = pane.unmount
      const view = await editor(host)
      editorOpen(taskId, 'a.ts', false)
      await showing(() => view, 'const a = 1')

      editorOpen(taskId, 'sub/photo.webp', false)
      await vi.waitFor(() => expect(host.querySelector('img[alt="photo.webp"]')?.getAttribute('src')).toBe('blob:editor-image'))
      expect(host.querySelector('.cm-editor')).toBeNull()
      expect(host.querySelector('img')!.compareDocumentPosition(host.querySelector('[aria-label="File status"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(host.querySelector('[aria-label="File status"]')?.textContent).toContain('Read-only preview')
      expect(host.querySelector('[aria-label="File status"]')?.textContent).not.toContain('Ln 1')
      expect(readImage).toHaveBeenCalledWith(taskId, 'sub/photo.webp')
      expect(read).not.toHaveBeenCalledWith(taskId, 'sub/photo.webp')
      expect(write).not.toHaveBeenCalledWith(taskId, 'sub/photo.webp', expect.anything())

      editorOpen(taskId, 'a.ts', false)
      await showing(() => EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-editor')!)!, 'const a = 1')
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:editor-image')
    } finally {
      unmount()
      URL.createObjectURL = oldCreate
      URL.revokeObjectURL = oldRevoke
    }
  })

  // The `editor:document` point (docs/editor/file-renderers.md): a compiled contributor stands in for
  // the text, the Source toggle brings CodeMirror back with the same buffer, and the contributor sees
  // that buffer, unsaved edits included, when the reader returns to it.
  it('lets another plugin draw a file and keeps the source one toggle away', async () => {
    disk.set('README.md', '# Hello\n')
    const drawn: EditorDocumentProps[] = []
    const Preview = (props: EditorDocumentProps) => {
      drawn.push({ ...props })
      return <p data-testid="preview">{props.text}@{props.revision}</p>
    }
    const registrations = [
      extensionPointRegistry.register({ id: EDITOR_DOCUMENT_POINT, ownerId: 'editor', label: 'Editor document', kind: 'remote', mode: 'replace', max: 1 }),
      extensionRegistry.register({
        id: 'plugin:markdown:document', pluginId: 'markdown', point: EDITOR_DOCUMENT_POINT, label: 'Markdown preview',
        order: 500, carrier: 'component', component: Preview, matches: ['*.md'],
      } as ExtensionContribution),
    ]
    try {
      const { host } = mount()
      await editor(host)
      const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-label="Preview"]')
      expect(toggle()).toBeNull() // no file open, nothing to preview

      editorOpen(taskId, 'README.md', false)
      await vi.waitFor(() => expect(host.querySelector('[data-testid="preview"]')?.textContent).toBe('# Hello\n@1'))
      expect(drawn.at(-1)).toMatchObject({ taskId, path: 'README.md' })
      expect(host.querySelector('.cm-editor')).toBeNull()
      expect(toggle()?.getAttribute('aria-pressed')).toBe('true')
      expect(host.querySelector('[aria-label="File status"]')?.textContent).toContain('Read-only preview')

      toggle()!.click()
      const view = await editor(host)
      await showing(() => view, '# Hello')
      expect(host.querySelector('[data-testid="preview"]')).toBeNull()
      write.mockImplementation(async () => new Promise(() => {})) // hold the save, so the buffer stays dirty
      view.dispatch({ changes: { from: view.state.doc.length, insert: 'more\n' } })

      toggle()!.click()
      await vi.waitFor(() => expect(host.querySelector('[data-testid="preview"]')?.textContent).toBe('# Hello\nmore\n@2'))
      expect(disk.get('README.md')).toBe('# Hello\n')

      // Files the contributor didn't claim keep the pane's own view and no toggle.
      editorOpen(taskId, 'a.ts', false)
      await showing(() => EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-editor')!)!, 'const a = 1')
      expect(toggle()).toBeNull()

      // Two contributors for one key and no pick in settings: the pane's own view draws.
      registrations.push(extensionRegistry.register({
        id: 'plugin:other:document', pluginId: 'other', point: EDITOR_DOCUMENT_POINT, label: 'Other preview',
        order: 500, carrier: 'component', component: Preview, matches: ['readme.md'],
      } as ExtensionContribution))
      editorActivate(taskId, 'README.md')
      await showing(() => EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-editor')!)!, 'more')
      expect(host.querySelector('[data-testid="preview"]')).toBeNull()
    } finally {
      for (const registration of registrations.reverse()) registration.dispose()
    }
  })

  // A handover read that finishes after the reader switched nodes belongs to the old node's worktree.
  it('drops a document handover that lands after a node switch', async () => {
    disk.set('NOTES.md', '# Old node\n')
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    read.mockImplementation(async (_taskId, path) => {
      if (path === 'NOTES.md') await held
      return disk.get(path) ?? ''
    })
    const drawn: EditorDocumentProps[] = []
    const Preview = (props: EditorDocumentProps) => {
      drawn.push({ ...props })
      return <p data-testid="preview">{props.text}</p>
    }
    const registrations = [
      extensionPointRegistry.register({ id: EDITOR_DOCUMENT_POINT, ownerId: 'editor', label: 'Editor document', kind: 'remote', mode: 'replace', max: 1 }),
      extensionRegistry.register({
        id: 'plugin:markdown:document', pluginId: 'markdown', point: EDITOR_DOCUMENT_POINT, label: 'Markdown preview',
        order: 500, carrier: 'component', component: Preview, matches: ['*.md'],
      } as ExtensionContribution),
    ]
    try {
      const { host } = mount()
      await editor(host)
      editorOpen(taskId, 'NOTES.md', false)
      await vi.waitFor(() => expect(read).toHaveBeenCalledWith(taskId, 'NOTES.md'))
      setActiveNode('other-node')
      release()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(drawn).toEqual([])
      expect(host.querySelector('[data-testid="preview"]')).toBeNull()
    } finally {
      for (const registration of registrations.reverse()) registration.dispose()
    }
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
    expect(rectangle(host, 'pty')!.compareDocumentPosition(host.querySelector('[aria-label="File status"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(host.querySelector('[aria-label="File status"]')?.textContent).toContain('External editor')
    expect(host.querySelector('[aria-label="File status"]')?.textContent).not.toContain('Saved')

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
  // out beside it (docs/editor/editor-pane.md § One round trip to text).
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

  it('discards a remembered-file read when navigation unmounts the pane', async () => {
    editorOpen(taskId, 'a.ts', false)
    let releaseRead!: (content: string) => void
    read.mockImplementationOnce(() => new Promise<string>((resolve) => { releaseRead = resolve }))

    const first = mount()
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    first.unmount()

    // A new mount must own a new read. Sharing the old mount's in-flight promise would let that
    // invisible mount build CodeMirror state and syntax extensions after navigation had removed it.
    const second = mount(true)
    try {
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2), { timeout: 200 })
    } finally {
      releaseRead('const stale = true\n')
    }

    const reopened = await editor(second.host)
    await showing(() => reopened, 'const a = 1')
    expect(reopened.state.doc.toString()).not.toContain('stale')
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

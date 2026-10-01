// Characterization only: the production EditorPane, CodeMirror, stores and pane pool are imported.
// Worktree transport and unrelated sidebar panels are synthetic. Use ACORN_PERF_TAG (default sample).
import { render } from 'solid-js/web'
import { afterEach, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { EditorView } from '@codemirror/view'
import { writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { paneModel, _resetPaneModels } from '../../packages/client-core/src/host/registries/panes/paneModels'
import { prefsKey } from '@acorn/protocol/api.ts'

Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
const api = vi.hoisted(() => ({
  read: vi.fn(async (_task: string, path: string) => `baseline ${path}\n`),
  write: vi.fn(async (_task: string, _path: string, _text: string) => ({ ok: true, reason: undefined as string | undefined })),
  markers: vi.fn(async (_task: string, _path: string) => []),
}))
vi.mock('../../plugins/editor/src/client/editorClient', async original => ({
  ...await original<typeof import('../../plugins/editor/src/client/editorClient')>(),
  editorApi: () => ({ root: async () => '/synthetic', list: async () => [], files: async () => [],
    read: api.read, write: api.write, lineMarkers: api.markers }),
}))
vi.mock('../../plugins/editor/src/client/FileTree', () => ({ default: () => null }))
vi.mock('../../plugins/editor/src/client/search/SearchPanel', () => ({ default: () => null }))
const { default: EditorPane } = await import('../../plugins/editor/src/client/EditorPane')
const store = await import('../../plugins/editor/src/client/editorState')
const tag = process.env.ACORN_PERF_TAG ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')
const record = (name: string, value: unknown) => {
  const path = join(dirname(fileURLToPath(import.meta.url)), `12-${name}-${tag}.json`)
  if (tag.startsWith('before') && existsSync(path)) throw new Error('Before evidence exists; use a new tag.')
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}
let serial = 0
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).reverse().forEach(fn => fn())
  _resetPaneModels(); store.clearEditorStates()
  api.read.mockReset().mockImplementation(async (_task, path) => `baseline ${path}\n`)
  api.write.mockReset().mockResolvedValue({ ok: true, reason: undefined })
  api.markers.mockClear()
})
const mount = () => {
  const task = `editor-${++serial}`
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  qc.setQueryData(prefsKey, {})
  const host = document.createElement('div'); document.body.append(host)
  const stop = render(() => <QueryClientProvider client={qc}><EditorPane task={{ id: task } as any} /></QueryClientProvider>, host)
  cleanups.push(() => { stop(); host.remove(); qc.clear() })
  return { task, host, stop }
}
const viewFor = (host: HTMLElement) => vi.waitFor(() => {
  const dom = host.querySelector<HTMLElement>('.cm-editor')
  const view = dom && EditorView.findFromDOM(dom)
  if (!view) throw new Error('No editor yet')
  return view
})
const show = async (task: string, view: EditorView, path: string, ephemeral = false, needle = `baseline ${path}`) => {
  store.editorOpen(task, path, ephemeral)
  await vi.waitFor(() => { if (!view.state.doc.toString().includes(needle)) throw new Error('File has not arrived') })
}
const saveChord = (view: EditorView) => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
  key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true,
}))
const poolFor = (task: string) => paneModel<any>('editor', task, () => { throw new Error('No production pool') })
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

it('measures clean preview replacement retained by the actual pane pool', async () => {
  const { task, host, stop } = mount(); const view = await viewFor(host)
  const count = 24, charsPerFile = 64 * 1024
  api.read.mockImplementation(async (_task, path) => `baseline ${path}\n` + 'synthetic row\n'.repeat(5200).slice(0, charsPerFile))
  const cpu = process.cpuUsage()
  for (let i = 0; i < count; i++) await show(task, view, `preview-${i}.txt`, true)
  const pool = poolFor(task)
  const beforeUnmount = { openTabs: store.openFiles(task).length, pooledFiles: pool.files.size, savedDocuments: pool.saved.size,
    retainedCharacters: [...pool.files.values()].reduce((n: number, value: any) => n + value.state.doc.length, 0), reads: api.read.mock.calls.length }
  stop()
  const afterUnmount = { pooledFiles: pool.files.size, savedDocuments: pool.saved.size, openTabs: store.openFiles(task).length }
  const used = process.cpuUsage(cpu)
  record('preview-retention', { fixture: '24 sequential clean previews, actual EditorPane and CodeMirror in jsdom; pool strong-reference counts', count, charsPerFile,
    beforeUnmount, afterUnmount, nodeCpuMs: (used.user + used.system) / 1000,
    expected: 'Superseded clean previews do not remain in the document/saved pool; kept and dirty tabs retain content/history.' })
})

it('characterizes a focus reload finishing after the user starts editing', async () => {
  const { task, host } = mount(); const view = await viewFor(host)
  await show(task, view, 'a.txt')
  let release!: (text: string) => void
  api.read.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve }))
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => { if (!release) throw new Error('Reload not started') })
  view.dispatch({ changes: { from: 0, insert: 'UNSENT HUMAN EDIT\n' } })
  const before = { text: view.state.doc.toString(), dirty: store.openFiles(task)[0]?.dirty }
  release('EXTERNAL DISK REVISION\n')
  await settle()
  const after = { text: view.state.doc.toString(), dirty: store.openFiles(task)[0]?.dirty }
  view.contentDOM.dispatchEvent(new Event('blur', { bubbles: true }))
  await vi.waitFor(() => { if (!api.write.mock.calls.length) throw new Error('No pending autosave') })
  record('focus-read-race', { fixture: 'real focus listener, held synthetic read, real typing transaction', before, after,
    subsequentlyWritten: api.write.mock.calls.map(call => call[2]), expected: 'Reload rechecks document revision/dirty status before applying and preserves the human edit.' })
})

it('characterizes dirty tab close after a refused save', async () => {
  const { task, host } = mount(); const view = await viewFor(host)
  await show(task, view, 'a.txt')
  view.dispatch({ changes: { from: 0, insert: 'UNSENT HUMAN EDIT\n' } })
  api.write.mockResolvedValue({ ok: false, reason: 'Synthetic offline/refusal' })
  host.querySelector<HTMLButtonElement>('[aria-label="Close a.txt"]')!.click()
  await vi.waitFor(() => { if (!api.write.mock.calls.length) throw new Error('Save not started') })
  await settle()
  const pool = poolFor(task)
  record('failed-close', { fixture: 'actual DocumentTabs close handler; write returns {ok:false}', writeText: api.write.mock.calls[0]?.[2],
    remainingTabs: store.openFiles(task), pooledFiles: pool.files.size, savedDocuments: pool.saved.size, visibleDocument: view.state.doc.toString(),
    displayedError: host.textContent?.includes('Synthetic offline/refusal'), expected: 'A failed close retains the dirty tab and full buffer for retry or explicit discard.' })
})

it('characterizes overlapping saves completing in reverse order', async () => {
  const { task, host } = mount(); const view = await viewFor(host)
  await show(task, view, 'a.txt')
  const pending: { text: string; resolve: (v: { ok: boolean }) => void }[] = []
  let disk = 'baseline a.txt\n'
  api.write.mockImplementation((_task, _path, text) => new Promise(resolve => { pending.push({ text, resolve: value => { disk = text; resolve(value as any) } }) }))
  view.dispatch({ changes: { from: 0, insert: 'FIRST\n' } }); saveChord(view)
  view.dispatch({ changes: { from: 0, insert: 'SECOND\n' } }); saveChord(view)
  await vi.waitFor(() => { if (!pending.length) throw new Error('Save not started') })
  const initialPending = pending.length
  if (initialPending === 2) {
    pending[1]!.resolve({ ok: true }); await settle()
    pending[0]!.resolve({ ok: true }); await settle()
  } else {
    pending[0]!.resolve({ ok: true }); await settle()
    if (pending[1]) pending[1].resolve({ ok: true })
    await settle()
  }
  record('save-order', { fixture: 'actual save chord, two held transport writes with reverse completion', sends: pending.map(p => p.text), disk,
    initialPending, visible: view.state.doc.toString(), dirty: store.openFiles(task)[0]?.dirty, expected: 'Per-document write admission preserves the latest document on disk and waits for custody before discard.' })
})

it('characterizes marker refresh and decorations for a dirty edited document', async () => {
  const { task, host } = mount(); const view = await viewFor(host)
  await show(task, view, 'a.txt')
  let release!: (value: any) => void
  api.markers.mockImplementationOnce(() => new Promise<any>(resolve => { release = resolve }))
  saveChord(view)
  await vi.waitFor(() => { if (!release) throw new Error('Marker refresh not started') })
  view.dispatch({ changes: { from: 0, insert: 'UNSENT NEW FIRST LINE\n' } })
  release([{ kind: 'uncommitted', ranges: [{ from: 1, to: 1 }] }])
  await settle()
  record('marker-revision', { fixture: 'actual save-triggered refresh; marker ranges refer to disk line 1, edit inserts a first line while response is pending',
    markedLineText: view.contentDOM.querySelector('.cm-line-uncommitted')?.textContent, visible: view.state.doc.toString(),
    expected: 'A disk range is versioned and mapped to its loaded document revision, or rejected while unsaved text diverges.' })
})

it('records failed reads becoming an editable saved empty document', async () => {
  const { task, host } = mount(); const view = await viewFor(host)
  api.read.mockRejectedValueOnce(new Error('Synthetic unsupported body/offline'))
  store.editorOpen(task, 'unreadable.txt', false)
  await settle()
  const pool = poolFor(task)
  const afterRead = { emptyEditableDocument: view.state.doc.length === 0 && !view.state.readOnly,
    pooled: pool.files.has('unreadable.txt'), saved: pool.saved.has('unreadable.txt'), visibleError: host.textContent?.includes('Synthetic unsupported') }
  view.dispatch({ changes: { from: 0, insert: 'TYPED AFTER FAILED READ\n' } })
  saveChord(view); await settle()
  record('failed-read', { fixture: 'actual readFile catch branch; transport rejects unsupported/offline body', afterRead,
    writeText: api.write.mock.calls[0]?.[2], expected: 'Read failure is an error, never an empty successful editable file; retain a previous usable buffer and reject save until custody is known.' })
})

it('records text availability behind optional pending marker reads', async () => {
  const { task, host } = mount(); const view = await viewFor(host)
  let release!: (value: any) => void, textReady = false
  api.read.mockImplementationOnce(async () => { textReady = true; return 'READY FILE TEXT\n' })
  api.markers.mockImplementationOnce(() => new Promise<any>(resolve => { release = resolve }))
  store.editorOpen(task, 'marked.txt', false)
  await settle()
  const beforeMarkers = { textReady, visible: view.state.doc.toString(), pooledFiles: poolFor(task).files.size, readOnly: view.state.readOnly }
  release([]); await settle()
  record('marker-gate', { fixture: 'actual readFile Promise.all, immediate text and grammar, held optional marker response', beforeMarkers,
    afterMarkers: { visible: view.state.doc.toString(), pooledFiles: poolFor(task).files.size }, expected: 'Optional marker work does not gate usable document text and is applied only to a matching revision.' })
})

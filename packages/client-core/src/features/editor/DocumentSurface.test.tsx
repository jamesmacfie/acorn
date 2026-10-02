import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentCompletions, startCompletion } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import type { PluginDocumentRegion } from '@acorn/protocol/api.ts'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { MAX_DOCUMENT_BYTES } from '@acorn/protocol/plugin/bridge.ts'
import type { DocumentHandle } from './documentModel'

// The two things this surface does that nothing else does: it asks a plugin for completions and it
// resolves a host chord that the shell's window dispatcher cannot see, because focus is inside a
// typing target. Both are behaviour, not rendering, and both would have gone unnoticed under an
// engine change.

// jsdom does no layout, so a Range cannot report rectangles and CodeMirror measures selections.
Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

const posted = vi.fn()
const exported = vi.fn(async (_request: unknown) => true)
let loadedText = 'select  from users'
vi.mock('../../infra/platform', async (importOriginal) => ({ ...await importOriginal<typeof import('../../infra/platform')>(), saveFile: (request: unknown) => exported(request) }))
let saveResponse: () => Promise<unknown> = async () => ({})
vi.mock('../../infra/node/apiClient', () => ({
  readJson: async () => ({ text: loadedText }),
  writeJson: async (path: string, init: { body?: string }) => {
    posted(path, init.body)
    if (!path.endsWith('/complete')) return saveResponse()
    return { items: [{ label: 'user_id', kind: 'field', detail: 'integer' }, { label: 42 }, {}] }
  },
}))

const { default: DocumentSurface } = await import('./DocumentSurface')
const { registerCommands } = await import('../../host/registries/commands/commands')
const { registerKeybindings } = await import('../../host/registries/commands/keybindings')

const region = (extra?: Partial<PluginDocumentRegion>): PluginDocumentRegion => ({
  languageId: 'sql',
  read: '/v1/p/db/tasks/:taskId/doc',
  write: '/v1/p/db/tasks/:taskId/doc',
  ...extra,
} as PluginDocumentRegion)

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose())
  posted.mockClear()
  exported.mockClear()
  loadedText = 'select  from users'
  saveResponse = async () => ({})
})

let serial = 0
const mount = (regionValue: PluginDocumentRegion, onHandle?: (handle: DocumentHandle | null) => void, taskId = `document-${++serial}`, nodeId = 'node-a') => {
  const host = document.createElement('div')
  document.body.append(host)
  cleanups.push(render(() => (
    <QueryClientProvider client={new QueryClient()}><DocumentSurface
      pluginId="database"
      surfaceId="db"
      nodeId={nodeId}
      region={regionValue}
      scope={{ taskId }}
      onHandle={onHandle}
    /></QueryClientProvider>
  ), host))
  cleanups.push(() => host.remove())
  return host
}

const editor = async (host: HTMLElement): Promise<EditorView> =>
  vi.waitFor(() => {
    const dom = host.querySelector<HTMLElement>('.cm-editor')
    const view = dom && EditorView.findFromDOM(dom)
    if (!view) throw new Error('no editor yet')
    return view
  })

describe('the host-owned document surface', () => {
  it('keeps both flushes pending and prevents a command from running after persistence fails', async () => {
    let handle: DocumentHandle | null = null
    const host = mount(region(), (value) => { handle = value })
    const view = await editor(host)
    await vi.waitFor(() => expect(handle).not.toBeNull())
    let reject!: (error: Error) => void
    saveResponse = () => new Promise((_resolve, fail) => { reject = fail })
    view.dispatch({ changes: { from: 0, insert: '-- dirty\n' } })
    const ran = vi.fn()
    const first = handle!.flush().then(ran, () => {})
    let settled = false
    const second = handle!.flush().then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(posted).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    expect(ran).not.toHaveBeenCalled()
    reject(new Error('offline'))
    await Promise.all([first, second])
    expect(ran).not.toHaveBeenCalled()
    expect(host.textContent).toContain('offline')
    expect(view.state.doc.toString()).toContain('-- dirty')
    saveResponse = async () => ({})
    await handle!.flush()
    expect(posted).toHaveBeenCalledTimes(2)
  })

  it('retains failed text and undo on remount while revoking the retired handle', async () => {
    const task = `recovery-${++serial}`
    let handle: DocumentHandle | null = null
    const first = mount(region(), (value) => { handle = value }, task)
    const view = await editor(first)
    await vi.waitFor(() => expect(handle).not.toBeNull())
    view.dispatch({ changes: { from: 0, insert: '-- recovery\n' }, selection: { anchor: 4 } })
    saveResponse = async () => { throw new Error('refused') }
    const retired = handle!
    await expect(retired.flush()).rejects.toThrow('refused')
    cleanups.splice(0).forEach((dispose) => dispose())
    await Promise.resolve()
    expect(() => retired.write('redirected')).toThrow('retired')
    await expect(retired.flush()).rejects.toThrow('retired')
    const second = mount(region(), (value) => { handle = value }, task)
    const reopened = await editor(second)
    expect(reopened.state.doc.toString()).toContain('-- recovery')
    expect(reopened.state.selection.main.anchor).toBe(4)
    reopened.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true, bubbles: true }))
    await vi.waitFor(() => expect(reopened.state.doc.toString()).not.toContain('-- recovery'))
    saveResponse = async () => ({})
  })

  it('offers the items the plugin\'s completion route returned', async () => {
    const view = await editor(mount(region({ completions: { route: '/v1/p/db/tasks/:taskId/complete' } })))
    // Between `select ` and ` from`, which is where a reader asks for a column.
    view.dispatch({ selection: { anchor: 7 } })
    startCompletion(view)

    await vi.waitFor(() => expect(currentCompletions(view.state).length).toBeGreaterThan(0))
    const options = currentCompletions(view.state)
    const plugin = options.find((option) => option.label === 'user_id')
    expect(plugin?.detail).toBe('integer')
    // The two malformed rows are dropped rather than believed, because route output is bytes a node
    // sent. Only the good one survives, and it sits beside the SQL grammar's own keywords — two
    // sources on one document, which is the arrangement Monaco's per-language registry could not have.
    expect(options.filter((option) => option.label === 'user_id')).toHaveLength(1)
    expect(options.some((option) => option.detail === undefined && option.label === '42')).toBe(false)
    // The route was told where the cursor is, in one-based line and column.
    const body = posted.mock.calls.find(([path]) => String(path).endsWith('/complete'))?.[1]
    expect(JSON.parse(String(body)).position).toEqual({ line: 1, column: 8 })
  })

  it('runs a pane-scoped host chord pressed inside the editor, after flushing the document', async () => {
    const ran = vi.fn()
    cleanups.push(() => registered.dispose())
    cleanups.push(() => bound.dispose())
    const registered = registerCommands([{ id: 'database.execute', title: 'Run query', category: 'pane', run: ran }])
    const bound = registerKeybindings([{
      id: 'database.execute', command: 'database.execute', description: 'Run query', category: 'pane',
      defaultChord: 'meta+enter', when: 'pane', pane: 'db',
      plugin: { id: 'database', name: 'Database', installedAt: () => 0, state: () => 'enabled' },
    }])

    const view = await editor(mount(region()))
    view.dispatch({ changes: { from: 0, insert: '-- edited\n' } })
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, metaKey: true, bubbles: true }))

    await vi.waitFor(() => expect(ran).toHaveBeenCalled())
    // Flush first, then run: the action never fires against a stale document.
    const written = posted.mock.calls.find(([path]) => !String(path).endsWith('/complete'))?.[1]
    expect(JSON.parse(String(written)).text).toContain('-- edited')
    expect(posted.mock.invocationCallOrder[0]).toBeLessThan(ran.mock.invocationCallOrder[0])
  })
})

// Complete text is compared here; a short fixture cannot expose the byte/character mismatch.
it('exports a legacy oversized document without mounting an editable or empty document', async () => {
  loadedText = 'é'.repeat(MAX_DOCUMENT_BYTES)
  const handle = vi.fn()
  const host = mount(region(), handle)
  await vi.waitFor(() => expect(host.textContent).toContain('exceeds 2 MiB'))
  expect(host.querySelector('.cm-editor')).toBeNull()
  expect(handle).not.toHaveBeenCalled()
  const button = Array.from(host.querySelectorAll('button')).find((entry) => entry.textContent === 'Export full text')!
  button.click()
  await vi.waitFor(() => expect(exported).toHaveBeenCalledOnce())
  const request = exported.mock.calls[0][0] as { bytes: Uint8Array }
  expect(new TextDecoder().decode(request.bytes)).toBe(loadedText)
  expect(request.bytes.byteLength).toBe(2 * MAX_DOCUMENT_BYTES)
  expect(posted).not.toHaveBeenCalled()
})

it('recovers a complete oversized dirty draft and undo only on its originating Node', async () => {
  const task = `oversized-recovery-${++serial}`
  let handle: DocumentHandle | null = null
  const first = mount(region(), (next) => { handle = next }, task)
  const view = await editor(first)
  const initial = view.state.doc.toString()
  const text = '😀'.repeat(MAX_DOCUMENT_BYTES / 4) + 'x'
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  const retired = handle!
  await expect(retired.flush()).rejects.toThrow('full text is retained')
  expect(retired.read()).toBe(text)
  expect(posted).not.toHaveBeenCalled()
  cleanups.splice(0).forEach((dispose) => dispose())
  expect(() => retired.read()).toThrow('retired')
  const other = await editor(mount(region(), undefined, task, 'node-b'))
  expect(other.state.doc.toString()).toBe(initial)
  const reopened = await editor(mount(region(), (next) => { handle = next }, task))
  expect(reopened.state.doc.toString()).toBe(text)
  await expect(handle!.flush()).rejects.toThrow('full text is retained')
  reopened.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true, bubbles: true }))
  await vi.waitFor(() => expect(reopened.state.doc.toString()).toBe(initial))
})

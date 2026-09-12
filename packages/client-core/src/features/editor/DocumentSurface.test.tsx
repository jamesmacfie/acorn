import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentCompletions, startCompletion } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import type { PluginDocumentRegion } from '@acorn/protocol/api.ts'

// The two things this surface does that nothing else does: it asks a plugin for completions and it
// resolves a host chord that the shell's window dispatcher cannot see, because focus is inside a
// typing target. Both are behaviour, not rendering, and both would have gone unnoticed under an
// engine change.

// jsdom does no layout, so a Range cannot report rectangles and CodeMirror measures selections.
Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

vi.mock('@tanstack/solid-query', () => ({ useQueryClient: () => ({ getQueryData: () => ({}) }) }))

const posted = vi.fn()
vi.mock('../../infra/node/apiClient', () => ({
  readJson: async () => ({ text: 'select  from users' }),
  writeJson: async (path: string, init: { body?: string }) => {
    posted(path, init.body)
    if (!path.endsWith('/complete')) return {}
    return { items: [{ label: 'user_id', kind: 'field', detail: 'integer' }, { label: 42 }, {}] }
  },
}))

const { default: DocumentSurface } = await import('./DocumentSurface')
const { registerCommands } = await import('../../host/registries/commands/commands')
const { registerKeybindings } = await import('../../host/registries/commands/keybindings')

const region = (extra?: Partial<PluginDocumentRegion>): PluginDocumentRegion => ({
  languageId: 'sql',
  read: '/v2/p/db/tasks/:taskId/doc',
  write: '/v2/p/db/tasks/:taskId/doc',
  ...extra,
} as PluginDocumentRegion)

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose())
  posted.mockClear()
})

const mount = (regionValue: PluginDocumentRegion) => {
  const host = document.createElement('div')
  document.body.append(host)
  cleanups.push(render(() => (
    <DocumentSurface
      pluginId="database"
      surfaceId="db"
      nodeId="node-a"
      region={regionValue}
      scope={{ taskId: 't1' }}
    />
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
  it('offers the items the plugin\'s completion route returned', async () => {
    const view = await editor(mount(region({ completions: { route: '/v2/p/db/tasks/:taskId/complete' } })))
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

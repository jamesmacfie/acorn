import { expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prefsKey } from '@acorn/protocol/api.ts'
import { renderCells } from '../../apps/tui/src/kit/render'
import { paneModel, _resetPaneModels } from '../../packages/client-core/src/host/registries/panes/paneModels'
import { clearEditorStates, editorOpen } from '../../plugins/editor/src/client/editorState'

const synthetic = vi.hoisted(() => ({ reads: 0, roots: 0, ptyOpens: 0, ptyCloses: 0, engineImports: 0, markers: 0, body: 'Synthetic file\n'.repeat(100000) }))
vi.mock('../../plugins/editor/src/client/editorClient', async original => ({
  ...await original<typeof import('../../plugins/editor/src/client/editorClient')>(),
  editorApi: () => ({ root: async () => { synthetic.roots++; return '/synthetic' }, list: async () => [], files: async () => [],
    read: async () => { synthetic.reads++; return synthetic.body },
    lineMarkers: async () => { synthetic.markers++; return [] }, write: async () => ({ ok: true }) }),
}))
vi.mock('../../plugins/editor/src/client/FileTree', () => ({ default: () => null }))
vi.mock('../../plugins/editor/src/client/search/SearchPanel', () => ({ default: () => null }))
vi.mock('../../plugins/editor/src/client/editorEngine', () => { synthetic.engineImports++; throw new Error('Graphical engine admitted by terminal host') })
vi.mock('../../plugins/editor/src/client/wsChannel', () => ({
  wsEditorPtyOpen: (_id: string, _task: string, _path: string, _cols: number, _rows: number, cb: (event: { kind: 'out'; data: string }) => void) => {
    synthetic.ptyOpens++; cb({ kind: 'out', data: 'Terminal editor fixture' }); return () => { synthetic.ptyCloses++ }
  }, wsEditorPtyInput: () => {}, wsEditorPtyResize: () => {},
}))
const { default: EditorPane } = await import('../../plugins/editor/src/client/EditorPane')

it('characterizes remembered file warmup on the real terminal editor host', async () => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Unsafe output tag')
  const path = join(dirname(fileURLToPath(import.meta.url)), `unit17-tui-${tag}.json`)
  if (tag.startsWith('before') && existsSync(path)) throw new Error('Before evidence exists')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  qc.setQueryData(prefsKey, {})
  const task = 'terminal-editor-warmup'
  editorOpen(task, 'remembered.txt', false)
  const cpu = process.cpuUsage(), started = performance.now()
  const cells = await renderCells(() => <QueryClientProvider client={qc}><EditorPane task={{ id: task } as any} /></QueryClientProvider>, { width: 80, height: 24 })
  try {
    await vi.waitFor(() => expect(synthetic.roots).toBe(1))
    expect(cells.text).toContain('remembered')
    expect(synthetic.reads).toBe(0)
    expect(synthetic.engineImports).toBe(0)
    await new Promise(resolve => setTimeout(resolve, 20))
    const pool = paneModel<any>('editor', task, () => { throw new Error('Missing actual pool') })
    expect(pool.files.size).toBe(0)
    expect(pool.saved.size).toBe(0)
    const used = process.cpuUsage(cpu)
    const value = { fixture: 'Actual EditorPane under universal terminal kit, one remembered 1.5M-character file, no graphical EditorView or PTY launched',
      engineImports: synthetic.engineImports, rootReads: synthetic.roots, reads: synthetic.reads, markerReads: synthetic.markers, pooledFiles: pool.files.size, savedDocuments: pool.saved.size,
      characters: [...pool.files.values()].reduce((n: number, entry: any) => n + entry.state.doc.length, 0),
      terminalFrame: cells.text, wallMs: performance.now() - started, cpuMs: (used.user + used.system) / 1000 }
    cells.done()
    Object.assign(value, { pooledFilesAfterUnmount: pool.files.size })
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
  } finally { cells.done(); qc.clear(); _resetPaneModels(); clearEditorStates() }
})

it('keeps the real terminal editor rectangle and channel available without graphical state', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  const { saveEditorMode } = await import('../../plugins/editor/src/client/editorPrefs')
  await saveEditorMode(qc, 'terminal')
  const task = 'terminal-editor-channel'
  editorOpen(task, 'terminal.txt', false)
  const cells = await renderCells(() => <QueryClientProvider client={qc}><EditorPane task={{ id: task } as any} /></QueryClientProvider>, { width: 80, height: 24 })
  try {
    await vi.waitFor(async () => { const frame = await cells.frame(); expect(synthetic.ptyOpens, frame.text).toBe(1) })
    const frame = await cells.frame()
    expect(frame.text).toContain('Terminal editor fixture')
    expect(synthetic.engineImports).toBe(0)
    expect(synthetic.reads).toBe(0)
  } finally { cells.done(); qc.clear(); _resetPaneModels(); clearEditorStates() }
  expect(synthetic.ptyCloses).toBe(1)
  vi.unstubAllGlobals()
})

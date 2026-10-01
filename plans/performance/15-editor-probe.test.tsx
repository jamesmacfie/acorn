import { expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prefsKey } from '@acorn/protocol/api.ts'
import { renderCells } from '../../apps/tui/src/kit/render'
import { paneModel, _resetPaneModels } from '../../packages/client-core/src/host/registries/panes/paneModels'
import { clearEditorStates, editorOpen } from '../../plugins/editor/src/client/editorState'

const synthetic = vi.hoisted(() => ({ reads: 0, markers: 0, body: 'Synthetic file\n'.repeat(100000) }))
vi.mock('../../plugins/editor/src/client/editorClient', async original => ({
  ...await original<typeof import('../../plugins/editor/src/client/editorClient')>(),
  editorApi: () => ({ root: async () => '/synthetic', list: async () => [], files: async () => [],
    read: async () => { synthetic.reads++; return synthetic.body },
    lineMarkers: async () => { synthetic.markers++; return [] }, write: async () => ({ ok: true }) }),
}))
vi.mock('../../plugins/editor/src/client/FileTree', () => ({ default: () => null }))
vi.mock('../../plugins/editor/src/client/search/SearchPanel', () => ({ default: () => null }))
const { default: EditorPane } = await import('../../plugins/editor/src/client/EditorPane')

it('characterizes remembered file warmup on the real terminal editor host', async () => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Unsafe output tag')
  const path = join(dirname(fileURLToPath(import.meta.url)), `15-editor-${tag}.json`)
  if (tag.startsWith('before') && existsSync(path)) throw new Error('Before evidence exists')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  qc.setQueryData(prefsKey, {})
  const task = 'terminal-editor-warmup'
  editorOpen(task, 'remembered.txt', false)
  const cpu = process.cpuUsage(), started = performance.now()
  const cells = await renderCells(() => <QueryClientProvider client={qc}><EditorPane task={{ id: task } as any} /></QueryClientProvider>, { width: 80, height: 24 })
  try {
    await vi.waitFor(() => expect(synthetic.reads).toBeGreaterThan(0))
    await new Promise(resolve => setTimeout(resolve, 20))
    const pool = paneModel<any>('editor', task, () => { throw new Error('Missing actual pool') })
    const used = process.cpuUsage(cpu)
    const value = { fixture: 'Actual EditorPane under universal terminal kit, one remembered 1.5M-character file, no graphical EditorView or PTY launched',
      reads: synthetic.reads, markerReads: synthetic.markers, pooledFiles: pool.files.size, savedDocuments: pool.saved.size,
      characters: [...pool.files.values()].reduce((n: number, entry: any) => n + entry.state.doc.length, 0),
      terminalFrame: cells.text, wallMs: performance.now() - started, cpuMs: (used.user + used.system) / 1000 }
    cells.done()
    Object.assign(value, { pooledFilesAfterUnmount: pool.files.size })
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
  } finally { cells.done(); qc.clear(); _resetPaneModels(); clearEditorStates() }
})

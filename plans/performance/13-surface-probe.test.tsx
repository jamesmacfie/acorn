import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { EditorView } from '@codemirror/view'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_DOCUMENT_BYTES } from '@acorn/protocol/plugin/bridge.ts'
import type { DocumentHandle } from '../../packages/client-core/src/features/editor/documentModel'

Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
const api = vi.hoisted(() => ({ text: 'SELECT 1;\n', write: vi.fn(async (_path: string, _options: any) => ({})) }))
vi.mock('../../packages/client-core/src/infra/node/apiClient', () => ({ readJson: async () => ({ text: api.text }), writeJson: api.write }))
const { default: DocumentSurface } = await import('../../packages/client-core/src/features/editor/DocumentSurface')
const records: Record<string, unknown>[] = []
const record = (name: string, values: Record<string, unknown>) => {
  records.push({ name, ...values })
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  const destination = join(dirname(fileURLToPath(import.meta.url)), `13-surface-${tag}.json`)
  if (tag.startsWith('before') && existsSync(destination) && records.length === 1) throw new Error('Use another before tag.')
  writeFileSync(destination, JSON.stringify({ owner: 'actual host DocumentSurface and CodeMirror, synthetic read/write', records }, null, 2) + '\n')
}
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); api.text = 'SELECT 1;\n'; api.write.mockReset().mockResolvedValue({}) })
function mount() {
  const qc = new QueryClient()
  const host = document.createElement('div'); document.body.append(host)
  let handle: DocumentHandle | null = null
  const stop = render(() => <QueryClientProvider client={qc}><DocumentSurface pluginId="database" surfaceId="database" nodeId="node-a"
    region={{ languageId: 'plaintext', read: '/v1/p/database/tasks/:taskId/scratch', write: '/v1/p/database/tasks/:taskId/scratch' } as any}
    scope={{ taskId: 'synthetic-task' }} onHandle={value => { handle = value }} /></QueryClientProvider>, host)
  cleanups.push(() => { stop(); host.remove(); qc.clear() })
  return { host, stop, handle: () => handle, view: () => {
    const dom = host.querySelector<HTMLElement>('.cm-editor')
    return dom ? EditorView.findFromDOM(dom) : null
  } }
}

it('records a Node-accepted Unicode document the host refuses to open', async () => {
  api.text = 'é'.repeat(MAX_DOCUMENT_BYTES)
  const surface = mount()
  await vi.waitFor(() => expect(surface.host.textContent).toContain('Document is larger'))
  record('unicode-load', { nodeAcceptedCharacters: api.text.length, bytes: new TextEncoder().encode(api.text).byteLength,
    editorMounted: !!surface.view(), errorVisible: surface.host.textContent?.includes('Document is larger'), handleOffered: !!surface.handle() })
  expect(surface.view()).toBeNull()
})

it('records edited-over-limit text after failed flush, close, and remount', async () => {
  const surface = mount()
  await vi.waitFor(() => expect(surface.handle()).not.toBeNull())
  api.write.mockImplementation(async (_path, options) => {
    const body = JSON.parse(options.body) as { text: string }
    if (body.text.length > MAX_DOCUMENT_BYTES) throw new Error('Synthetic scratch 400: text limit exceeded')
    api.text = body.text
    return {}
  })
  const edited = 'x'.repeat(MAX_DOCUMENT_BYTES + 1)
  surface.handle()!.write(edited)
  const flush = await surface.handle()!.flush().then(() => 'resolved', () => 'rejected')
  const visibleBytesBeforeClose = new TextEncoder().encode(surface.handle()!.read()).byteLength
  surface.stop()
  const reopened = mount()
  await vi.waitFor(() => expect(reopened.handle()).not.toBeNull())
  const reopenedText = reopened.handle()!.read()
  record('edited-over-limit', { editedBytes: new TextEncoder().encode(edited).byteLength, visibleBytesBeforeClose,
    flush, reopenedBytes: new TextEncoder().encode(reopenedText).byteLength, editedTextRetained: reopenedText === edited,
    expected: 'A refused write must not silently lose the unsent document on teardown; loaded/write/bridge byte limits must agree.' })
  expect(flush).toBe('resolved')
  expect(reopenedText).toBe('SELECT 1;\n')
})

import { createComponent, createSignal, onCleanup, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { NodePluginRow } from '@acorn/protocol/api.ts'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/api.ts'
import type { Layout, LayoutProps } from '../layouts/regions'
import { _resetLayouts, setLayouts } from '../layouts/table'
import { _resetRemoteTree, setRemoteTree, type RemoteTreeComponent } from '../tree/table'
import { treeDocumentGrant, treeModelAuthorityKey } from '../tree/bridgeAuthority'
import { createFrameServices } from './frameServices'
import { frameBindingFor, _resetFrameContributions, syncFrameContributions } from './register'
import { _resetPluginDistribution, _seedPluginDistribution } from '../plugins/distribution'
import { paneRegistry } from '../registries/panes/panes'
import { registerQueryOwner, queryOwner } from '../../infra/node/queryOwnership'
import { setActiveNode } from '../../infra/node/activeNode'

Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
const io = vi.hoisted(() => ({ reads: [] as { node: string; resolve: (body: { text: string }) => void }[], calls: [] as string[] }))
vi.mock('../../infra/node/apiClient', () => ({
  readJson: (_path: string, options: { nodeId: string }) => new Promise((resolve) => io.reads.push({ node: options.nodeId, resolve })),
  writeJson: async () => ({}),
  sendRaw: async (_path: string, options: { nodeId: string }) => { io.calls.push(options.nodeId); return { ok: true, status: 200 } },
  sendRawBytes: async () => ({}),
}))
vi.mock('../../features/editor/language', () => ({ languageFor: async () => [], shouldHighlightDocument: () => true }))
vi.mock('../../infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
const stops: (() => void)[] = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  _resetFrameContributions(); _resetPluginDistribution(); _resetLayouts(); _resetRemoteTree(); setActiveNode(null)
  io.reads.length = 0; io.calls.length = 0
})

it('pins delayed real editors to each registered provider and permanently fences retired handle generations', async () => {
  const hash = 'a'.repeat(64)
  const surface = { target: 'pane', id: 'database', label: 'Database', glyph: 'database', order: 1, scope: 'task', formFactor: ['desktop'], claimsKeys: [], layout: 'document-over-frame', regions: {
    document: { kind: 'document', languageId: 'plaintext', read: '/v1/p/database/tasks/:taskId/scratch', write: '/v1/p/database/tasks/:taskId/scratch' },
    frame: { kind: 'remote', entry: 'panel' },
  } } as const
  const row = { name: 'database', running: true, disabled: false, installed: { version: '1', apiVersion: PLUGIN_API_MAJOR, permissions: { api: [], events: [] }, client: { hash, bytes: 1 }, contributions: { frames: [surface] } } } as unknown as NodePluginRow
  _seedPluginDistribution([['node-a', [row]], ['node-b', [row]]], [`database ${hash}`])
  syncFrameContributions()
  const layouts: { show(value: boolean): void }[] = []
  const Layout = (props: LayoutProps) => {
    const [show, setShow] = createSignal(false)
    layouts.push({ show: setShow })
    return <><Show when={show()}>{props.regions.document?.()}</Show>{props.regions.frame?.()}</>
  }
  setLayouts({ 'document-over-frame': Layout } as Record<string, Layout> as Parameters<typeof setLayouts>[0])
  const regions: { qc: QueryClient; key: string; services: ReturnType<typeof createFrameServices>; disposed: boolean }[] = []
  setRemoteTree(((props: Parameters<RemoteTreeComponent>[0]) => {
    const qc = useQueryClient()
    const binding = frameBindingFor('database', surface as never, row, { nodeId: queryOwner(qc) ?? '', taskId: 'same-task' })
    const context = { surface: 'database', target: 'remote' as const, theme: 'light', style: 'terminal', nodeId: binding.nodeId }
    const entry = { qc, key: treeModelAuthorityKey(hash, qc, binding, context, props.document), services: createFrameServices({ binding, hash, document: treeDocumentGrant(props.document) }, { qc, navigate: () => {}, frameHasFocus: () => true }), disposed: false }
    regions.push(entry)
    onCleanup(() => { entry.disposed = true })
    return <span>region</span>
  }) as RemoteTreeComponent)
  const pane = paneRegistry.get('database')!
  for (const node of ['node-a', 'node-b']) {
    const qc = new QueryClient()
    registerQueryOwner(qc, node)
    const host = document.createElement('div'); document.body.append(host)
    stops.push(() => { host.remove(); qc.clear() })
    stops.push(render(() => createComponent(QueryClientProvider, { client: qc, get children() { return pane.component({ task: { id: 'same-task', links: [] } } as never) } }), host))
  }
  await vi.waitFor(() => expect(regions).toHaveLength(2))
  setActiveNode('ambient-other')
  expect(regions[0].services.document!.read()).toBe('')
  layouts.forEach((layout) => layout.show(true))
  await vi.waitFor(() => expect(io.reads).toHaveLength(2))
  expect(io.reads.map((read) => read.node)).toEqual(['node-a', 'node-b'])
  for (const read of io.reads) read.resolve({ text: read.node })
  await vi.waitFor(() => expect(regions[0].services.document!.read()).toBe('node-a'))
  expect(regions[1].services.document!.read()).toBe('node-b')
  expect(regions[0].key).not.toBe(regions[1].key)
  // Destroy/rebuild the real DocumentSurface while its remote region remains mounted.
  layouts[0].show(false)
  expect(() => regions[0].services.document!.read()).toThrow('retired')
  expect(regions[1].services.document!.read()).toBe('node-b')
  layouts[0].show(true)
  await vi.waitFor(() => expect(io.reads).toHaveLength(3))
  io.reads[2].resolve({ text: 'replacement-a' })
  await vi.waitFor(() => expect(document.querySelectorAll('.cm-editor')).toHaveLength(2))
  expect(() => regions[0].services.document!.read()).toThrow('retired')
  await regions[1].services.fetch('GET', '/v1/p/database/read', undefined, new AbortController().signal)
  expect(io.calls).toEqual(['node-b'])
})

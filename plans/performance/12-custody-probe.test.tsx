// Actual EditorPane, editorApi, API client, platform transport, keyed Node provider and scope eviction.
// Only the Node response is synthetic. The outgoing save must keep its original Node owner.
import { render } from 'solid-js/web'
import { Show } from 'solid-js'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { EditorView } from '@codemirror/view'
import { it, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activeCacheId, setActiveNode } from '../../packages/client-core/src/infra/node/activeNode'
import { _resetPaneModels } from '../../packages/client-core/src/host/registries/panes/paneModels'
import { activateScopedStateEviction } from '../../apps/desktop/src/client/scopedEviction'
import { refreshFleet, _resetFleet } from '../../packages/client-core/src/infra/node/fleet'
import { prefsKey } from '@acorn/protocol/api.ts'
Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
vi.mock('../../plugins/editor/src/client/FileTree', () => ({ default: () => null }))
vi.mock('../../plugins/editor/src/client/search/SearchPanel', () => ({ default: () => null }))
const { default: EditorPane } = await import('../../plugins/editor/src/client/EditorPane')
const { editorOpen, clearEditorStates } = await import('../../plugins/editor/src/client/editorState')

it('records outgoing file save target during a keyed Node swap', async () => {
  const requests: any[] = []
  Object.assign(window, { acorn: { desktop: true, onNodeStatus: () => () => {},
    fleetList: async () => ({ nodes: [], statuses: ['node-a', 'node-b'].map(nodeId => ({ nodeId, state: 'online' })) }),
    nodeFetch: async (nodeId: string, request: any) => {
    const body = request.body?.kind === 'bytes' ? JSON.parse(new TextDecoder().decode(request.body.bytes)) : undefined
    requests.push({ nodeId, method: request.method, path: request.path, ...(body ? { body } : {}) })
    const value = request.path.includes('/root') ? { root: '/synthetic' } : request.path.includes('/read') ? { text: `baseline ${nodeId}\n` }
      : request.path.includes('line-markers') ? [] : request.method === 'PUT' ? { ok: true } : {}
    return { status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(value)) }
  } } })
  _resetPaneModels(); clearEditorStates(); _resetFleet(); await refreshFleet(); setActiveNode('node-a')
  const clients = new Map(['node-a', 'node-b'].map(id => [id, new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })]))
  for (const client of clients.values()) client.setQueryData(prefsKey, {})
  const offEviction = activateScopedStateEviction()
  const host = document.createElement('div'); document.body.append(host)
  const stop = render(() => <Show keyed when={activeCacheId()}>{node => <QueryClientProvider client={clients.get(node)!}>
    <EditorPane task={{ id: `${node}-task` } as any} /></QueryClientProvider>}</Show>, host)
  try {
    editorOpen('node-a-task', 'a.txt', false)
    const view = await vi.waitFor(() => {
      const dom = host.querySelector<HTMLElement>('.cm-editor'); const value = dom && EditorView.findFromDOM(dom)
      if (!value?.state.doc.toString().includes('baseline node-a')) throw new Error('No outgoing document')
      return value
    })
    view.dispatch({ changes: { from: 0, insert: 'UNSENT FROM NODE A\n' } })
    setActiveNode('node-b')
    await new Promise(resolve => setTimeout(resolve, 30))
    const tag = process.env.ACORN_PERF_TAG ?? 'sample'
    if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')
    const path = join(dirname(fileURLToPath(import.meta.url)), `12-save-custody-${tag}.json`)
    if (tag.startsWith('before') && existsSync(path)) throw new Error('Before evidence exists; use a new tag.')
    writeFileSync(path, JSON.stringify({ fixture: 'actual keyed Node/QueryClient swap; actual editorApi and apiClient to synthetic platform NodeFetch',
      outgoingWrites: requests.filter(r => r.method === 'PUT'), expected: 'Outgoing task/file writes are pinned to node-a even after activeNodeId becomes node-b; incoming editor store is not mutated by late completion.' }, null, 2) + '\n')
  } finally {
    stop(); offEviction(); _resetPaneModels(); clearEditorStates(); setActiveNode(null)
    host.remove(); for (const client of clients.values()) client.clear()
    _resetFleet(); delete (window as any).acorn
  }
})

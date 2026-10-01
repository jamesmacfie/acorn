import { expect, it, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tasksKey, prefsKey, workspacesKey } from '@acorn/protocol/api.ts'
import { renderCells } from '../../apps/tui/src/kit/render'

const held = vi.hoisted(() => ({ model: null as any, queryClient: null as any }))
// Keep the production App/provider and shell-model query owners. Omit chrome and plugins so this
// fixture observes partition custody without unrelated request/registration work.
vi.mock('../../apps/tui/src/chrome/Shell', async () => {
  const { createShellModel } = await import('../../apps/tui/src/chrome/model')
  const { useQueryClient } = await import('@tanstack/solid-query')
  return { Shell: (props: { nodeId: string }) => {
    held.queryClient = useQueryClient(); held.model = createShellModel()
    return <text>{`${props.nodeId}: ${held.model.allTasks().map((row: any) => row.title).join(', ')}`}</text>
  } }
})

it('records the real App/provider across a Node switch and request refresh', async () => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Unsafe output tag')
  const path = join(dirname(fileURLToPath(import.meta.url)), `15-node-switch-${tag}.json`)
  if (tag.startsWith('before') && existsSync(path)) throw new Error('Before evidence exists')
  const requests: { node: string; path: string }[] = []
  const task = (node: string) => ({ id: `${node}-task`, title: `Task from ${node}`, projectId: `${node}-project`, links: [], status: 'active', origin: 'local' })
  ;(globalThis as any).window = { acorn: {
    nodeFetch: async (node: string, request: any) => {
      requests.push({ node, path: request.path })
      let data: unknown = {}
      if (request.path.includes('/tasks')) data = [task(node)]
      else if (request.path.includes('/workspaces')) data = []
      else if (request.path.includes('/prefs')) data = {}
      else if (request.path.includes('/integrations')) data = { integrations: [] }
      return { requestId: request.requestId, status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(data)) }
    }, nodeAbort: () => {}, nodeSend: () => {}, onNodeFrame: () => () => {}, onNodeStatus: () => () => {},
    fleetList: async () => ({ nodes: ['node-a', 'node-b'].map(nodeId => ({ nodeId, label: nodeId, endpoint: 'https://127.0.0.1:1', local: nodeId === 'node-a' })),
      statuses: ['node-a', 'node-b'].map(nodeId => ({ nodeId, state: 'online' })) }),
  } }
  const { setActiveNode, selectActiveNode } = await import('../../packages/client-core/src/infra/node/activeNode')
  const { clientFor, _resetFleet } = await import('../../packages/client-core/src/infra/node/fleet')
  setActiveNode('node-a'); await selectActiveNode()
  const a = clientFor('node-a').client, b = clientFor('node-b').client
  for (const [node, qc] of [['node-a', a], ['node-b', b]] as const) {
    qc.setQueryData(tasksKey, [task(node)]); qc.setQueryData(workspacesKey, []); qc.setQueryData(prefsKey, {})
  }
  const { App } = await import('../../apps/tui/src/App')
  const cells = await renderCells(() => <App client={a} nodeId="node-a" supervised={false} onQuit={() => {}} />, { width: 80, height: 24 })
  try {
    expect(held.model.allTasks()[0]?.title).toBe('Task from node-a')
    setActiveNode('node-b'); await cells.frame()
    const afterSwitch = { providerIsA: held.queryClient === a, providerIsB: held.queryClient === b, tasks: held.model.allTasks().map((row: any) => row.title),
      aObservers: a.getQueryCache().find({ queryKey: tasksKey })?.getObserversCount(), bObservers: b.getQueryCache().find({ queryKey: tasksKey })?.getObserversCount() }
    await a.invalidateQueries({ queryKey: tasksKey }); await cells.frame()
    writeFileSync(path, JSON.stringify({ fixture: 'Actual TUI App and createShellModel, synthetic two-Node seam; chrome omitted; both caches seeded before switch',
      afterSwitch, afterRefresh: { aTasks: a.getQueryData(tasksKey), bTasks: b.getQueryData(tasksKey), requests } }, null, 2) + '\n')
  } finally { cells.done(); a.clear(); b.clear(); _resetFleet(); delete (globalThis as any).window }
})

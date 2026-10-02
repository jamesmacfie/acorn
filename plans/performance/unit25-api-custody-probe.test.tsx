import { QueryClient } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { setActiveNode } from '../../packages/client-core/src/infra/node/activeNode'
import { registerQueryOwner } from '../../packages/client-core/src/infra/node/queryOwnership'
import { createWorkflowApi } from '../../plugins/workflows/src/client/workflowsClient'
vi.mock('../../packages/client-core/src/infra/node/fleet', async original => ({
  ...(await original<Record<string, unknown>>()), nodeState: () => 'connected',
}))
afterEach(() => { setActiveNode(null); delete (window as any).acorn })

it('routes the same ID through two captured QueryClients and preserves registered null at the broker', async () => {
  const delivered: { nodeId: string; path: string; method: string }[] = []
  let acknowledge!: (row: unknown) => void
  Object.assign(window, { acorn: { desktop: true, nodeFetch: async (nodeId: string, request: { path: string; method: string }) => {
    delivered.push({ nodeId, path: request.path, method: request.method })
    const row = request.method === 'PUT' ? await new Promise(resolve => { acknowledge = resolve }) : {
      id: 'same', revision: nodeId === 'node-A' ? 1 : 5,
      def: { baseline: 'acorn-1', formatVersion: 1, name: nodeId, steps: [] },
    }
    return { status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(row)) }
  } } })
  const a = new QueryClient(), b = new QueryClient(), origin = new QueryClient()
  registerQueryOwner(a, 'node-A'); registerQueryOwner(b, 'node-B'); registerQueryOwner(origin, null)
  setActiveNode('node-B')
  const apiA = createWorkflowApi(a), apiB = createWorkflowApi(b)
  expect((await apiA.def('same')).revision).toBe(1)
  expect((await apiB.def('same')).revision).toBe(5)
  const saved = apiA.updateDef('same', { name: 'submitted A' }, 1)
  await Promise.resolve()
  setActiveNode('node-A')
  expect((await apiB.def('same')).revision).toBe(5)
  acknowledge({ id: 'same', revision: 2, def: { name: 'submitted A' } })
  expect((await saved).revision).toBe(2)
  const beforeNull = delivered.length
  await expect(createWorkflowApi(origin).def('same')).rejects.toThrow()
  expect(delivered.length).toBe(beforeNull)
  expect(delivered.map(row => row.nodeId)).toEqual(['node-A', 'node-B', 'node-A', 'node-B'])
  writeFileSync('plans/performance/unit25-api-custody-after.json', JSON.stringify({ delivered, sameId: 'same', registeredNullRejectedBeforeBrokerDelivery: true }, null, 2) + '\n')
})

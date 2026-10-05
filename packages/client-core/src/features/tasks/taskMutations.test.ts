import { afterEach, expect, it, vi } from 'vitest'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { taskOnCreatedRoute, tasksRoute, type Task } from '@acorn/protocol/api.ts'
import { activeNodeId, setActiveNode } from '../../infra/node/activeNode'
import { _resetFleet, refreshFleet } from '../../infra/node/fleet'
import { createTask } from './taskMutations'

afterEach(() => {
  setActiveNode(null)
  _resetFleet()
  delete (globalThis as { window?: unknown }).window
})

it('sends setup to the task origin when the active Node changes while creation is pending', async () => {
  const nodes: NodeRecord[] = [
    { nodeId: 'node-a', label: 'Node A', endpoint: 'https://127.0.0.1:9443', local: true },
    { nodeId: 'node-b', label: 'Node B', endpoint: 'https://127.0.0.1:9444', local: false },
  ]
  const task: Task = {
    id: 'task-a', title: 'From A', icon: null, origin: 'manual', projectId: 'project-a',
    branch: null, github: null, worktreePath: null, pullNumber: null, status: 'active',
    parentId: null, sort: 0, links: [],
  }
  const response = (body: unknown) => ({ status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(body)) })
  let finishCreate!: () => void
  const heldCreate = new Promise<ReturnType<typeof response>>((resolve) => {
    finishCreate = () => resolve(response(task))
  })
  const requests: Array<{ nodeId: string; path: string; method: string }> = []
  ;(globalThis as { window?: unknown }).window = {
    acorn: {
      desktop: true,
      fleetList: () => Promise.resolve({ nodes, statuses: nodes.map(({ nodeId }) => ({ nodeId, state: 'online' })) }),
      onNodeStatus: () => () => {},
      nodeFetch: (nodeId: string, request: { path: string; method: string }) => {
        requests.push({ nodeId, path: request.path, method: request.method })
        return request.path === tasksRoute ? heldCreate : Promise.resolve(response({ ok: true }))
      },
      nodeAbort: () => {},
    },
  }

  _resetFleet()
  await refreshFleet()
  setActiveNode('node-a')
  const creating = createTask({ origin: 'manual', projectId: 'project-a', title: 'From A' }, 'node-a')
  await vi.waitFor(() => expect(requests).toEqual([{ nodeId: 'node-a', path: tasksRoute, method: 'POST' }]))

  setActiveNode('node-b')
  finishCreate()
  await expect(creating).resolves.toEqual(task)
  await vi.waitFor(() => expect(requests).toEqual([
    { nodeId: 'node-a', path: tasksRoute, method: 'POST' },
    { nodeId: 'node-a', path: taskOnCreatedRoute(task.id), method: 'POST' },
  ]))
  expect(activeNodeId()).toBe('node-b')
})

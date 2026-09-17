import { afterEach, describe, expect, it, vi } from 'vitest'
import { sandboxMessage, type TreeMutation, type TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { HttpDetailApp, HttpListApp, type HttpPaneProps } from './app'
import { _resetHttpPanelModel } from './panelModel'

vi.mock('./httpClient', () => ({
  createRequest: vi.fn(),
  deleteRequest: vi.fn(),
  listRequests: async () => [],
  sendRequest: vi.fn(),
  updateRequest: vi.fn(),
}))

const settle = async () => {
  for (let turn = 0; turn < 4; turn++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const nodesIn = (ops: TreeMutation[]): TreeNode[] => {
  const nodes: TreeNode[] = []
  const visit = (node: TreeNode): void => {
    nodes.push(node)
    node.children.forEach(visit)
  }
  for (const op of ops) if (op.op === 'insert') visit(op.node)
  return nodes
}

const bridge = {
  api: { get: async () => ({ id: 'project-1', name: 'Acorn' }) },
  context: { surface: 'http', target: 'remote', nodeId: 'node-1' },
  onSelect: () => () => {},
  onSurfaceAction: () => () => {},
  ui: { copy: async () => {} },
} as unknown as AcornBridge

const mount = (component: typeof HttpListApp | typeof HttpDetailApp) => {
  const batches: TreeMutation[][] = []
  const root = createRemoteRoot((ops) => batches.push(ops))
  const dispose: (() => void)[] = []
  solidTree<HttpPaneProps>(component)(bridge, {
    entry: 'pane',
    root,
    props: () => ({ projectId: 'project-1', taskId: 'task-1' }),
    onProps: () => {},
    onUnmount: (callback) => dispose.push(callback),
    host: {
      invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
      openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
    },
  })
  return {
    batches,
    dispose: () => {
      dispose.forEach((callback) => callback())
      root.dispose()
    },
  }
}

afterEach(() => _resetHttpPanelModel())

describe('the API pane tree', () => {
  it('draws both regions as valid worker messages', async () => {
    const list = mount(HttpListApp)
    const detail = mount(HttpDetailApp)
    await settle()

    for (const batch of [...list.batches, ...detail.batches]) {
      expect(() => structuredClone(batch)).not.toThrow()
      expect(sandboxMessage.safeParse({ kind: 'tree:batch', slot: 'http-test', ops: batch }).success).toBe(true)
    }
    expect(nodesIn(list.batches.flat()).some((node) => node.type === 'SectionHeader')).toBe(true)
    expect(nodesIn(detail.batches.flat()).some((node) => node.type === 'Tabs')).toBe(true)

    list.dispose()
    detail.dispose()
  })
})

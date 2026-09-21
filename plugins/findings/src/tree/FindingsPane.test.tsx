import { describe, expect, it } from 'vitest'
import { sandboxMessage, type TreeMutation, type TreeNode } from '@acorn/protocol/tree/messages.ts'
import { sanitizeProps } from '@acorn/protocol/tree/props.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { FindingsPane } from './FindingsPane'

const settle = async () => {
  for (let turn = 0; turn < 4; turn++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const nodesIn = (ops: readonly TreeMutation[]): TreeNode[] => {
  const nodes: TreeNode[] = []
  const visit = (node: TreeNode): void => {
    nodes.push(node)
    node.children.forEach(visit)
  }
  for (const op of ops) if (op.op === 'insert') visit(op.node)
  return nodes
}

describe('FindingsPane', () => {
  it('draws its workbench as valid remote-tree messages', async () => {
    const batches: TreeMutation[][] = []
    const root = createRemoteRoot((ops) => batches.push(ops))
    const bridge = {
      api: {
        get: async (path: string) => path.includes('/review/bundles') ? [] : { items: [], nextCursor: null },
      },
      events: { on: () => () => {} },
      ui: { copy: async () => {}, openDestination: async () => {} },
    } as unknown as AcornBridge

    solidTree(FindingsPane)(bridge, {
      entry: 'pane',
      root,
      props: () => ({ taskId: 'task-1' }),
      onProps: () => {},
      onUnmount: () => {},
      host: {
        invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
        openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
      },
    })
    await settle()

    for (const batch of batches) {
      expect(() => structuredClone(batch)).not.toThrow()
      expect(sandboxMessage.safeParse({ kind: 'tree:batch', slot: 'findings-pane-test', ops: batch }).success).toBe(true)
    }
    const nodes = nodesIn(batches.flat())
    for (const node of nodes) expect(sanitizeProps(node.type, node.props).dropped).toEqual([])
    expect(nodes.some((node) => node.type === 'ListDetail')).toBe(true)
    expect(nodes.some((node) => node.type === 'EmptyState')).toBe(true)
    root.dispose()
  })
})

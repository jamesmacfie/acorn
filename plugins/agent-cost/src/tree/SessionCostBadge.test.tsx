import { describe, expect, it } from 'vitest'
import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from 'acorn-plugin-sdk/remote'
import { SessionCostBadge } from './SessionCostBadge'
import type { SessionHeaderProps } from './sessionHeaderContract'

const context = (priced = true): SessionHeaderProps => ({
  taskId: 'task-1',
  sessionId: 'session-1',
  providerId: 'codex',
  tokenAccounting: 'cumulative',
  costAccounting: 'cumulative',
  turns: [{
    turnId: 'turn-1',
    model: 'gpt-5.6-terra',
    usage: {
      inputTokens: 100_000,
      outputTokens: 10_000,
      cachedInputTokens: 40_000,
      cacheWriteInputTokens: 10_000,
    },
    price: priced ? { input: 2, output: 12, cacheWrite: 2.5, cacheRead: 0.2 } : null,
  }],
})

async function emitted(props: SessionHeaderProps): Promise<TreeNode[]> {
  const operations: TreeMutation[] = []
  const root = createRemoteRoot((batch) => operations.push(...batch))
  solidTree(SessionCostBadge)({} as AcornBridge, {
    entry: 'sessionCost',
    root,
    props: () => props,
    onProps: () => {},
    onUnmount: () => {},
    host: {
      invoke: () => Promise.reject(new Error('the badge asks its owner for nothing')),
      openOverlay: () => Promise.reject(new Error('the badge opens no overlay')),
    },
  })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  const nodes: TreeNode[] = []
  const visit = (node: TreeNode): void => {
    nodes.push(node)
    node.children.forEach(visit)
  }
  for (const operation of operations) if (operation.op === 'insert') visit(operation.node)
  root.dispose()
  return nodes
}

describe('session cost remote tree', () => {
  it('draws a compact estimated price using only host kit nodes', async () => {
    const nodes = await emitted(context())
    expect(nodes.find((node) => node.type === 'Chip')?.props).toMatchObject({
      size: 'xs',
      title: expect.stringContaining('Estimated API-equivalent session cost'),
    })
    expect(nodes.find((node) => node.type === '#text')?.props.value).toBe('≈$0.2530')
  })

  it('draws nothing when the owner cannot resolve a model price', async () => {
    expect(await emitted(context(false))).toEqual([])
  })
})

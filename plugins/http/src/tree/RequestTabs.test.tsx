import { expect, it, vi } from 'vitest'
import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { emptyDraft } from './draft'
import RequestTabs from './RequestTabs'

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

const nodesIn = (ops: TreeMutation[]): TreeNode[] => {
  const nodes: TreeNode[] = []
  const visit = (node: TreeNode): void => {
    nodes.push(node)
    node.children.forEach(visit)
  }
  for (const op of ops) if (op.op === 'insert') visit(op.node)
  return nodes
}

it('draws the request tabs as cloneable tree data', async () => {
  const batches: TreeMutation[][] = []
  const root = createRemoteRoot((ops) => batches.push(ops))
  const dispose: (() => void)[] = []
  solidTree(RequestTabs)({} as AcornBridge, {
    entry: 'request-tabs',
    root,
    props: () => ({ draft: emptyDraft(null), patch: vi.fn() }),
    onProps: () => {},
    onUnmount: (callback) => dispose.push(callback),
    host: {
      invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
      openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
    },
  })
  await flush()

  for (const batch of batches) expect(() => structuredClone(batch)).not.toThrow()
  const nodes = nodesIn(batches.flat())
  const strip = nodes.find((node) => node.type === 'Tabs')
  expect(strip?.props).not.toHaveProperty('actions')
  // A tab whose count is `undefined` used to take the whole list with it, and `Tabs` then threw on
  // `props.tabs.map`, which unmounted both regions of the panel.
  expect(strip?.props.tabs).toHaveLength(5)
  expect(nodes.some((node) => node.type === 'Select')).toBe(true)

  dispose.forEach((callback) => callback())
  root.dispose()
})

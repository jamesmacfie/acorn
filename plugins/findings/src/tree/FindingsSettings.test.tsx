import { describe, expect, it, vi } from 'vitest'
import { sandboxMessage, type TreeMutation, type TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { findingsSettingsRoute } from '../contract/lifecycle'
import { FindingsSettings } from './FindingsSettings'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function applied(ops: TreeMutation[]): Map<string, TreeNode> {
  const nodes = new Map<string, TreeNode>()
  const index = (node: TreeNode): void => {
    nodes.set(node.id, node)
    node.children.forEach(index)
  }
  for (const op of ops) {
    if (op.op === 'insert') index(op.node)
    else if (op.op === 'patch') Object.assign(nodes.get(op.id)?.props ?? {}, op.props)
    else if (op.op === 'text') {
      const node = nodes.get(op.id)
      if (node) node.props.value = op.value
    } else if (op.op === 'remove') nodes.delete(op.id)
  }
  return nodes
}

function mount() {
  const ops: TreeMutation[] = []
  const batches: TreeMutation[][] = []
  const root = createRemoteRoot((batch) => {
    batches.push(batch)
    ops.push(...batch)
  })
  const put = vi.fn(async (_path: string, body: unknown) => body)
  const bridge = {
    api: {
      get: async (path: string) => path === findingsSettingsRoute
        ? { automaticPreparation: true, notifyWhenReady: false, backendId: null, modelId: null }
        : {
            backends: [{
              id: 'harness:claude-code',
              kind: 'harness',
              label: 'Claude Code',
              glyph: 'brand:agents/claude',
              models: [{ id: 'sonnet', label: 'Sonnet' }],
              defaultModelId: 'sonnet',
            }],
            missing: [],
          },
      put,
    },
  } as unknown as AcornBridge
  solidTree(FindingsSettings)(bridge, {
    entry: 'settings',
    root,
    props: () => ({}),
    onProps: () => {},
    onUnmount: () => {},
    host: {
      invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
      openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
    },
  })
  const nodes = () => [...applied(ops).values()]
  const checkbox = () => nodes().find((node) => node.type === 'Checkbox' && node.props.label === 'Prepare memory suggestions when I archive a task')
  return { root, put, nodes, checkbox, batches }
}

describe('FindingsSettings', () => {
  it('draws the archive review control after loading the model roster', async () => {
    const page = mount()
    await settle()
    await settle()

    expect(page.checkbox()?.props.checked).toBe(false)
    for (const batch of page.batches) {
      expect(() => structuredClone(batch)).not.toThrow()
      expect(sandboxMessage.safeParse({ kind: 'tree:batch', slot: 'findings-settings-test', ops: batch }).success).toBe(true)
    }
    page.root.dispose()
  })

  it('selects the available backend when archive review is enabled', async () => {
    const page = mount()
    await settle()
    await settle()
    const handler = page.checkbox()?.props.onChange as { $handler: number } | undefined
    expect(handler).toBeDefined()

    page.root.dispatch(handler!.$handler, true)
    await settle()

    expect(page.put).toHaveBeenCalledWith(findingsSettingsRoute, {
      automaticPreparation: true,
      notifyWhenReady: false,
      backendId: 'harness:claude-code',
      modelId: 'sonnet',
    })
    expect(page.nodes().some((node) => node.type === 'ModelBackendPicker')).toBe(true)
    page.root.dispose()
  })
})

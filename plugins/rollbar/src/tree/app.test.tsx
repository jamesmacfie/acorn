import { describe, expect, it } from 'vitest'
import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { RollbarPane } from './app'

// The pane, driven the way the sandbox drives it: through `solidTree` into a remote root, with the
// mutations it emits as the only evidence. What this pins is the failure path, which until now only the
// running app could reach: a detail fetch that fails must draw the Alert, not strip the loading text and
// leave an empty box behind.

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const inserted = (ops: TreeMutation[]): TreeNode[] => {
  const out: TreeNode[] = []
  const walk = (node: TreeNode): void => {
    out.push(node)
    node.children.forEach(walk)
  }
  for (const op of ops) if (op.op === 'insert') walk(op.node)
  return out
}

describe('RollbarPane', () => {
  it('draws the failure when the item cannot be loaded', async () => {
    const ops: TreeMutation[] = []
    const root = createRemoteRoot((batch) => ops.push(...batch))
    const bridge = {
      api: { get: () => Promise.reject(new Error('rollbar said no')) },
      onSelect: () => () => {},
    } as unknown as AcornBridge
    solidTree(RollbarPane)(bridge, {
      entry: 'pane',
      root,
      props: () => ({ item: 'connection:14395' }),
      onProps: () => {},
      onUnmount: () => {},
      // This tree asks its host for nothing, so both throw: a fixture that silently answered
      // would hide a component that started asking.
      host: {
        invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
        openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
      },
    })
    await settle()
    await settle()
    const alert = inserted(ops).find((node) => node.type === 'Alert')
    expect(alert?.props.title).toBe('Could not load this Rollbar item.')
    root.dispose()
  })
})

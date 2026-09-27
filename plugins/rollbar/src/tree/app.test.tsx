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

  it('keeps the item and selected tab visible while refresh runs or fails', async () => {
    const item = {
      integrationId: 'connection', integrationLabel: 'Rollbar', identifier: '14395', itemId: 'item-1',
      url: null, title: 'An error', level: 'error', environment: 'production', status: 'active',
      totalOccurrences: 1, firstOccurrenceAt: null, lastOccurrenceAt: null,
      resolvedInVersion: null, assignedTo: null,
    }
    const pending: Array<{ path: string; resolve: (value: unknown) => void; reject: (error: Error) => void }> = []
    const root = createRemoteRoot(() => {})
    const bridge = {
      api: { get: (path: string) => path.includes('refresh=true')
        ? new Promise((resolve, reject) => pending.push({ path, resolve, reject }))
        : Promise.resolve(path.includes('/occurrences') ? { occurrences: [] } : item) },
      onSelect: () => () => {},
    } as unknown as AcornBridge
    solidTree(RollbarPane)(bridge, {
      entry: 'pane',
      root,
      props: () => ({ item: 'connection:14395' }),
      onProps: () => {},
      onUnmount: () => {},
      host: {
        invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
        openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
      },
    })
    await settle()
    await settle()

    const nodes = () => {
      const found: typeof root.node.children = []
      const visit = (node: typeof root.node) => {
        found.push(node)
        node.children.forEach(visit)
      }
      root.node.children.forEach(visit)
      return found
    }
    const tabs = () => nodes().find((node) => node.type === 'Tabs')
    const refresh = () => nodes().find((node) => node.type === 'Button' && node.children.some((child) => child.props.value === 'Refresh'))
    expect(tabs()).toBeDefined()
    ;(tabs()?.props.onChange as (tab: string) => void)('occurrences')
    ;(refresh()?.props.onPress as () => void)()
    await settle()
    expect(nodes().some((node) => node.type === 'Heading')).toBe(true)
    expect(tabs()?.props.active).toBe('occurrences')
    expect(refresh()?.props.busy).toBe(true)

    for (const request of pending.splice(0)) request.resolve(request.path.includes('/occurrences') ? { occurrences: [] } : item)
    await settle()
    expect(tabs()?.props.active).toBe('occurrences')
    expect(refresh()?.props.busy).toBe(false)

    ;(refresh()?.props.onPress as () => void)()
    await settle()
    pending.shift()?.reject(new Error('rollbar said no'))
    for (const request of pending.splice(0)) request.resolve({ occurrences: [] })
    await settle()
    expect(nodes().some((node) => node.type === 'Heading')).toBe(true)
    expect(tabs()?.props.active).toBe('occurrences')
    expect(nodes().find((node) => node.type === 'Alert')?.props.title).toBe('Could not refresh this Rollbar item.')
    root.dispose()
  })
})

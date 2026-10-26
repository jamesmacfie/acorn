import { describe, expect, it } from 'vitest'
import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import type { SentryIssueDetail } from '../shared/api'
import { SentryPane } from './app'

// The pane, driven the way the sandbox drives it: through `solidTree` into a remote root, with the
// mutations it emits as the only evidence.

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

const mount = async (get: (route: string) => Promise<unknown>) => {
  const ops: TreeMutation[] = []
  const root = createRemoteRoot((batch) => ops.push(...batch))
  const bridge = { api: { get }, onSelect: () => () => {} } as unknown as AcornBridge
  solidTree(SentryPane)(bridge, {
    entry: 'pane',
    root,
    props: () => ({ item: 'env:42' }),
    onProps: () => {},
    onUnmount: () => {},
    host: {
      invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
      openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
    },
  })
  await settle()
  await settle()
  return { ops, root }
}

describe('SentryPane', () => {
  it("draws the issue's latest event and stack", async () => {
    const routes: string[] = []
    const detail: SentryIssueDetail = {
      connectionId: 'env',
      connectionLabel: 'Sentry · acme/web',
      id: '42',
      shortId: 'WEB-1',
      title: 'TypeError: boom',
      culprit: 'app/checkout',
      level: 'error',
      status: 'unresolved',
      count: 1234,
      userCount: 5,
      firstSeen: null,
      lastSeen: null,
      latestEvent: {
        id: 'e1',
        occurredAt: null,
        exceptionType: 'TypeError',
        message: 'boom',
        frames: [{ filename: 'src/checkout.ts', line: 3, column: 1, method: 'pay', code: [], inApp: true }],
        environment: 'production',
        release: null,
        truncated: false,
      },
    }
    const { ops, root } = await mount(async (route) => {
      routes.push(route)
      return detail
    })
    expect(routes).toEqual(['/v1/p/sentry/issues/42?connection=env'])
    const stack = inserted(ops).find((node) => node.type === 'CodeBlock')
    expect(JSON.stringify(stack)).toContain('src/checkout.ts:3 · pay')
    expect(JSON.stringify(inserted(ops))).toContain('1,234')
    root.dispose()
  })

  it("draws the route's reason when the issue can't be loaded", async () => {
    const reason = 'Sentry turned down the token for Sentry · acme/web. It needs event:read.'
    const { ops, root } = await mount(() =>
      Promise.reject(Object.assign(new Error(reason), { code: 'provider_needs_auth' })),
    )
    const failure = inserted(ops).find((node) => node.type === 'EmptyState' && node.props.title)
    expect(failure?.props.title).toBe("Couldn't load this issue")
    expect(JSON.stringify(failure)).toContain(reason)
    root.dispose()
  })
})

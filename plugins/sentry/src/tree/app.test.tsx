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

const mount = async (
  get: (route: string) => Promise<unknown>,
  props: { item?: string; taskId?: string } = { item: 'env:42' },
) => {
  const ops: TreeMutation[] = []
  const root = createRemoteRoot((batch) => ops.push(...batch))
  const bridge = { api: { get }, onSelect: () => () => {} } as unknown as AcornBridge
  solidTree(SentryPane)(bridge, {
    entry: 'pane',
    root,
    props: () => props,
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
  url: 'https://acme.sentry.io/issues/42/',
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

describe('SentryPane', () => {
  it("draws the issue's latest event and stack", async () => {
    const routes: string[] = []
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

  it("lists a task's linked issues with their counts", async () => {
    const routes: string[] = []
    const task = {
      id: 'task-1',
      links: [
        { providerId: 'sentry', connectionId: 'c1', identifier: '42' },
        { providerId: 'sentry', connectionId: 'c1', identifier: '43' },
        { providerId: 'rollbar', connectionId: 'r1', identifier: '9' },
      ],
    }
    const { ops, root } = await mount(
      async (route) => {
        routes.push(route)
        if (route === '/v1/core/tasks') return [task]
        const id = new URL(route, 'http://x').pathname.split('/').at(-1)!
        return { ...detail, connectionId: 'c1', id, title: `Issue ${id}`, count: Number(id) }
      },
      { taskId: 'task-1' },
    )
    await settle()
    expect(routes.sort()).toEqual([
      '/v1/core/tasks',
      '/v1/p/sentry/issues/42?connection=c1',
      '/v1/p/sentry/issues/43?connection=c1',
    ])
    // A row's count arrives as a patch once its issue has been read.
    const rows = new Set(inserted(ops).flatMap((node) => (node.type === 'Row' ? [node.id] : [])))
    const counts = ops.flatMap((op) => (op.op === 'patch' && rows.has(op.id) && op.props.meta ? [op.props.meta] : []))
    expect(counts.sort()).toEqual(['42', '43'])
    root.dispose()
  })
})

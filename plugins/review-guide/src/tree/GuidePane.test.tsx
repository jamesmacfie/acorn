import { describe, expect, it } from 'vitest'
import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import type { DiffItem, GuideView } from '../shared/guide'
import { GuidePane, hunkStart } from './GuidePane'

// The pane driven through `solidTree` into a remote root, with the mutations it emits as the evidence.

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

const item = (id: string, patch = '@@ -1 +1 @@\n-a\n+b'): DiffItem => ({
  id,
  path: id.split('#')[0]!,
  oldPath: null,
  patch,
  note: '',
})

const view = (guide: GuideView['guide']): GuideView => ({
  hasChangeRequest: true,
  profiles: [{ id: 'claude-code', label: 'Claude Code' }],
  profileId: 'claude-code',
  guide,
})

const stored = (status: 'ready' | 'generating', big = ''): GuideView['guide'] => ({
  status,
  profileId: 'claude-code',
  baseRef: 'main',
  baseSha: 'b'.repeat(40),
  headSha: 'a'.repeat(40),
  sessionId: 'session-1',
  error: null,
  updatedAt: 1,
  guide:
    status === 'ready'
      ? {
          summary: 'Bumps a.',
          sections: [
            { title: 'Core', why: 'Because.', kind: 'core', items: [item('a.ts#1', `@@ -1 +1 @@\n+${big}`)] },
            { title: 'Tests', why: 'To check.', kind: 'supporting', items: [item('a.test.ts#1')] },
          ],
          uncovered: [item('b.ts#1')],
          repeated: 0,
          unknown: 0,
        }
      : null,
})

const mount = async (answer: GuideView) => {
  const ops: TreeMutation[] = []
  const root = createRemoteRoot((batch) => ops.push(...batch))
  const revealed: unknown[][] = []
  const bridge = {
    api: { get: () => Promise.resolve(answer) },
    events: { on: () => () => {} },
    ui: {
      revealChangeRequestLine: (...args: unknown[]) => {
        revealed.push(args)
        return Promise.resolve()
      },
    },
  } as unknown as AcornBridge
  solidTree(GuidePane)(bridge, {
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
  await settle()
  return { nodes: inserted(ops), root, revealed, dispose: () => root.dispose() }
}

describe('GuidePane', () => {
  it('draws each section in order, then the hunks the guide left out', async () => {
    const { nodes, dispose } = await mount(view(stored('ready')))
    expect(nodes.filter((node) => node.type === 'Fold').map((node) => node.props.label)).toEqual([
      'Core',
      'Tests',
      'Not covered by the guide',
    ])
    expect(nodes.filter((node) => node.type === 'StackedDiff').map((node) => node.props.path)).toEqual([
      'a.ts',
      'a.test.ts',
      'b.ts',
    ])
    expect(JSON.stringify(nodes)).toContain("1 hunk wasn't covered by the guide.")
    dispose()
  })

  it('leaves later sections closed when the first is large', async () => {
    const { nodes, dispose } = await mount(view(stored('ready', 'x'.repeat(300 * 1024))))
    expect(nodes.filter((node) => node.type === 'StackedDiff').map((node) => node.props.path)).toEqual(['a.ts'])
    dispose()
  })

  it("links each hunk to its first line in the change request's diff", async () => {
    const { nodes, root, revealed, dispose } = await mount(view(stored('ready')))
    const links = nodes.filter((node) => node.type === 'Link')
    const text = (node: TreeNode) => node.children.map((child) => child.props.value).join('')
    expect(links.map(text)).toEqual(['Open the session', 'a.ts:1', 'a.test.ts:1', 'b.ts:1'])
    root.dispatch((links[2]!.props.onPress as { $handler: number }).$handler, undefined)
    expect(revealed).toEqual([['a.test.ts', 1, 'new']])
    dispose()
  })

  it('offers Stop while the guide is being written', async () => {
    const { nodes, dispose } = await mount(view(stored('generating')))
    expect(JSON.stringify(nodes)).toContain('Claude Code is writing the guide')
    expect(JSON.stringify(nodes)).toContain('Stop')
    dispose()
  })
})

describe('hunkStart', () => {
  it('starts a hunk at its first new-side line', () => {
    expect(hunkStart('@@ -10,4 +12,6 @@ function a() {\n x')).toEqual({ line: 12, side: 'new' })
    expect(hunkStart('@@ -1 +1 @@\n-a\n+b')).toEqual({ line: 1, side: 'new' })
  })

  it('starts a hunk with no new side at its first old-side line', () => {
    expect(hunkStart('@@ -1,3 +0,0 @@\n-a\n-b\n-c')).toEqual({ line: 1, side: 'old' })
  })

  it('has no start for an item without hunk text', () => {
    expect(hunkStart('')).toBeNull()
  })
})

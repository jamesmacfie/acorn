import { describe, expect, it } from 'vitest'
import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import type { DiffItem, GuideView } from '../shared/guide'
import { GuidePane } from './GuidePane'

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
          steps: [
            {
              title: 'Core',
              goal: 'how a is bumped.',
              why: 'Because.',
              kind: 'core',
              items: [item('a.ts#1', `@@ -1 +1 @@\n+${big}`)],
              notes: [
                {
                  hunk: 'a.ts#1',
                  side: 'new',
                  line: 1,
                  text: big,
                  tone: 'risk',
                  title: 'This may overflow.',
                  body: 'Check **the cap**.',
                },
              ],
            },
            {
              title: 'Tests',
              goal: '',
              why: 'To check.',
              kind: 'supporting',
              items: [item('a.test.ts#1')],
              notes: [],
            },
          ],
          uncovered: [item('b.ts#1')],
          repeated: 0,
          unknown: 0,
          misplacedNotes: 2,
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
  it('draws each step in order, then the hunks the guide left out', async () => {
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

  it('leaves later steps closed when the first is large', async () => {
    const { nodes, dispose } = await mount(view(stored('ready', 'x'.repeat(300 * 1024))))
    expect(nodes.filter((node) => node.type === 'StackedDiff').map((node) => node.props.path)).toEqual(['a.ts'])
    dispose()
  })

  it("draws a step's goal, and each note under its hunk", async () => {
    const { nodes, dispose } = await mount(view(stored('ready')))
    const text = (node: TreeNode): string =>
      typeof node.props.value === 'string' ? node.props.value : node.children.map(text).join('')
    const drawn = nodes
      .filter((node) => ['StackedDiff', 'Badge', 'Markdown'].includes(node.type) || node.type === 'Text')
      .map((node) => (node.type === 'StackedDiff' ? `diff ${node.props.path}` : (node.props.text ?? text(node))))
    const core = drawn.slice(drawn.indexOf("After this step you'll know how a is bumped."), drawn.indexOf('To check.'))
    expect(core).toEqual([
      "After this step you'll know how a is bumped.",
      'Because.',
      'diff a.ts',
      'Risk',
      'This may overflow.',
      'Line 1',
      'Check **the cap**.',
    ])
    expect(JSON.stringify(nodes)).toContain(
      "Dropped 2 notes that didn't match a line of the change or went past the limit.",
    )
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

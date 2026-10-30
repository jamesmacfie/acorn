import { describe, expect, it } from 'vitest'
import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import type { DiffItem, GuideProgress, GuideView, StoredGuide } from '../shared/guide'
import { GuidePane } from './GuidePane'

// The pane driven through `solidTree` into a remote root, with the tree its mutations leave as the
// evidence.

const settle = async () => {
  for (let turn = 0; turn < 3; turn++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** The tree as the mutations leave it, rebuilt as each batch lands. */
function liveTree() {
  const roots: TreeNode[] = []
  const byId = new Map<string, { node: TreeNode; siblings: TreeNode[] }>()
  const register = (node: TreeNode, siblings: TreeNode[]): void => {
    byId.set(node.id, { node, siblings })
    node.children.forEach((child) => register(child, node.children))
  }
  const forget = (node: TreeNode): void => {
    byId.delete(node.id)
    node.children.forEach(forget)
  }
  const detach = (id: string) => {
    const { node, siblings } = byId.get(id)!
    siblings.splice(siblings.indexOf(node), 1)
    return node
  }
  const listOf = (parent: string | null) => (parent === null ? roots : byId.get(parent)!.node.children)
  const apply = (op: TreeMutation): void => {
    if (op.op === 'insert') {
      const node = structuredClone(op.node)
      listOf(op.parent).splice(op.index, 0, node)
      register(node, listOf(op.parent))
    } else if (op.op === 'remove') forget(detach(op.id))
    else if (op.op === 'move') {
      const node = detach(op.id)
      listOf(op.parent).splice(op.index, 0, node)
      byId.set(node.id, { node, siblings: listOf(op.parent) })
    } else if (op.op === 'patch') Object.assign(byId.get(op.id)!.node.props, op.props)
    else byId.get(op.id)!.node.props.value = op.value
  }
  const all = (): TreeNode[] => {
    const out: TreeNode[] = []
    const walk = (node: TreeNode): void => {
      out.push(node)
      node.children.forEach(walk)
    }
    roots.forEach(walk)
    return out
  }
  return { apply, all, parentOf: (id: string) => all().find((node) => node.children.some((child) => child.id === id)) }
}

const text = (node: TreeNode): string =>
  typeof node.props.value === 'string' ? node.props.value : node.children.map(text).join('')

const item = (id: string, patch = '@@ -1 +1 @@\n-a\n+b'): DiffItem => ({
  id,
  path: id.split('#')[0]!,
  oldPath: null,
  patch,
  note: '',
})

const note = (tone: 'explain' | 'attention' | 'risk', title: string, line = 1) => ({
  hunk: 'a.ts#1',
  side: 'new' as const,
  line,
  text: 'b',
  tone,
  title,
  body: 'Check **the cap**.',
})

const stored = (
  status: StoredGuide['status'],
  progress: GuideProgress = { pages: [], notes: [] },
  big = '',
): StoredGuide => ({
  status,
  profileId: 'claude-code',
  baseRef: 'main',
  baseSha: 'b'.repeat(40),
  headSha: 'a'.repeat(40),
  sessionId: 'session-1',
  error: null,
  updatedAt: 1,
  progress,
  guide:
    status === 'generating'
      ? null
      : {
          summary: 'Bumps a.',
          steps: [
            {
              title: 'Core',
              goal: 'how a is bumped.',
              why: 'Because.',
              kind: 'core',
              items: [item('a.ts#1', `@@ -1 +1,2 @@\n-a\n+b\n+c`), item('a.ts#2', `@@ -9 +10 @@\n+${big}`)],
              notes: [note('risk', 'This may overflow.'), note('explain', 'Why b.', 2)],
            },
            {
              title: 'Tests',
              goal: 'that a is read.',
              why: 'To check.',
              kind: 'supporting',
              items: [item('a.test.ts#1')],
              notes: [{ ...note('attention', 'No test for zero.'), hunk: 'a.test.ts#1' }],
            },
          ],
          uncovered: [item('b.ts#1')],
          repeated: 0,
          unknown: 0,
          misplacedNotes: 2,
        },
})

const view = (guide: StoredGuide): GuideView => ({
  hasChangeRequest: true,
  profiles: [{ id: 'claude-code', label: 'Claude Code' }],
  profileId: 'claude-code',
  guide,
})

const mount = async (guide: StoredGuide, layout: 'wide' | 'narrow' = 'wide') => {
  const tree = liveTree()
  const root = createRemoteRoot((batch) => batch.forEach(tree.apply))
  const revealed: unknown[][] = []
  const posted: Record<string, unknown>[] = []
  let current = view(guide)
  const bridge = {
    api: {
      get: () => Promise.resolve(current),
      post: (_path: string, body: Record<string, unknown>) => {
        posted.push(body)
        const progress = current.guide!.progress
        const field = 'page' in body ? 'pages' : 'notes'
        const key = String(body.page ?? body.note)
        const rest = progress[field].filter((entry) => entry !== key)
        current = view({ ...current.guide!, progress: { ...progress, [field]: body.done ? [...rest, key] : rest } })
        return Promise.resolve(current)
      },
    },
    events: { on: () => () => {} },
    ui: {
      revealChangeRequestLine: (...args: unknown[]) => {
        revealed.push(args)
        return Promise.resolve()
      },
    },
  } as unknown as AcornBridge
  solidTree((props: { taskId?: string; bridge: AcornBridge }) => <GuidePane {...props} layout={layout} />)(bridge, {
    entry: layout === 'wide' ? 'pane' : 'panel',
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
  const nodes = () => tree.all()
  // By its text, its label, its path, or for a row, its title.
  const find = (type: string, label: string) =>
    nodes().find(
      (node) =>
        node.type === type &&
        [text(node), node.props.label, node.props.path, node.children[0] && text(node.children[0])].includes(label),
    )!
  const press = async (type: string, label: string, event = 'onPress', payload?: unknown) => {
    root.dispatch((find(type, label).props[event] as { $handler: number }).$handler, payload)
    await settle()
  }
  return {
    nodes,
    find,
    press,
    revealed,
    posted,
    parentOf: tree.parentOf,
    shown: () => JSON.stringify(nodes()),
    diffs: () => nodes().filter((node) => node.type === 'StackedDiff'),
    dispose: () => root.dispose(),
  }
}

describe('GuidePane', () => {
  it("opens on the overview with the counts, each step's goal, a card per step, and the coverage line", async () => {
    const pane = await mount(stored('ready'))
    const shown = pane.shown()
    expect(shown).toContain('3 steps · 4 hunks in 3 files · +5 −3 · ~3 min')
    expect(
      pane
        .nodes()
        .filter((node) => node.type === 'Badge')
        .map(text),
    ).toEqual(['1 risk', '1 to look at closely', '1 explained'])
    expect(pane.find('Markdown', '').props.text).toBe('Bumps a.')
    expect(pane.nodes().some((node) => node.props.text === '- how a is bumped.\n- that a is read.')).toBe(true)
    expect(pane.nodes().filter((node) => node.type === 'Card')).toHaveLength(3)
    expect(shown).toContain("1 hunk wasn't covered by the guide.")
    expect(shown).toContain("Dropped 2 notes that didn't match a line of the change or went past the limit.")
    expect(pane.diffs()).toEqual([])
    pane.dispose()
  })

  it('lists the overview, each step, and the wrap-up in the rail, with progress', async () => {
    const pane = await mount(stored('ready'))
    const rows = pane.nodes().filter((node) => node.type === 'Row')
    expect(rows.map((row) => text(row.children[0]!))).toEqual([
      'Overview',
      'Core',
      'Tests',
      'Not covered by the guide',
      'Wrap up',
    ])
    expect(rows.map((row) => row.props.leading)).toEqual(['◎', '1', '2', '3', '⚑'])
    expect(text(rows[1]!)).toContain('core · 2 hunks · ~1 min')
    const dots = (row: TreeNode) =>
      pane
        .nodes()
        .filter((node) => node.type === 'StatusDot' && JSON.stringify(row).includes(`"${node.id}"`))
        .map((dot) => dot.props.tone)
    expect(dots(rows[1]!)).toEqual(['danger', 'muted'])
    expect(dots(rows[2]!)).toEqual(['warn'])
    expect(pane.shown()).toContain('0 of 5 done · ~3 min')
    pane.dispose()
  })

  it('starts the path, then marks each step reviewed and moves on, drawing only the open page', async () => {
    const pane = await mount(stored('ready'))
    await pane.press('Button', 'Start the path')
    expect(pane.posted).toEqual([{ taskId: 'task-1', page: 'overview', done: true }])
    expect(pane.find('Heading', 'Core').props.eyebrow).toBe('Step 1 of 3 · core · ~1 min')
    expect(pane.shown()).toContain("After this step you'll know how a is bumped.")
    expect(pane.diffs().map((diff) => diff.props.path)).toEqual(['a.ts', 'a.ts'])
    expect(pane.shown()).toContain('Next: Tests')
    expect(pane.revealed).toEqual([])

    await pane.press('Button', 'Mark reviewed & continue')
    expect(pane.posted.at(-1)).toEqual({ taskId: 'task-1', page: 'step-1', done: true })
    expect(pane.diffs().map((diff) => diff.props.path)).toEqual(['a.test.ts'])
    expect(pane.shown()).toContain('2 of 5 done')
    expect(pane.nodes().filter((node) => node.type === 'Row')[1]!.props.leading).toBe('✓')

    await pane.press('Button', 'Back')
    expect(pane.diffs().map((diff) => diff.props.path)).toEqual(['a.ts', 'a.ts'])
    pane.dispose()
  })

  it('opens on the first page not done', async () => {
    const pane = await mount(stored('ready', { pages: ['overview', 'step-1'], notes: [] }))
    expect(pane.find('Heading', 'Tests').props.eyebrow).toBe('Step 2 of 3 · supporting · ~1 min')
    pane.dispose()
  })

  it('draws each note as a DiffNote under its line, with its buttons', async () => {
    const pane = await mount(stored('ready', { pages: ['overview'], notes: [] }))
    const risk = pane.nodes().find((node) => node.type === 'DiffNote' && node.props.title === 'This may overflow.')!
    expect(risk.props).toMatchObject({ side: 'new', line: 1, tone: 'danger', label: 'Risk', author: 'Claude Code' })
    expect(pane.parentOf(risk.id)).toMatchObject({ type: 'StackedDiff', props: { path: 'a.ts' } })
    const buttons = (diffNote: TreeNode) =>
      pane
        .nodes()
        .filter((node) => node.type === 'Button' && JSON.stringify(diffNote).includes(`"${node.id}"`))
        .map(text)
    expect(buttons(risk)).toEqual(['Ask a follow-up', 'Show in diff', 'Mark checked'])
    const explain = pane.nodes().find((node) => node.type === 'DiffNote' && node.props.title === 'Why b.')!
    expect(buttons(explain)).toEqual(['Ask a follow-up', 'Show in diff', 'Got it'])
    await pane.press('Button', 'Got it')
    expect(pane.nodes().find((node) => node.id === explain.id)!.props.open).toBe(false)
    pane.dispose()
  })

  it('asks about a line from ✦ with no note, from Ask a follow-up with the note, and shows one from Show in diff', async () => {
    const pane = await mount(stored('ready', { pages: ['overview'], notes: [] }))
    await pane.press('StackedDiff', 'a.ts', 'onActivate', { side: 'old', line: 1 })
    await pane.press('Button', 'Show in diff')
    await pane.press('Button', 'Ask a follow-up')
    expect(pane.revealed).toEqual([
      ['a.ts', 1, 'old', { ask: {} }],
      ['a.ts', 1, 'new', undefined],
      ['a.ts', 1, 'new', { ask: { note: 'This may overflow.\n\nCheck **the cap**.' } }],
    ])
    pane.dispose()
  })

  it('lists only Look closely and Risk notes in the wrap-up, and checking one checks it on its step', async () => {
    const pane = await mount(stored('ready'))
    await pane.press('Row', 'Wrap up')
    const boxes = pane.nodes().filter((node) => node.type === 'Checkbox')
    expect(boxes.map((box) => box.props.label)).toEqual(['This may overflow.', 'No test for zero.'])
    expect(pane.shown()).toContain('a.ts:1')
    expect(pane.shown()).toContain('2 still open')
    expect(pane.shown()).toContain('leave your review in Details')

    await pane.press('Checkbox', 'This may overflow.', 'onChange', true)
    expect(pane.posted).toEqual([{ taskId: 'task-1', note: 'a.ts#1:new:1', done: true }])
    expect(pane.shown()).toContain('1 still open')

    await pane.press('Link', 'Step 1')
    expect(pane.nodes().some((node) => node.type === 'Button' && text(node) === '✓ Checked')).toBe(true)
    pane.dispose()
  })

  it('holds a huge step behind folds past the batch budget', async () => {
    const pane = await mount(stored('ready', { pages: ['overview'], notes: [] }, 'x'.repeat(300 * 1024)))
    expect(pane.diffs().map((diff) => diff.props.path)).toEqual(['a.ts'])
    expect(pane.nodes().some((node) => node.type === 'Fold' && node.props.label === 'a.ts')).toBe(true)
    pane.dispose()
  })

  it('offers Stop while the guide is being written', async () => {
    const pane = await mount(stored('generating'))
    expect(pane.shown()).toContain('Claude Code is writing the guide')
    expect(pane.shown()).toContain('Stop')
    pane.dispose()
  })

  describe('beside the diff', () => {
    it('draws a stepper and only the noted lines of each hunk', async () => {
      const pane = await mount(stored('ready', { pages: ['overview'], notes: [] }), 'narrow')
      expect(pane.nodes().filter((node) => node.type === 'Row')).toEqual([])
      expect(
        pane
          .nodes()
          .filter((node) => node.type === 'Button' && node.props.size === 'xs')
          .map(text),
      ).toEqual(['✓', '1', '2', '3', '⚑'])
      // The second hunk has no notes, so it's only its link.
      expect(pane.diffs().map((diff) => [diff.props.path, diff.props.noteContext])).toEqual([['a.ts', 0]])
      expect(
        pane
          .nodes()
          .filter((node) => node.type === 'Link')
          .map(text),
      ).toContain('a.ts:10')
      pane.dispose()
    })

    it("shows a step's first hunk in the diff when the step opens", async () => {
      const pane = await mount(stored('ready', { pages: ['overview'], notes: [] }), 'narrow')
      await pane.press('Button', 'Mark reviewed & continue')
      expect(pane.revealed).toEqual([['a.test.ts', 1, 'new', undefined]])
      await pane.press('Button', 'Tests')
      expect(pane.revealed.at(-1)).toEqual(['a.test.ts', 1, 'new', undefined])
      await pane.press('Button', 'Core')
      expect(pane.revealed.at(-1)).toEqual(['a.ts', 1, 'new', undefined])
      pane.dispose()
    })
  })
})

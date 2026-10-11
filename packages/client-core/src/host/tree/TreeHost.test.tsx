import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { TREE_LIMITS } from '@acorn/protocol/tree/messages.ts'
import type { KitEvent } from '@acorn/protocol/tree/nodes.ts'
import { TreeHost, type TreeTransport } from './TreeHost'
import { mintSlotRef, NestedChromeSlot, WithNestedChromeSlots } from '../plugins/NestedChromeSlot'
import {
  extensionPointRegistry,
  extensionRegistry,
  type ExtensionContribution,
} from '../registries/extensionPoints/extensionPoints'
import { CORE_MARKDOWN_FENCE_POINT } from '@acorn/protocol/extensionPoints.ts'

// The host half. Every test here is a stranger's message going in and the shell's own DOM coming out,
// which is the only property the remote root has to have: a tree names components, and what it gets is
// those components, with everything the kit gave them.

let host: HTMLElement
let dispose: (() => void) | undefined

type Built = { id: string; type: string; props: Record<string, unknown>; children: Built[] }
const node = (id: string, type: string, props: Record<string, unknown> = {}, children: Built[] = []): Built => ({
  id,
  type,
  props,
  children,
})

const harness = () => {
  const batch: ((ops: readonly TreeMutation[]) => void)[] = []
  const failed: ((message: string) => void)[] = []
  const sent: { handler: number; event: KitEvent; payload: unknown }[] = []
  const refused: string[] = []
  const failures: string[] = []
  const transport: TreeTransport = {
    onBatch: (listener) => {
      batch.push(listener)
      return () => {}
    },
    onFailed: (listener) => {
      failed.push(listener)
      return () => {}
    },
    send: (handler, event, payload) => sent.push({ handler, event, payload }),
  }
  return {
    transport,
    refused,
    failures,
    sent,
    apply: (ops: TreeMutation[]) => {
      for (const listener of batch) listener(ops)
    },
    fail: (message: string) => {
      for (const listener of failed) listener(message)
    },
    mount: (extra: { markdownFences?: { taskId?: string } } = {}) => {
      dispose = render(
        () => (
          <TreeHost
            pluginId="stranger"
            transport={transport}
            onRefused={(reason) => refused.push(reason)}
            onFailed={(reason) => failures.push(reason)}
            {...extra}
          />
        ),
        host,
      )
    },
  }
}

// The host coalesces per frame, so every assertion waits one.
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
// …and a heavy node is a dynamic import, which lands some number of frames later depending on how
// busy the machine is. Waited for rather than counted, because a fixed count is a test that goes red
// under load and tells you nothing about the code.
const settled = async (drawn: () => boolean) => {
  for (let i = 0; i < 200 && !drawn(); i++) await frame()
  return drawn()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.restoreAllMocks()
})

describe('a tree becomes the host’s own components', () => {
  it('places only the host-minted nested chrome slot, with one nesting level', async () => {
    const h = harness()
    const ref = mintSlotRef()
    dispose = render(
      () => (
        <WithNestedChromeSlots
          slots={[
            {
              ref,
              render: () => (
                <span data-task-list>
                  Tasks
                  <NestedChromeSlot slotRef={ref} />
                </span>
              ),
            },
          ]}
        >
          <TreeHost pluginId="stranger" transport={h.transport} />
        </WithNestedChromeSlots>
      ),
      host,
    )
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('slot', 'Slot', { slotRef: ref }) }])
    await frame()
    expect(host.querySelectorAll('[data-task-list]')).toHaveLength(1)
    h.apply([{ op: 'patch', id: 'slot', props: { slotRef: 'forged' } }])
    await frame()
    expect(host.querySelector('[data-task-list]')).toBeNull()
  })

  it('opens no cooperative point a tree names, so a detail region’s contributor cannot nest another', async () => {
    // Detail regions are drawn by the host beside the owner's tree (docs/plugins/detail-regions.md).
    // A tree that emits a `Slot` with a point, the way an owner's own code would, gets nothing.
    const point = extensionPointRegistry.register({
      id: 'tracker:issue-summary',
      ownerId: 'tracker',
      label: 'Summary',
      kind: 'remote',
      mode: 'stack',
      max: 2,
    })
    const nested = extensionRegistry.register({
      id: 'plugin:widgets:summary',
      pluginId: 'widgets',
      point: 'tracker:issue-summary',
      label: 'Widgets',
      order: 500,
      carrier: 'component',
      component: () => <span data-nested>nested</span>,
    })
    try {
      const h = harness()
      h.mount()
      h.apply([
        {
          op: 'insert',
          parent: null,
          index: 0,
          node: node('card', 'Card', {}, [
            node('slot', 'Slot', { point: 'tracker:issue-summary' }),
            node('t', '#text', { value: 'owner' }),
          ]),
        },
      ])
      await frame()
      expect(host.textContent).toContain('owner')
      expect(host.querySelector('[data-nested]')).toBeNull()
    } finally {
      nested.dispose()
      point.dispose()
    }
  })

  it('mounts the components a batch names', async () => {
    const h = harness()
    h.mount()
    h.apply([
      {
        op: 'insert',
        parent: null,
        index: 0,
        node: node('n1', 'Card', {}, [
          node('n2', 'Badge', { tone: 'ok' }, [node('n3', '#text', { value: 'shipped' })]),
        ]),
      },
    ])
    await frame()
    const badge = host.querySelector<HTMLElement>('.ui-badge')!
    expect(host.querySelector('.ui-card')).not.toBeNull()
    expect(badge.dataset.tone).toBe('ok')
    expect(badge.textContent).toBe('shipped')
  })

  it('puts the shared resize handle between a remote tree’s list and detail', async () => {
    const h = harness()
    h.mount()
    h.apply([
      {
        op: 'insert',
        parent: null,
        index: 0,
        node: node('n1', 'ListDetail', { split: true }, [
          node('n2', 'ListColumn', { label: 'Tables' }, [node('n3', '#text', { value: 'users' })]),
          node('n4', 'DetailColumn', {}, [node('n5', '#text', { value: 'rows' })]),
        ]),
      },
    ])
    await frame()

    const root = host.querySelector<HTMLElement>('.ui-listdetail')!
    expect([...root.children].map((element) => element.className)).toEqual([
      'ui-listdetail-list',
      'ui-split-handle',
      'ui-listdetail-detail',
    ])
    expect(root.querySelector('[role="separator"]')?.getAttribute('aria-label')).toBe('Resize list')
  })

  it('patches one node without rebuilding its siblings', async () => {
    const h = harness()
    h.mount()
    h.apply([
      {
        op: 'insert',
        parent: null,
        index: 0,
        node: node('n1', 'Card', {}, [node('n2', 'Badge', { tone: 'ok' }), node('n3', 'Badge', { tone: 'warn' })]),
      },
    ])
    await frame()
    const [first, second] = [...host.querySelectorAll<HTMLElement>('.ui-badge')]
    h.apply([{ op: 'patch', id: 'n3', props: { tone: 'danger' } }])
    await frame()
    // The same elements, not replacements: a patch is a prop change, and the kit component owns what
    // that does. This is what makes a redraw cheap enough for a transcript full of cards.
    expect(host.querySelectorAll('.ui-badge')[0]).toBe(first)
    expect(host.querySelectorAll('.ui-badge')[1]).toBe(second)
    expect(second!.dataset.tone).toBe('danger')
  })

  it('updates a remote model picker when its backend and model change', async () => {
    const h = harness()
    const backends = [
      {
        id: 'harness:claude-code',
        kind: 'harness',
        label: 'Claude Code',
        models: [{ id: 'sonnet', label: 'Sonnet' }],
        defaultModelId: '',
      },
      {
        id: 'harness:codex',
        kind: 'harness',
        label: 'Codex',
        models: [{ id: 'gpt-one', label: 'GPT One' }],
        defaultModelId: '',
      },
    ]
    h.mount()
    h.apply([
      {
        op: 'insert',
        parent: null,
        index: 0,
        node: node('picker', 'ModelBackendPicker', {
          backends,
          backendId: 'harness:claude-code',
          modelId: '',
          onChange: { $handler: 7 },
        }),
      },
    ])
    expect(await settled(() => !!host.querySelector('button[aria-label="Generate with"]'))).toBe(true)

    h.apply([{ op: 'patch', id: 'picker', props: { backendId: 'harness:codex', modelId: 'gpt-one' } }])
    await frame()

    expect(host.querySelector('button[aria-label="Generate with"]')?.textContent).toContain('Codex')
    expect(host.querySelector('button[aria-label="Model"]')?.textContent).toContain('GPT One')
  })

  it('moves the element it has rather than building a new one', async () => {
    const h = harness()
    h.mount()
    h.apply([
      {
        op: 'insert',
        parent: null,
        index: 0,
        node: node('n1', 'Card', {}, [node('n2', 'Input', { value: 'typed' }), node('n3', 'Badge', { tone: 'ok' })]),
      },
    ])
    await frame()
    const input = host.querySelector('input')!
    // Live DOM state the tree never described. If a move remounted the node this would be gone, and
    // with it the reader's selection, their scroll position and whatever they were half way through
    // typing. Element identity is the property; what a browser does about focus on a moved node is
    // its own rule and is the same for a first-party list.
    input.value = 'half typed'

    h.apply([{ op: 'move', id: 'n2', parent: 'n1', index: 1 }])
    await frame()
    expect(host.querySelector('input')).toBe(input)
    expect(input.value).toBe('half typed')
    expect([...host.querySelectorAll('.ui-card > *')].indexOf(input)).toBe(1)
  })

  it('turns a handler id into a call back over the port', async () => {
    const h = harness()
    h.mount()
    h.apply([
      {
        op: 'insert',
        parent: null,
        index: 0,
        node: node('n1', 'Button', { onPress: { $handler: 7 } }, [node('n2', '#text', { value: 'Run' })]),
      },
    ])
    await frame()
    host.querySelector('button')!.click()
    expect(h.sent).toEqual([{ handler: 7, event: 'onPress', payload: undefined }])
  })

  it('omits a node this build has never heard of without hiding its siblings', async () => {
    const h = harness()
    h.mount()
    h.apply([
      { op: 'insert', parent: null, index: 0, node: node('n1', 'HoloDeck') },
      {
        op: 'insert',
        parent: null,
        index: 1,
        node: node('n2', 'Badge', {}, [node('n3', '#text', { value: 'known' })]),
      },
    ])
    await frame()
    expect(host.textContent).toBe('known')
    expect(host.querySelector('.ui-badge')).not.toBeNull()
  })

  it('drops a class or a style before it reaches an element', async () => {
    const h = harness()
    h.mount()
    h.apply([
      { op: 'insert', parent: null, index: 0, node: node('n1', 'Card', { class: 'pane', style: 'position:fixed' }) },
    ])
    await frame()
    const card = host.querySelector<HTMLElement>('.ui-card')!
    expect(card.classList.contains('pane')).toBe(false)
    expect(card.getAttribute('style')).toBeNull()
    expect(h.refused.join(' ')).toContain('dropped props')
  })
})

describe('a heavy node arrives one frame late', () => {
  // `Markdown` and `DiffPane` are loaders in the table rather than components, so the diff viewer and
  // the syntax highlighter behind them are not in the renderer's first paint (./components.ts). What
  // that costs is one empty frame, absorbed by the `Suspense` the host puts around each root, and this
  // is the test that the frame is all it costs — a tree that names a heavy node still draws it.
  //
  // `Markdown` rather than `DiffPane`: both go through the same loader path, and the diff viewer wants
  // a virtualizer, a worker and a scroll container that jsdom does not give it. Which entries are
  // loaders is `./components.test.tsx`, and that one entry becomes one memoized `lazy()` is too.
  it('draws nothing for a tick, then the node', async () => {
    const h = harness()
    h.mount()
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('n1', 'Markdown', { text: '# shipped' }) }])
    await frame()
    // The batch has been applied and the loader has been asked for; the module has not arrived, so the
    // boundary is showing its `null` fallback rather than a spinner or a gap that reflows.
    expect(host.querySelector('.ui-markdown')).toBeNull()
    expect(await settled(() => !!host.querySelector('.ui-markdown'))).toBe(true)
    expect(host.querySelector('.ui-markdown')!.textContent).toContain('shipped')
  })

  it('draws two of them together, off one load', async () => {
    const h = harness()
    h.mount()
    h.apply([
      {
        op: 'insert',
        parent: null,
        index: 0,
        node: node('n1', 'Card', {}, [
          node('n2', 'Markdown', { text: 'first' }),
          node('n3', 'Markdown', { text: 'second' }),
        ]),
      },
    ])
    expect(await settled(() => host.querySelectorAll('.ui-markdown').length > 0)).toBe(true)
    // Both, in the same frame. A table that wrapped its loader per mount would give each node its own
    // load state and each root its own wait.
    expect([...host.querySelectorAll('.ui-markdown')].map((n) => n.textContent?.trim())).toEqual(['first', 'second'])
  })
})

describe('a Markdown node’s fences', () => {
  // Only a top-level owner's tree lets its `Markdown` open `core:markdown-fence`. A contributor drawn in
  // somebody else's slot gets no `markdownFences`, so a fence in it stays a fence: one level, and never
  // a worker choosing for itself.
  const fenceViewer = () =>
    extensionRegistry.register({
      id: 'plugin:tables:fence',
      pluginId: 'tables',
      point: CORE_MARKDOWN_FENCE_POINT,
      label: 'Tables',
      order: 500,
      carrier: 'component',
      matches: ['json'],
      component: (props: { text: string; taskId?: string }) => (
        <output>{`table of ${props.text} in ${props.taskId}`}</output>
      ),
    } as ExtensionContribution)
  const fenced = (extra: Record<string, unknown> = {}) =>
    node('n1', 'Markdown', { text: '```json\n{"a": 1}\n```', ...extra })

  it('draws a viewer in a tree that is a top-level owner, in that tree’s scope', async () => {
    const registration = fenceViewer()
    try {
      const h = harness()
      h.mount({ markdownFences: { taskId: 'task-1' } })
      h.apply([{ op: 'insert', parent: null, index: 0, node: fenced() }])
      expect(await settled(() => !!host.querySelector('output'))).toBe(true)
      expect(host.querySelector('output')!.textContent).toBe('table of {"a": 1} in task-1')
    } finally {
      registration.dispose()
    }
  })

  it('keeps plain fences in a contributor’s tree, whatever the worker sends as `fences`', async () => {
    const registration = fenceViewer()
    try {
      const h = harness()
      h.mount()
      h.apply([{ op: 'insert', parent: null, index: 0, node: fenced({ fences: 'please' }) }])
      expect(await settled(() => !!host.querySelector('.ui-code-wrap pre'))).toBe(true)
      await frame()
      expect(host.querySelector('output')).toBeNull()
      expect(host.querySelector('.markdown-fence-toggle')).toBeNull()
      expect(h.failures).toEqual([])
    } finally {
      registration.dispose()
    }
  })
})

describe('a batch is all or nothing', () => {
  it('drops a whole batch that addresses a node the host does not have', async () => {
    const h = harness()
    h.mount()
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('n1', 'Card') }])
    await frame()
    h.apply([
      { op: 'insert', parent: null, index: 1, node: node('n2', 'Badge', { tone: 'ok' }) },
      { op: 'patch', id: 'ghost', props: { tone: 'warn' } },
    ])
    await frame()
    // Neither op landed. Half a batch is a tree the sandbox never described.
    expect(host.querySelector('.ui-badge')).toBeNull()
    expect(host.querySelector('.ui-card')).not.toBeNull()
    expect(h.refused.join(' ')).toContain('unknown node ghost')
  })

  it('refuses a duplicate id and a tree deeper than the cap', async () => {
    const h = harness()
    h.mount()
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('n1', 'Card') }])
    await frame()
    h.apply([{ op: 'insert', parent: 'n1', index: 0, node: node('n1', 'Badge') }])
    await frame()
    expect(h.refused.join(' ')).toContain('duplicate node id n1')

    // A move that would put a node inside its own subtree. Not a wrong tree — an infinite render.
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('p1', 'Card', {}, [node('c1', 'Card')]) }])
    await frame()
    h.apply([{ op: 'move', id: 'p1', parent: 'c1', index: 0 }])
    await frame()
    expect(h.refused.join(' ')).toContain('move of p1 inside itself')
    expect(host.querySelectorAll('.ui-card')).toHaveLength(3)

    let deep = node('d0', 'Card')
    for (let i = 1; i <= TREE_LIMITS.depth + 2; i++) deep = node(`d${i}`, 'Card', {}, [deep])
    h.apply([{ op: 'insert', parent: null, index: 0, node: deep }])
    await frame()
    expect(h.refused.join(' ')).toContain(`deeper than ${TREE_LIMITS.depth}`)
  })
})

describe('a failed tree stays out of the owner’s UI', () => {
  it('draws nothing when the worker gives up', async () => {
    const h = harness()
    h.mount()
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('n1', 'Card') }])
    await frame()
    h.fail('the plugin worker threw')
    await frame()
    expect(host.querySelector('.ui-card')).toBeNull()
    expect(host.textContent).toBe('')
    // Blank for the person, but not silent for the author's developer view.
    expect(h.failures).toEqual(['the plugin worker threw'])
  })
})

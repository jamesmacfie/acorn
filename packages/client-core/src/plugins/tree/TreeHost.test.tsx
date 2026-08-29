import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { TREE_LIMITS } from '@acorn/protocol/tree/messages.ts'
import type { KitEvent } from '@acorn/protocol/tree/nodes.ts'
import { TreeHost, type TreeTransport } from './TreeHost'

// The host half. Every test here is a stranger's message going in and the shell's own DOM coming out,
// which is the only property the remote root has to have: a tree names components, and what it gets is
// those components, with everything the kit gave them.

let host: HTMLElement
let dispose: (() => void) | undefined

type Built = { id: string; type: string; props: Record<string, unknown>; children: Built[] }
const node = (id: string, type: string, props: Record<string, unknown> = {}, children: Built[] = []): Built =>
  ({ id, type, props, children })

const harness = () => {
  const batch: ((ops: readonly TreeMutation[]) => void)[] = []
  const failed: ((message: string) => void)[] = []
  const sent: { handler: number; event: KitEvent; payload: unknown }[] = []
  const refused: string[] = []
  const transport: TreeTransport = {
    onBatch: (listener) => { batch.push(listener); return () => {} },
    onFailed: (listener) => { failed.push(listener); return () => {} },
    send: (handler, event, payload) => sent.push({ handler, event, payload }),
  }
  return {
    transport,
    refused,
    sent,
    apply: (ops: TreeMutation[]) => { for (const listener of batch) listener(ops) },
    fail: (message: string) => { for (const listener of failed) listener(message) },
    mount: () => {
      dispose = render(() => <TreeHost pluginId="stranger" transport={transport} onRefused={(reason) => refused.push(reason)} />, host)
    },
  }
}

// The host coalesces per frame, so every assertion waits one.
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

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
  it('mounts the components a batch names', async () => {
    const h = harness()
    h.mount()
    h.apply([
      { op: 'insert', parent: null, index: 0, node: node('n1', 'Card', {}, [
        node('n2', 'Badge', { tone: 'ok' }, [node('n3', '#text', { value: 'shipped' })]),
      ]) },
    ])
    await frame()
    const badge = host.querySelector<HTMLElement>('.ui-badge')!
    expect(host.querySelector('.ui-card')).not.toBeNull()
    expect(badge.dataset.tone).toBe('ok')
    expect(badge.textContent).toBe('shipped')
  })

  it('patches one node without rebuilding its siblings', async () => {
    const h = harness()
    h.mount()
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('n1', 'Card', {}, [
      node('n2', 'Badge', { tone: 'ok' }),
      node('n3', 'Badge', { tone: 'warn' }),
    ]) }])
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

  it('moves the element it has rather than building a new one', async () => {
    const h = harness()
    h.mount()
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('n1', 'Card', {}, [
      node('n2', 'Input', { value: 'typed' }),
      node('n3', 'Badge', { tone: 'ok' }),
    ]) }])
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
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('n1', 'Button', { onPress: { $handler: 7 } }, [
      node('n2', '#text', { value: 'Run' }),
    ]) }])
    await frame()
    host.querySelector('button')!.click()
    expect(h.sent).toEqual([{ handler: 7, event: 'onPress', payload: undefined }])
  })

  it('draws a named placeholder for a node this build has never heard of', async () => {
    const h = harness()
    h.mount()
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('n1', 'HoloDeck') }])
    await frame()
    expect(host.textContent).toContain('Part of stranger this version of acorn cannot draw')
    expect(host.textContent).toContain('HoloDeck')
  })

  it('drops a class or a style before it reaches an element', async () => {
    const h = harness()
    h.mount()
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('n1', 'Card', { class: 'pane', style: 'position:fixed' }) }])
    await frame()
    const card = host.querySelector<HTMLElement>('.ui-card')!
    expect(card.classList.contains('pane')).toBe(false)
    expect(card.getAttribute('style')).toBeNull()
    expect(h.refused.join(' ')).toContain('dropped props')
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

describe('a failed tree says so', () => {
  it('replaces itself with the placeholder when the worker gives up', async () => {
    const h = harness()
    h.mount()
    h.apply([{ op: 'insert', parent: null, index: 0, node: node('n1', 'Card') }])
    await frame()
    h.fail('the plugin worker threw')
    await frame()
    expect(host.querySelector('.ui-card')).toBeNull()
    expect(host.textContent).toContain('the plugin worker threw')
  })
})

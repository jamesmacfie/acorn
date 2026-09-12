import { describe, expect, it, vi } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import {
  createNode, createRemoteRoot, createText, firstChild, insertNode, isTextNode, nextSibling,
  removeNode, setProperty, setText,
} from './remoteRoot'

// The sandbox half. What matters here is what crosses the port and when: a detached subtree crosses
// once, an attached node's change crosses as a patch, and a function never crosses at all.

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

const collect = () => {
  const batches: TreeMutation[][] = []
  const root = createRemoteRoot((ops) => batches.push(ops))
  return { root, batches, ops: () => batches.flat() }
}

describe('the remote root', () => {
  it('sends one insert for a subtree built detached', async () => {
    const { root, batches, ops } = collect()
    const card = createNode('Card')
    const badge = createNode('Badge')
    setProperty(badge, 'tone', 'ok')
    insertNode(card, badge, null)
    insertNode(card, createText('done'), null)
    // Nothing has crossed yet: none of it is attached to the root.
    await flush()
    expect(batches).toHaveLength(0)

    insertNode(root.node, card, null)
    await flush()
    expect(ops()).toHaveLength(1)
    const [op] = ops()
    expect(op).toMatchObject({ op: 'insert', parent: null, index: 0 })
    if (op?.op !== 'insert') throw new Error('unreachable')
    expect(op.node.type).toBe('Card')
    expect(op.node.children.map((child) => child.type)).toEqual(['Badge', '#text'])
    expect(op.node.children[0]!.props).toEqual({ tone: 'ok' })
  })

  it('coalesces a synchronous run into one batch, and starts a new one after it', async () => {
    const { root, batches } = collect()
    const a = createNode('Row')
    insertNode(root.node, a, null)
    setProperty(a, 'tone', 'warn')
    setProperty(a, 'tone', 'danger')
    await flush()
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(3)

    setProperty(a, 'tone', 'ok')
    await flush()
    expect(batches).toHaveLength(2)
  })

  it('turns a handler into an id and calls it back, and refuses one that is not a kit event', async () => {
    const { root, ops } = collect()
    const press = vi.fn()
    const button = createNode('Button')
    setProperty(button, 'onPress', press)
    setProperty(button, 'onKeyDown', () => { throw new Error('a raw key handler must never cross') })
    insertNode(root.node, button, null)
    await flush()

    const insert = ops().find((op) => op.op === 'insert')
    if (insert?.op !== 'insert') throw new Error('unreachable')
    expect(insert.node.props.onPress).toEqual({ $handler: 1 })
    // Dropped in the sandbox, before it is anyone else's problem.
    expect(insert.node.props).not.toHaveProperty('onKeyDown')

    root.dispatch(1, { at: 'the card' })
    expect(press).toHaveBeenCalledWith({ at: 'the card' })
  })

  it('gives one function one id however many times it is set', async () => {
    const { root, ops } = collect()
    const press = () => {}
    const first = createNode('Button')
    const second = createNode('Button')
    setProperty(first, 'onPress', press)
    setProperty(second, 'onPress', press)
    insertNode(root.node, first, null)
    insertNode(root.node, second, null)
    await flush()
    const inserts = ops().filter((op) => op.op === 'insert')
    expect(inserts).toHaveLength(2)
    const ids = inserts.map((op) => (op.op === 'insert' ? op.node.props.onPress : null))
    expect(ids[0]).toEqual(ids[1])
  })

  it('moves an attached node rather than sending it twice', async () => {
    const { root, ops } = collect()
    const a = createNode('Row')
    const b = createNode('Row')
    insertNode(root.node, a, null)
    insertNode(root.node, b, null)
    await flush()
    insertNode(root.node, b, a)
    await flush()
    expect(ops().filter((op) => op.op === 'insert')).toHaveLength(2)
    expect(ops().filter((op) => op.op === 'move')).toEqual([{ op: 'move', id: b.id, parent: null, index: 0 }])
  })

  it('stops sending once a removed node is detached', async () => {
    const { root, ops } = collect()
    const row = createNode('Row')
    insertNode(root.node, row, null)
    await flush()
    removeNode(root.node, row)
    await flush()
    setProperty(row, 'tone', 'ok')
    setText(row, 'ignored')
    await flush()
    expect(ops().filter((op) => op.op === 'patch')).toEqual([])
    expect(ops().filter((op) => op.op === 'remove')).toHaveLength(1)
  })

  it('sends nothing at all after dispose', async () => {
    const { root, ops } = collect()
    const row = createNode('Row')
    insertNode(root.node, row, null)
    root.dispose()
    await flush()
    expect(ops()).toEqual([])
  })

  it('walks the way a renderer expects', () => {
    const { root } = collect()
    const a = createNode('Row')
    const b = createText('hi')
    insertNode(root.node, a, null)
    insertNode(root.node, b, null)
    expect(firstChild(root.node)).toBe(a)
    expect(nextSibling(a)).toBe(b)
    expect(nextSibling(b)).toBe(null)
    expect(isTextNode(b)).toBe(true)
    expect(isTextNode(a)).toBe(false)
  })
})

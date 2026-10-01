import { describe, expect, it, vi } from 'vitest'
import { TREE_LIMITS, type TreeMutation, type TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createTreeState } from './treeState'
import type { TreeTransport } from './TreeHost'

const leaf = (id: string, children: TreeNode[] = []): TreeNode => ({ id, type: 'Text', props: { value: id }, children })
const chain = (count: number, prefix = 'p'): TreeNode => {
  let node = leaf(`${prefix}${count}`)
  for (let i = count - 1; i > 0; i--) node = leaf(`${prefix}${i}`, [node])
  return node
}
function host() {
  let receive!: (ops: readonly TreeMutation[]) => void
  let fail!: (message: string) => void
  const callbacks: (() => void)[] = []
  const cancel = vi.fn()
  const detach = vi.fn()
  const transport: TreeTransport = {
    send: () => {},
    onBatch: (listener) => { receive = listener; return detach },
    onFailed: (listener) => { fail = listener; return detach },
  }
  const refused = vi.fn()
  const state = createTreeState({ pluginId: 'bounds', transport, onRefused: refused,
    scheduler: { schedule: (callback) => { callbacks.push(callback); return callbacks.length }, cancel } })
  return { state, receive: (ops: readonly TreeMutation[]) => receive(ops), fail: (message: string) => fail(message), callbacks, cancel, detach, refused }
}
const insert = (node: TreeNode, parent: string | null = null): TreeMutation => ({ op: 'insert', node, parent, index: 0 })

// Depth uses the same shared state in desktop and terminal hosts.
describe('whole projected tree depth', () => {
  it('permits a moved subtree whose deepest descendant lands exactly at depth 64', () => {
    const h = host()
    h.state._apply([insert(chain(62)), insert(chain(2, 's'))])
    h.state._apply([{ op: 'move', id: 's1', parent: 'p62', index: 0 }])
    expect(h.refused).not.toHaveBeenCalled()
    expect(h.state.nodes.p62!.children).toEqual(['s1'])
    expect(h.state.nodes.s1!.children).toEqual(['s2'])
    h.state.dispose()
  })

  it('refuses descendant overflow and preserves every live value from the whole batch', () => {
    const h = host()
    h.state._apply([insert(chain(63)), insert(chain(2, 's'))])
    const before = JSON.stringify({ roots: h.state.roots(), nodes: h.state.nodes })
    h.state._apply([{ op: 'text', id: 'p1', value: 'prefix' }, { op: 'move', id: 's1', parent: 'p63', index: 0 }])
    expect(h.refused).toHaveBeenCalledOnce()
    expect(h.refused).toHaveBeenCalledWith(expect.stringContaining('tree deeper than 64'))
    expect(JSON.stringify({ roots: h.state.roots(), nodes: h.state.nodes })).toBe(before)
    h.state.dispose()
  })

  it('checks inserted and moved descendants together before the first live write', () => {
    const h = host()
    h.state._apply([insert(chain(63)), insert(chain(2, 's')), { op: 'move', id: 's1', parent: 'p63', index: 0 }])
    expect(h.refused).toHaveBeenCalledOnce()
    expect(h.state.roots()).toEqual([])
    expect(Object.keys(h.state.nodes)).toEqual([])
    h.state.dispose()
  })

  it('permits intermediate descendant overflow repaired by another move or removal', () => {
    const h = host()
    h.state._apply([insert(chain(63)), insert(chain(2, 's'))])
    h.state._apply([
      { op: 'move', id: 's1', parent: 'p63', index: 0 },
      { op: 'move', id: 's1', parent: 'p62', index: 0 },
      { op: 'remove', id: 'p63' },
    ])
    expect(h.refused).not.toHaveBeenCalled()
    expect(h.state.nodes.p62!.children).toEqual(['s1'])
    expect(h.state.nodes.p63).toBeUndefined()
    h.state.dispose()
  })

  it('refuses an intermediate cycle even if a later removal would hide it', () => {
    const h = host()
    h.state._apply([insert(chain(3))])
    h.state._apply([{ op: 'move', id: 'p1', parent: 'p3', index: 0 }, { op: 'remove', id: 'p1' }])
    expect(h.refused).toHaveBeenCalledWith(expect.stringContaining('inside itself'))
    expect(Object.keys(h.state.nodes)).toHaveLength(3)
    h.state.dispose()
  })

  it('removes a temporary 4,000-level subtree without recursive cleanup', () => {
    const h = host()
    const count = TREE_LIMITS.batchOps
    h.state._apply(Array.from({ length: count }, (_, i) => insert(leaf(`n${i}`))))
    const moves: TreeMutation[] = Array.from({ length: count - 1 }, (_, i) => ({ op: 'move', id: `n${i}`, parent: `n${i + 1}`, index: 0 }))
    h.state._apply([...moves, { op: 'remove', id: `n${count - 1}` }])
    expect(h.refused).not.toHaveBeenCalled()
    expect(h.state.roots()).toEqual([])
    expect(Object.keys(h.state.nodes)).toEqual([])
    h.state.dispose()
  })
})

describe('bounded pending tree updates', () => {
  it('coalesces ordinary messages in order and resets the budget after each flush', () => {
    const h = host()
    h.receive([insert(leaf('root'))])
    h.receive([{ op: 'text', id: 'root', value: 'coalesced' }])
    expect(h.callbacks).toHaveLength(1)
    expect(h.state.roots()).toEqual([])
    h.callbacks[0]!()
    expect(h.state.nodes.root!.props.value).toBe('coalesced')
    h.receive([{ op: 'text', id: 'root', value: 'next tick' }])
    h.callbacks[1]!()
    expect(h.state.nodes.root!.props.value).toBe('next tick')
    expect(h.refused).not.toHaveBeenCalled()
    h.state.dispose()
  })

  it('refuses operation overflow before a stalled callback can commit a prefix', () => {
    const h = host()
    h.state._apply([insert(leaf('root'))])
    for (let i = 0; i < TREE_LIMITS.batchOps; i++) h.receive([{ op: 'text', id: 'root', value: 'pending' }])
    expect(h.refused).not.toHaveBeenCalled()
    h.receive([{ op: 'text', id: 'root', value: 'overflow' }])
    expect(h.refused).toHaveBeenCalledOnce()
    expect(h.cancel).toHaveBeenCalledWith(1)
    for (let i = 0; i < 20; i++) h.receive([{ op: 'text', id: 'root', value: 'ignored' }])
    h.callbacks[0]!()
    expect(h.state.nodes.root!.props.value).toBe('root')
    expect(h.state.failed()).toContain('pending tree update')
    expect(h.refused).toHaveBeenCalledOnce()
    expect(h.callbacks).toHaveLength(1)
    h.state.dispose()
  })

  it('counts UTF-8 bytes across separately bounded messages before retaining byte overflow', () => {
    const h = host()
    h.state._apply([insert(leaf('root'))])
    // Each message has one mutation and less than 1 MiB. Their coalesced UTF-8 size exceeds it,
    // while the character count remains below it.
    const value = 'é'.repeat(50_000)
    for (let i = 0; i < 10; i++) h.receive([{ op: 'text', id: 'root', value }])
    expect(h.refused).not.toHaveBeenCalled()
    h.receive([{ op: 'text', id: 'root', value }])
    expect(h.refused).toHaveBeenCalledOnce()
    h.callbacks[0]!()
    expect(h.state.nodes.root!.props.value).toBe('root')
    h.state.dispose()
  })

  it('clears queued work on dispose and ignores callbacks and listeners already in delivery', () => {
    const h = host()
    h.receive([insert(leaf('root'))])
    h.state.dispose()
    expect(h.detach).toHaveBeenCalledTimes(2)
    expect(h.cancel).toHaveBeenCalledWith(1)
    h.callbacks[0]!()
    h.receive([insert(leaf('late'))])
    h.fail('late failure')
    h.state._apply([insert(leaf('test seam after dispose'))])
    expect(h.state.roots()).toEqual([])
    expect(h.state.failed()).toBeNull()
    expect(h.callbacks).toHaveLength(1)
  })
})

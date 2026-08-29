import { describe, expect, it } from 'vitest'
import { mutation, sandboxMessage, TREE_LIMITS } from '@acorn/protocol/tree/messages.ts'
import { KIT_NODES, ROLE_VALUES, TEXT_NODE } from '@acorn/protocol/tree/nodes.ts'
import { KIT_NODE_SCHEMAS, sanitizeProps } from '@acorn/protocol/tree/props.ts'
import { NODE_SUPPORT } from '../../ui/kit/support'
import { ROLE_ENUMS } from '../../ui/kit/tokens'

// The wire's half of the kit. Protocol is a pure sink, so it holds its own copy of the node names and
// the role enums; this is the lock that stops the two drifting. It lives here rather than in protocol
// because only this side can see both.

describe('the wire and the kit agree', () => {
  it('names every kit node and no others', () => {
    expect([...KIT_NODES].sort()).toEqual(Object.keys(NODE_SUPPORT).sort())
  })

  it('gives every kit node a props schema, plus the text run', () => {
    expect(Object.keys(KIT_NODE_SCHEMAS).sort()).toEqual([...KIT_NODES, TEXT_NODE].sort())
  })

  it('carries the same role enums', () => {
    for (const [role, values] of Object.entries(ROLE_ENUMS)) {
      expect(ROLE_VALUES[role as keyof typeof ROLE_VALUES]).toEqual([...values])
    }
    expect(Object.keys(ROLE_VALUES).sort()).toEqual(Object.keys(ROLE_ENUMS).sort())
  })
})

describe('props are sanitized before anything sees them', () => {
  it('drops class, style and every other door into the host DOM', () => {
    const { props, dropped } = sanitizeProps('Card', {
      tone: 'ok',
      class: 'agent-tool',
      style: 'position:fixed',
      innerHTML: '<script>',
      ref: 'anything',
      children: 'no',
    })
    expect(props).toEqual({ tone: 'ok' })
    expect(dropped.sort()).toEqual(['children', 'class', 'innerHTML', 'ref', 'style'])
  })

  it('keeps a handler id only under one of the kit events', () => {
    const { props, dropped } = sanitizeProps('Button', {
      onPress: { $handler: 3 },
      onKeyDown: { $handler: 4 },
      onPress2: { $handler: 5 },
      // A handler id smuggled in under a prop that is not an event at all.
      label: { $handler: 6 },
    })
    expect(props).toEqual({ onPress: { $handler: 3 } })
    expect(dropped.sort()).toEqual(['label', 'onKeyDown', 'onPress2'])
  })

  it('refuses a role prop that is not one of the roles', () => {
    expect(sanitizeProps('Badge', { tone: 'ok' }).props).toEqual({ tone: 'ok' })
    const bad = sanitizeProps('Badge', { tone: '#ff0000', gap: '12px', size: 'xl' })
    expect(bad.props).toEqual({})
    expect(bad.dropped.sort()).toEqual(['gap', 'size', 'tone'])
  })

  it('caps how many props one node may carry', () => {
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`p${i}`, i]))
    const { props, dropped } = sanitizeProps('Row', many)
    expect(Object.keys(props)).toHaveLength(64)
    expect(dropped).toHaveLength(136)
  })

  it('makes a text run carry a string and nothing else', () => {
    expect(sanitizeProps(TEXT_NODE, { value: 'hello', tone: 'ok' }).props).toEqual({ value: 'hello' })
    expect(sanitizeProps(TEXT_NODE, { value: 12 }).props).toEqual({ value: '' })
  })
})

describe('the mutation schema', () => {
  it('accepts the five ops and refuses anything else', () => {
    expect(mutation.safeParse({ op: 'remove', id: 'n1' }).success).toBe(true)
    expect(mutation.safeParse({ op: 'text', id: 'n1', value: 'x' }).success).toBe(true)
    expect(mutation.safeParse({ op: 'insert', parent: null, index: 0, node: { id: 'n1', type: 'Card' } }).success).toBe(true)
    expect(mutation.safeParse({ op: 'replaceEverything', id: 'n1' }).success).toBe(false)
    expect(mutation.safeParse({ op: 'remove' }).success).toBe(false)
  })

  it('refuses a batch over the op cap at the door', () => {
    const ops = Array.from({ length: TREE_LIMITS.batchOps + 1 }, () => ({ op: 'remove', id: 'n1' }))
    expect(sandboxMessage.safeParse({ kind: 'tree:batch', slot: 's1', ops }).success).toBe(false)
  })

  it('survives a fuzz of malformed messages without throwing', () => {
    const junk: unknown[] = [
      null, undefined, 0, '', [], {}, { kind: 'tree:batch' }, { kind: 'tree:batch', slot: 's', ops: null },
      { kind: 'tree:batch', slot: 's', ops: [{ op: 'insert' }] },
      { kind: 'tree:batch', slot: 's', ops: [{ op: 'patch', id: 'n1', props: { onPress: () => {} } }] },
      { kind: 'tree:event' }, { kind: 42 }, { kind: 'tree:pong', extra: Number.NaN },
    ]
    for (const value of junk) expect(() => sandboxMessage.safeParse(value)).not.toThrow()
    // And a function never survives the parse, whatever it is called.
    expect(sandboxMessage.safeParse({ kind: 'tree:batch', slot: 's', ops: [{ op: 'patch', id: 'n1', props: { onPress: () => {} } }] }).success).toBe(false)
  })
})

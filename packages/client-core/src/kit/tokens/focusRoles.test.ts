import { describe, expect, it } from 'vitest'
import { KIT_NODES, NODE_FOCUS, OWNS_KEYS } from './focusRoles'
import { NODE_SUPPORT } from './support'

// The focus table and the support matrix are the same list, for the same reason the support matrix
// and the barrel are: a node that joined the kit without anyone deciding whether a keyboard can land
// on it is a node that ships unreachable. See docs/command-palette-and-shortcuts.md § Focus and typing.

describe('the kit focus table', () => {
  it('gives every node in the support matrix a role', () => {
    expect(KIT_NODES.length).toBeGreaterThan(40) // anti-vacuity
    expect(KIT_NODES.filter((node) => !(node in NODE_FOCUS))).toEqual([])
  })

  it('names a node in every row', () => {
    expect(Object.keys(NODE_FOCUS).filter((node) => !(node in NODE_SUPPORT))).toEqual([])
  })

  it('marks every node that owns its keys as a stop', () => {
    expect(OWNS_KEYS.filter((node) => NODE_FOCUS[node] !== 'stop')).toEqual([])
  })

  it('gives every collection something to rove over', () => {
    // A collection whose items are not `item` anywhere is a collection with no members, which means
    // the table disagrees with itself.
    const items = KIT_NODES.filter((node) => NODE_FOCUS[node] === 'item')
    expect(items).toContain('Row')
    expect(items).toContain('TreeRow')
    expect(KIT_NODES.filter((node) => NODE_FOCUS[node] === 'collection')).toContain('Rows')
  })
})

import { describe, expect, it } from 'vitest'
import { buildCommandGraph, type CommandGraphIssue } from './graph'
import type { CommandContribution } from './commands'

// The projection, as the failures a registry can actually contain.
//
// Every case below is something a live registry does produce: a plugin reloaded in the wrong order,
// a manifest naming a leaf as a parent, a plugin reaching for core's group, a command whose node
// stopped running the plugin behind it. None of them may take the palette down, so each is a dropped
// node and one diagnostic, and the rest of the tree still draws.

const group = (id: string, over: Partial<CommandContribution> = {}): CommandContribution => ({
  id,
  title: id,
  category: 'pane',
  palette: true,
  kind: 'group',
  ...over,
} as CommandContribution)

const leaf = (id: string, over: Partial<CommandContribution> = {}): CommandContribution => ({
  id,
  title: id,
  category: 'action',
  palette: true,
  run: () => {},
  ...over,
} as CommandContribution)

const issues = (graph: { diagnostics: readonly { id: string; issue: CommandGraphIssue }[] }) =>
  graph.diagnostics.map((diagnostic) => `${diagnostic.issue}:${diagnostic.id}`)

describe('a valid tree', () => {
  const graph = buildCommandGraph([
    group('panes', { title: 'Panes' }),
    leaf('panes.close', { title: 'Close pane', parentId: 'panes' }),
    leaf('panes.pin', { title: 'Pin pane', parentId: 'panes' }),
    leaf('archive', { title: 'Archive task' }),
  ])

  it('puts parents at the top level and children under them', () => {
    expect(graph.diagnostics).toEqual([])
    expect(graph.roots.map((node) => node.id)).toEqual(['panes', 'archive'])
    expect(graph.children('panes').map((node) => node.id)).toEqual(['panes.close', 'panes.pin'])
    expect(graph.nodes.get('panes.close')?.depth).toBe(1)
  })

  it('carries a breadcrumb from the top level down to and including the row itself', () => {
    // Inclusive, so a renderer showing it as secondary text drops the last element and the index has
    // the row's own words in it without a second field.
    expect(graph.nodes.get('panes.close')?.breadcrumb).toEqual(['Panes', 'Close pane'])
    expect(graph.nodes.get('archive')?.breadcrumb).toEqual(['Archive task'])
  })

  it('answers an empty query with the top level, which is the empty root', () => {
    expect(graph.search('').map((node) => node.id)).toEqual(['panes', 'archive'])
    expect(graph.search('   ').map((node) => node.id)).toEqual(graph.top().map((node) => node.id))
  })

  it('searches descendants by their breadcrumb, so hierarchy hides nothing', () => {
    // "panes close" matches nothing in the row's own title. It matches the joined breadcrumb, which is
    // the whole reason a nested command stays findable from the root.
    expect(graph.search('panes close').map((node) => node.id)).toContain('panes.close')
    expect(graph.search('pin').map((node) => node.id)).toEqual(['panes.pin'])
    expect(graph.search('zzz')).toEqual([])
  })

  it('matches a keyword the title does not carry', () => {
    const withKeyword = buildCommandGraph([leaf('appearance', { title: 'Appearance', keywords: ['theme', 'dark'] })])
    expect(withKeyword.search('dark').map((node) => node.id)).toEqual(['appearance'])
  })
})

describe('sibling order', () => {
  it('sorts on `order` and falls back to registration order', () => {
    const graph = buildCommandGraph([
      leaf('middle'),
      leaf('last', { order: 900 }),
      leaf('first', { order: 100 }),
      leaf('middle-too'),
    ])
    // Two commands with no stated order keep the order they were registered in, so a list does not
    // reshuffle itself when an unrelated plugin loads.
    expect(graph.roots.map((node) => node.id)).toEqual(['first', 'middle', 'middle-too', 'last'])
  })

  it('sorts children the same way', () => {
    const graph = buildCommandGraph([
      group('g'),
      leaf('g.b', { parentId: 'g', order: 900 }),
      leaf('g.a', { parentId: 'g', order: 100 }),
    ])
    expect(graph.children('g').map((node) => node.id)).toEqual(['g.a', 'g.b'])
  })
})

describe('what the graph refuses', () => {
  it('keeps the first of two commands sharing an id', () => {
    const graph = buildCommandGraph([leaf('same', { title: 'First' }), leaf('same', { title: 'Second' })])
    expect(graph.nodes.get('same')?.title).toBe('First')
    expect(issues(graph)).toEqual(['duplicate-id:same'])
  })

  it('hides an orphan rather than promoting it to the top level', () => {
    // A parent disposed before its child, which is what a dev reload in the wrong order looks like. A
    // stray row at the root is worse than a missing one: nobody can tell it is stray.
    const graph = buildCommandGraph([leaf('panes.close', { parentId: 'panes' }), leaf('archive')])
    expect(graph.roots.map((node) => node.id)).toEqual(['archive'])
    expect(issues(graph)).toEqual(['missing-parent:panes.close'])
  })

  it('refuses a parent that is not a group', () => {
    const graph = buildCommandGraph([leaf('archive'), leaf('archive.now', { parentId: 'archive' })])
    expect(graph.roots.map((node) => node.id)).toEqual(['archive'])
    expect(issues(graph)).toEqual(['parent-not-group:archive.now'])
  })

  it('refuses a child whose owner is not its parent’s', () => {
    // docs/future/command-palette/refused.md § Cross-owner command parenting. A plugin inserting rows
    // into core's group, or another plugin's, is hidden lifecycle coupling nobody can see at the
    // registration site.
    const graph = buildCommandGraph([
      group('panes'),
      leaf('board.close', { parentId: 'panes', ownerId: 'board' }),
      leaf('panes.close', { parentId: 'panes' }),
    ])
    expect(graph.children('panes').map((node) => node.id)).toEqual(['panes.close'])
    expect(issues(graph)).toEqual(['cross-owner-parent:board.close'])
  })

  it('lets a plugin parent its own commands', () => {
    const graph = buildCommandGraph([
      group('board.menu', { ownerId: 'board' }),
      leaf('board.new', { parentId: 'board.menu', ownerId: 'board' }),
    ])
    expect(graph.diagnostics).toEqual([])
    expect(graph.children('board.menu').map((node) => node.id)).toEqual(['board.new'])
  })

  it('drops a cycle instead of walking it', () => {
    const graph = buildCommandGraph([
      group('a', { parentId: 'b' }),
      group('b', { parentId: 'a' }),
      leaf('safe'),
    ])
    // Every member of the ring is gone and the rest of the tree is untouched. One diagnostic, not one
    // per member: the walk names where it closed the loop, and repeating it around the ring says
    // nothing more.
    expect(graph.roots.map((node) => node.id)).toEqual(['safe'])
    expect(graph.nodes.has('a')).toBe(false)
    expect(graph.nodes.has('b')).toBe(false)
    expect(issues(graph)).toEqual(['cycle:a'])
  })

  it('drops a dropped node’s descendants without a second diagnostic each', () => {
    // One fault, one message. Repeating it per descendant buries the line that names the real cause.
    const graph = buildCommandGraph([
      group('lost', { parentId: 'gone' }),
      group('lost.child', { parentId: 'lost' }),
      leaf('lost.grandchild', { parentId: 'lost.child' }),
    ])
    expect(graph.roots).toEqual([])
    expect(issues(graph)).toEqual(['missing-parent:lost'])
  })
})

describe('the gates, inherited', () => {
  it('makes an unavailable ancestor’s whole subtree unavailable', () => {
    const graph = buildCommandGraph([
      group('panes', { when: () => false }),
      leaf('panes.close', { parentId: 'panes' }),
      leaf('panes.deep', { parentId: 'panes' }),
    ])
    expect(graph.nodes.get('panes')?.available).toBe(false)
    // The child's own `when` says yes. Its parent says no, and a child of a group you cannot reach is
    // not reachable either.
    expect(graph.nodes.get('panes.close')?.available).toBe(false)
    expect(graph.top()).toEqual([])
    expect(graph.search('close')).toEqual([])
  })

  it('hides a hidden ancestor’s children from discovery but keeps them in the tree', () => {
    const graph = buildCommandGraph([
      group('panes', { palette: false }),
      leaf('panes.close', { parentId: 'panes' }),
    ])
    // Still available, so a shortcut naming it still works. Just not discoverable, which is what
    // `palette` has always meant.
    expect(graph.nodes.get('panes.close')?.available).toBe(true)
    expect(graph.nodes.get('panes.close')?.discoverable).toBe(false)
    expect(graph.search('close')).toEqual([])
  })

  it('leaves an unflagged command out of discovery and in the tree', () => {
    const graph = buildCommandGraph([leaf('quiet', { palette: false })])
    expect(graph.roots.map((node) => node.id)).toEqual(['quiet'])
    expect(graph.top()).toEqual([])
  })

  it('asks the host capability gate, not just the contribution’s own predicate', () => {
    const graph = buildCommandGraph([leaf('shell-only', { requires: 'desktop' })])
    // No desktop preload in a node environment, so the requirement is unmet.
    expect(graph.nodes.get('shell-only')?.available).toBe(false)
  })
})

describe('an empty graph', () => {
  it('answers with nothing rather than throwing', () => {
    const graph = buildCommandGraph([])
    expect(graph.roots).toEqual([])
    expect(graph.top()).toEqual([])
    expect(graph.search('anything')).toEqual([])
    expect(graph.children('nothing')).toEqual([])
    expect(graph.diagnostics).toEqual([])
  })
})

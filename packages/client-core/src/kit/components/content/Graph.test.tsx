import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Graph } from './Graph'
import { GRAPH_CARD_H, GRAPH_CARD_W, layoutGraph } from '../../lib/graphLayout'

// The canvas: the geometry it draws from, and the four things a reader does to it.
//
// The layout half is asserted against the pure module rather than against pixels, because jsdom
// measures nothing and the numbers are the promise. The render half asserts what a reader can reach:
// a card is a button, pressing one selects it, and nothing a caller passes becomes a class.

const diamond = {
  ids: ['a', 'b', 'c', 'd'],
  edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }],
}

describe('the layout is deterministic from the edges', () => {
  it('puts a diamond on three ranks, with the two middles side by side', () => {
    const laid = layoutGraph(diamond.ids, diamond.edges)
    expect(laid.cards.map((card) => card.rank)).toEqual([0, 1, 1, 2])
    // Same rank, different lane; and the join is back on the first lane.
    expect(laid.at('b')!.x).toBe(0)
    expect(laid.at('c')!.x).toBeGreaterThan(laid.at('b')!.x)
    expect(laid.at('d')!.x).toBe(0)
    expect(laid.at('d')!.y).toBeGreaterThan(laid.at('b')!.y)
    // Twice, from the same input: the same answer. Nothing here reads a clock or a measurement.
    const again = layoutGraph(diamond.ids, diamond.edges)
    expect({ cards: again.cards, edges: again.edges }).toEqual({ cards: laid.cards, edges: laid.edges })
  })

  it('names the parents of a join, so a host with no wires can still say there are two', () => {
    expect(layoutGraph(diamond.ids, diamond.edges).at('d')!.parents).toEqual(['b', 'c'])
  })

  it('lets a given position win for its own card and nobody else', () => {
    const put = layoutGraph(diamond.ids, diamond.edges, { c: { x: 900, y: 44 } })
    const bare = layoutGraph(diamond.ids, diamond.edges)
    expect(put.at('c')).toMatchObject({ x: 900, y: 44 })
    expect(put.at('b')).toEqual(bare.at('b'))
    // A card dragged to the right grows the content the canvas pans over.
    expect(put.width).toBe(900 + GRAPH_CARD_W)
  })

  it('does not hang on a cycle', () => {
    const laid = layoutGraph(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
    expect(laid.cards).toHaveLength(2)
  })

  it('puts an edge control on open wire rather than on the card in the way', () => {
    // `b` sits between `a` and `c`, and the edge from `a` to `c` runs behind it. A control on the
    // geometric midpoint would land on `b`: invisible there, and still first in line for the pointer.
    const positions = { a: { x: 0, y: 0 }, b: { x: 0, y: 152 }, c: { x: 0, y: 304 } }
    const laid = layoutGraph(['a', 'b', 'c'], [{ from: 'a', to: 'c' }], positions)
    const control = laid.edges[0].control
    const covered = control.y > 152 && control.y < 152 + GRAPH_CARD_H
      && control.x > 0 && control.x < GRAPH_CARD_W
    expect(covered).toBe(false)
  })
})

let host: HTMLElement
let dispose: (() => void) | undefined
const mount = (node: () => import('solid-js').JSX.Element) => {
  dispose = render(node, host)
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

const cards = () => [...host.querySelectorAll<HTMLButtonElement>('.ui-graph-card')]

describe('the graph a reader touches', () => {
  const nodes = [
    { id: 'a', label: 'investigate' },
    { id: 'b', label: 'review', detail: 'agent' },
  ]

  it('draws every card as a button inside a listbox, so the picture reads as a list', () => {
    mount(() => <Graph id="g" ariaLabel="Steps" nodes={nodes} edges={[{ from: 'a', to: 'b' }]} />)
    expect(host.querySelector('[role="listbox"]')!.getAttribute('aria-label')).toBe('Steps')
    expect(cards().map((card) => card.tagName)).toEqual(['BUTTON', 'BUTTON'])
    expect(cards().map((card) => card.getAttribute('role'))).toEqual(['option', 'option'])
    expect(host.querySelectorAll('.ui-graph-wire')).toHaveLength(1)
    // The wires are one SVG and it says nothing: a curve has no name a card does not already carry.
    expect(host.querySelector('.ui-graph-edges')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('reports the card that was pressed', () => {
    const picked: string[] = []
    mount(() => <Graph id="g" ariaLabel="Steps" nodes={nodes} edges={[]} onSelect={(id) => picked.push(id)} />)
    cards()[1].click()
    expect(picked).toEqual(['b'])
  })

  it('marks the selected card and nothing else', () => {
    mount(() => (
      <Graph id="g" ariaLabel="Steps" nodes={[nodes[0], { ...nodes[1], selected: true }]} edges={[]} />
    ))
    expect(cards().map((card) => card.hasAttribute('data-selected'))).toEqual([false, true])
  })

  it('draws ports only where an edge can be authored, and a cut only where one can be removed', () => {
    mount(() => <Graph id="g" ariaLabel="Steps" nodes={nodes} edges={[{ from: 'a', to: 'b' }]} />)
    expect(host.querySelectorAll('.ui-graph-port')).toHaveLength(0)
    expect(host.querySelectorAll('.ui-graph-cut')).toHaveLength(0)
    dispose?.()
    mount(() => (
      <Graph
        id="g"
        ariaLabel="Steps"
        nodes={nodes}
        edges={[{ from: 'a', to: 'b' }]}
        onConnect={() => {}}
        onDisconnect={() => {}}
      />
    ))
    expect(host.querySelectorAll('.ui-graph-port')).toHaveLength(2)
    expect(host.querySelectorAll('.ui-graph-cut')).toHaveLength(1)
  })

  it('removes the edge its cut belongs to', () => {
    const cut: string[] = []
    mount(() => (
      <Graph
        id="g"
        ariaLabel="Steps"
        nodes={nodes}
        edges={[{ from: 'a', to: 'b' }]}
        onDisconnect={(from, to) => cut.push(`${from}->${to}`)}
      />
    ))
    host.querySelector<HTMLButtonElement>('.ui-graph-cut')!.click()
    expect(cut).toEqual(['a->b'])
  })

  it('takes no class from its caller', () => {
    // The kit's whole premise, checked at runtime as well as in props.test-d.ts: a prop the type
    // refuses is also a prop nothing spreads onto an element.
    const sneaky = { class: 'mine', style: 'color: red' } as unknown as Record<string, never>
    mount(() => <Graph id="g" ariaLabel="Steps" nodes={nodes} edges={[]} {...sneaky} />)
    expect(host.querySelector('.mine')).toBe(null)
    expect([...host.querySelectorAll('*')].every((element) => !element.getAttribute('style')?.includes('red'))).toBe(true)
  })
})

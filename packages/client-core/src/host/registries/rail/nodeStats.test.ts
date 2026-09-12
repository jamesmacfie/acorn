import { afterEach, describe, expect, it } from 'vitest'
import { formatNodeStat, nodeStatContributions, nodeStatRegistry, type NodeStatContribution } from './nodeStats'

const stat = (id: string, order: number, label: [string, string] = ['thing', 'things']): NodeStatContribution => ({
  id, order, label, fetch: () => Promise.resolve(0),
})

const disposables: { dispose(): void }[] = []
afterEach(() => disposables.splice(0).forEach((d) => d.dispose()))

describe('nodeStatContributions', () => {
  it('sorts on the declared order with an id tiebreak, not on registration', () => {
    // The rule every registry here follows, and the reason: sorting on registration would make the client
    // plugin list's order load-bearing, which the host explicitly refuses.
    disposables.push(nodeStatRegistry.register(stat('zebra', 1)))
    disposables.push(nodeStatRegistry.register(stat('aardvark', 99)))
    disposables.push(nodeStatRegistry.register(stat('b-tie', 5)))
    disposables.push(nodeStatRegistry.register(stat('a-tie', 5)))
    expect(nodeStatContributions().map((s) => s.id)).toEqual(['zebra', 'a-tie', 'b-tie', 'aardvark'])
  })
})

describe('formatNodeStat', () => {
  it('picks the singular for exactly one', () => {
    const agents = stat('agents', 1, ['agent running', 'agents running'])
    expect(formatNodeStat(agents, 0)).toBe('0 agents running')
    expect(formatNodeStat(agents, 1)).toBe('1 agent running')
    expect(formatNodeStat(agents, 2)).toBe('2 agents running')
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { attentionRegistry, attentionSources, compareAttention, type AttentionItem } from './attention'

const item = (id: string, severity: AttentionItem['severity'], at: number): AttentionItem =>
  ({ id, title: id, severity, at })

const disposables: { dispose(): void }[] = []
afterEach(() => disposables.splice(0).forEach((d) => d.dispose()))

describe('attentionSources', () => {
  it('sorts on the declared order with an id tiebreak, not on registration', () => {
    for (const [id, order] of [['zebra', 1], ['aardvark', 99], ['b-tie', 5], ['a-tie', 5]] as const) {
      disposables.push(attentionRegistry.register({ id, order, fetch: () => Promise.resolve([]) }))
    }
    expect(attentionSources().map((s) => s.id)).toEqual(['zebra', 'a-tie', 'b-tie', 'aardvark'])
  })
})

describe('compareAttention', () => {
  it('ranks worst first, then newest', () => {
    // Severity beats age deliberately: the inbox answers "what is blocked", and a two-day-old permission
    // request still blocks. Sorting by time alone would bury it under a stream of informational rows.
    const rows = [
      item('old-info', 'info', 1),
      item('new-info', 'info', 9),
      item('old-danger', 'danger', 2),
      item('new-warn', 'warn', 8),
      item('old-warn', 'warn', 3),
    ]
    expect([...rows].sort(compareAttention).map((row) => row.id)).toEqual([
      'old-danger',
      'new-warn',
      'old-warn',
      'new-info',
      'old-info',
    ])
  })

  it('breaks a full tie by id so the list is stable', () => {
    const rows = [item('b', 'warn', 5), item('a', 'warn', 5)]
    expect([...rows].sort(compareAttention).map((row) => row.id)).toEqual(['a', 'b'])
  })
})

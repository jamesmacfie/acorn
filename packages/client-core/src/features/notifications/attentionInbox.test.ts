// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { attentionRegistry, type AttentionItem } from '../../host/registries/rail/attention'
import { evictScope } from '../../host/registries/shell/scopeEviction'
import { acknowledgeAttention, attentionIsAcknowledged, markAttentionSeen } from './attentionInbox'

const item = (over: Partial<AttentionItem>): AttentionItem => ({
  id: 'agents.sessions:s1',
  taskId: 't1',
  title: 'claude finished',
  severity: 'info',
  at: 7,
  target: { kind: 'managed-agent', resourceId: 's1' },
  ...over,
})

describe('acknowledge on view', () => {
  it('retires a nudge the owner has acknowledged, and nothing else', () => {
    const completed = item({})
    const permission = item({ severity: 'warn' })
    expect(attentionIsAcknowledged('n1', completed)).toBe(false)

    markAttentionSeen('n1', completed.id)
    expect(attentionIsAcknowledged('n1', completed)).toBe(true)
    // Same session, same moment: a block only the owner can lift stays put.
    expect(attentionIsAcknowledged('n1', permission)).toBe(false)
    // Another node's row with the same id is another session.
    expect(attentionIsAcknowledged('n2', completed)).toBe(false)
  })

  // The row's `at` is the session's `updatedAt`, and the node bumps that on every event it records: a
  // usage report after the turn ended, a controller change on reconnect. An ack keyed on it would stop
  // matching, so every row the owner had just cleared would come back with the next frame.
  it('survives the row being touched for no news', () => {
    const first = item({ id: 'agents.sessions:s2', at: 1 })
    markAttentionSeen('n1', first.id)
    expect(attentionIsAcknowledged('n1', { ...first, at: 2 })).toBe(true)
  })

  // The bell's "Mark all read" acknowledges the rows it is showing, so an unreviewed proposal — a
  // nudge from a source that has no reason to give — leaves the pill.
  it('retires an info row that names no reason', () => {
    const proposal = item({ id: 'memory.proposals:p1', at: 3 })
    markAttentionSeen('n1', proposal.id)
    expect(attentionIsAcknowledged('n1', proposal)).toBe(true)
  })

  it('empties on a node switch', () => {
    const row = item({ id: 'agents.sessions:s3' })
    markAttentionSeen('n1', row.id)
    evictScope({ scope: 'node-switched' })
    expect(attentionIsAcknowledged('n1', row)).toBe(false)
  })
})

// The seen set lives as long as the window, so "Mark all read" also tells each source, which clears
// the row on its node. Otherwise every cleared row is back in the next window.
describe('mark all read', () => {
  it('hides each nudge and hands it to its source, one batch per node', () => {
    const acknowledge = vi.fn(async () => {})
    const registration = attentionRegistry.register({ id: 'src', order: 1, fetch: async () => [], acknowledge })
    const done = item({ id: 'src:a' })
    const other = item({ id: 'src:b' })
    const blocked = item({ id: 'src:c', severity: 'warn' })
    const row = (nodeId: string, it: AttentionItem) => ({ item: it, nodeId, node: {} as never, sourceId: 'src' })

    acknowledgeAttention([row('n1', done), row('n1', blocked), row('n2', other)])

    expect(attentionIsAcknowledged('n1', done)).toBe(true)
    expect(attentionIsAcknowledged('n2', other)).toBe(true)
    // A block is never handed over: reading about it does not lift it.
    expect(acknowledge.mock.calls).toEqual([
      ['n1', [done]],
      ['n2', [other]],
    ])
    registration.dispose()
  })
})

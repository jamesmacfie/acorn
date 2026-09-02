// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { AttentionItem } from '../../host/registries/rail/attention'
import { evictScope } from '../../host/registries/shell/scopeEviction'
import { attentionIsAcknowledged, markAttentionSeen } from './attentionInbox'

const item = (over: Partial<AttentionItem>): AttentionItem =>
  ({ id: 'agents.sessions:s1', taskId: 't1', title: 'claude finished', severity: 'info', at: 7, ...over })

describe('acknowledge on view', () => {
  it('retires a nudge the owner has acknowledged, and nothing else', () => {
    const completed = item({})
    const permission = item({ severity: 'warn' })
    expect(attentionIsAcknowledged('n1', completed)).toBe(false)

    markAttentionSeen('n1', completed.id, completed.at)
    expect(attentionIsAcknowledged('n1', completed)).toBe(true)
    // Same session, same moment: a block only the owner can lift stays put.
    expect(attentionIsAcknowledged('n1', permission)).toBe(false)
    // Another node's row with the same id is another session.
    expect(attentionIsAcknowledged('n2', completed)).toBe(false)
  })

  // gouda's rule: an ack keyed on the row alone never re-arms, so a second completion is silent
  // forever. The key carries the session's `updatedAt`.
  it('re-arms when the session completes again', () => {
    const first = item({ id: 'agents.sessions:s2', at: 1 })
    markAttentionSeen('n1', first.id, first.at)
    expect(attentionIsAcknowledged('n1', { ...first, at: 2 })).toBe(false)
  })

  // The bell's "Mark all read" acknowledges the rows it is showing, so an unreviewed proposal — a
  // nudge from a source that has no reason to give — leaves the pill.
  it('retires an info row that names no reason', () => {
    const proposal = item({ id: 'memory.proposals:p1', at: 3 })
    markAttentionSeen('n1', proposal.id, proposal.at)
    expect(attentionIsAcknowledged('n1', proposal)).toBe(true)
  })

  it('empties on a node switch', () => {
    const row = item({ id: 'agents.sessions:s3' })
    markAttentionSeen('n1', row.id, row.at)
    evictScope({ scope: 'node-switched' })
    expect(attentionIsAcknowledged('n1', row)).toBe(false)
  })
})

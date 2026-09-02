// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { AttentionItem } from '../../host/registries/rail/attention'
import { evictScope } from '../../host/registries/shell/scopeEviction'
import { attentionIsAcknowledged, markAttentionSeen } from './attentionInbox'

const item = (over: Partial<AttentionItem>): AttentionItem =>
  ({ id: 'agents.sessions:s1', taskId: 't1', title: 'claude finished', severity: 'info', at: 7, ...over })

describe('acknowledge on view', () => {
  it('retires a completed row the owner has looked at, and nothing else', () => {
    const completed = item({ attentionReason: 'completed' })
    const permission = item({ attentionReason: 'permission' })
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
    const first = item({ id: 'agents.sessions:s2', attentionReason: 'completed', at: 1 })
    markAttentionSeen('n1', first.id, first.at)
    expect(attentionIsAcknowledged('n1', { ...first, at: 2 })).toBe(false)
  })

  it('empties on a node switch', () => {
    const row = item({ id: 'agents.sessions:s3', attentionReason: 'completed' })
    markAttentionSeen('n1', row.id, row.at)
    evictScope({ scope: 'node-switched' })
    expect(attentionIsAcknowledged('n1', row)).toBe(false)
  })
})

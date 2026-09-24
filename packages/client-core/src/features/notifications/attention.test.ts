// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  edgesBetween, snapshotKey, type AttentionState, type Snapshot,
} from './attention'

const STATES: AttentionState[] = ['working', 'blocked', 'finished', 'error', 'idle']

const snap = (state: AttentionState, over: Partial<Snapshot> = {}): Snapshot =>
  ({ nodeId: 'n1', sessionId: 's1', taskId: 't1', title: 'claude', state, sourceId: 'agents', notifyOnFinish: true, target: { kind: 'managed-agent', resourceId: 's1' }, ...over })

const from = (before: Snapshot | null, after: Snapshot) =>
  edgesBetween(before ? new Map([[snapshotKey(before), before]]) : new Map(), [after])

describe('edgesBetween: three of the twenty-five pairs are news', () => {
  it('names exactly the transitions the model names', () => {
    const news: string[] = []
    for (const before of STATES)
      for (const after of STATES) {
        const [edge] = from(snap(before), snap(after))
        if (edge) news.push(`${before}->${after}:${edge.kind}`)
      }
    expect(news.sort()).toEqual([
      'error->blocked:agent-needs-input',
      'finished->blocked:agent-needs-input',
      'finished->error:agent-error',
      'idle->blocked:agent-needs-input',
      'idle->error:agent-error',
      'working->blocked:agent-needs-input',
      'working->error:agent-error',
      'working->finished:agent-completed',
      'blocked->error:agent-error',
    ].sort())
  })

  it('says what it means', () => {
    expect(from(snap('working'), snap('blocked'))[0].title).toBe('claude needs you')
    expect(from(snap('working'), snap('finished'))[0].title).toBe('claude finished')
    expect(from(snap('working'), snap('error'))[0].title).toBe('claude failed')
  })

  // A ten-step run used to raise ten "finished" rows. The workflows plugin sends `run-done` for the
  // run, which is the one notice the owner asked for.
  it('a finished turn is only news for an interactive or PTY session', () => {
    expect(from(snap('working', { notifyOnFinish: false }), snap('finished', { notifyOnFinish: false }))).toEqual([])
    expect(from(snap('working'), snap('finished'))).toHaveLength(1)
    // Blocked and error are news whatever the kind: a gate needs answering.
    expect(from(snap('working', { notifyOnFinish: false }), snap('blocked', { notifyOnFinish: false }))).toHaveLength(1)
  })

  it('a first sighting is not news, and neither is standing still', () => {
    expect(from(null, snap('blocked'))).toEqual([])
    expect(from(snap('blocked'), snap('blocked'))).toEqual([])
  })

  // Session ids are node-minted, so the same one on two nodes is two sessions.
  it('keys by node as well as session', () => {
    expect(from(snap('working'), snap('blocked', { nodeId: 'n2' }))).toEqual([])
  })

  it('keeps sessions from different sources separate', () => {
    expect(from(snap('working'), snap('blocked', { sourceId: 'terminal' }))).toEqual([])
  })
})

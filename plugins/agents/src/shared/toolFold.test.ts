import { describe, expect, it } from 'vitest'
import type { AgentEventRecord, AgentToolCall } from '../contract/wire.ts'
import { foldToolEvents } from './toolFold'

let seq = 0
const tool = (turnId: string | null, call: Partial<AgentToolCall> & { id: string }): AgentEventRecord => ({
  id: `e${++seq}`,
  sessionId: 's1',
  turnId,
  seq,
  schemaVersion: 1,
  event: { type: 'tool', tool: { title: '', ...call } },
  searchText: null,
  createdAt: seq,
})
const prose = (text: string): AgentEventRecord => ({
  id: `e${++seq}`,
  sessionId: 's1',
  turnId: 't1',
  seq,
  schemaVersion: 1,
  event: { type: 'assistant_message', text, messageId: 'm1' },
  searchText: null,
  createdAt: seq,
})

describe('folding tool updates to one record a call', () => {
  it('collapses a call onto its first update and says how far it reaches', () => {
    const events = [
      tool('t1', { id: 'a', title: 'Bash', status: 'running', input: 'ls' }),
      prose('looking'),
      tool('t1', { id: 'a', output: 'one\n', outputAppend: true }),
      tool('t1', { id: 'a', output: 'two\n', outputAppend: true, status: 'completed' }),
    ]
    const folded = foldToolEvents(events)
    expect(folded.map((record) => record.id)).toEqual([events[0].id, events[1].id])
    expect(folded[0].seq).toBe(events[0].seq)
    expect(folded[0].foldedThroughSeq).toBe(events[3].seq)
    expect(folded[0].event).toEqual({
      type: 'tool',
      // Still marked as a continuation. The transcript ignores that on a record that opens a card.
      tool: { id: 'a', title: 'Bash', status: 'completed', input: 'ls', output: 'one\ntwo\n', outputAppend: true },
    })
  })

  it('continues an earlier page’s output until a row in this page replaces it', () => {
    const [continued] = foldToolEvents([
      tool('t1', { id: 'a', status: 'running' }),
      tool('t1', { id: 'a', output: 'three\n', outputAppend: true, subagentId: 'sub-1' }),
    ])
    // The opener's attribution, since that is what places the card.
    expect(continued.event.type === 'tool' && continued.event.tool).toMatchObject({
      output: 'three\n',
      outputAppend: true,
      subagentId: undefined,
    })
    const [replaced] = foldToolEvents([
      tool('t1', { id: 'a', output: 'three\n', outputAppend: true }),
      tool('t1', { id: 'a', output: 'one\ntwo\nthree\n', status: 'completed' }),
    ])
    expect(replaced.event.type === 'tool' && replaced.event.tool.outputAppend).toBeUndefined()
  })

  it('gives the same call id in another turn its own record, and leaves a lone call alone', () => {
    const events = [tool('t1', { id: 'a' }), tool('t2', { id: 'a' }), tool(null, { id: 'a' })]
    expect(foldToolEvents(events)).toEqual(events)
  })
})

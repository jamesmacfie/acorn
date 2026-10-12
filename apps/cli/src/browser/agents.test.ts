import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventRecord, AgentSessionSnapshot } from '@acorn/plugin-agents/contract/wire.ts'
import type { BridgeAgentHint } from '@acorn/protocol/extensionBridge.ts'
import { agentHints, bridgeSessionRead } from './agents'

const record = (seq: number, event: AgentEventRecord['event'], extra: Partial<AgentEventRecord> = {}) =>
  ({
    id: `e${seq}`,
    sessionId: 's1',
    turnId: 't1',
    seq,
    schemaVersion: 1,
    createdAt: seq,
    event,
    ...extra,
  }) as AgentEventRecord

const snapshot = (events: AgentEventRecord[], turns: Partial<AgentSessionSnapshot['turns'][number]>[] = []) =>
  ({
    session: {
      id: 's1',
      taskId: 'task',
      title: 'Chat',
      providerId: 'claude',
      profileId: 'claude-code',
      kind: 'interactive',
      runtimeState: 'ready',
      attention: 'none',
      lastEventSeq: 9,
      archivedAt: null,
      updatedAt: 5,
      config: { large: 'x'.repeat(1000) },
    },
    turns,
    events,
    requests: [],
  }) as unknown as AgentSessionSnapshot

describe('session pages for the sidebar', () => {
  it('keeps messages, tool summaries, and errors, and drops tool output and subagent streams', () => {
    const read = bridgeSessionRead(
      'n1',
      snapshot([
        record(1, { type: 'user_message', text: 'hi' }),
        record(2, { type: 'reasoning', text: 'thinking' }),
        record(
          3,
          {
            type: 'tool',
            tool: { id: 'tool-1', title: 'Run tests', status: 'completed', output: 'x'.repeat(10_000) },
          },
          { foldedThroughSeq: 6 },
        ),
        record(7, { type: 'assistant_message', text: 'done', messageId: 'm1', append: true }),
        record(8, { type: 'assistant_message', text: 'child', subagentId: 'sub' }),
        record(9, { type: 'error', code: 'x', message: 'Broke', retryable: false }),
      ]),
      0,
    )
    expect(read.records.map((row) => row.event)).toEqual([
      { type: 'user_message', text: 'hi' },
      { type: 'tool', toolId: 'tool-1', title: 'Run tests', status: 'completed' },
      { type: 'assistant_message', text: 'done', messageId: 'm1', append: true },
      { type: 'error', message: 'Broke' },
    ])
    expect(read.records[1]).toMatchObject({ seq: 3, foldedThroughSeq: 6 })
    expect(read.reach).toBe(9)
    expect(read.session).not.toHaveProperty('config')
  })

  it('reaches past the events it leaves out, and lists only queued turns', () => {
    const read = bridgeSessionRead(
      'n1',
      snapshot(
        [record(4, { type: 'reasoning', text: 'thinking' })],
        [
          { id: 'done', status: 'completed', input: [{ type: 'text', text: 'old' }] },
          { id: 'next', status: 'queued', input: [{ type: 'text', text: 'later' }] },
        ],
      ),
      3,
    )
    expect(read.records).toEqual([])
    expect(read.reach).toBe(4)
    expect(read.queued).toEqual([{ id: 'next', text: 'later' }])
  })
})

describe('agent hints', () => {
  afterEach(() => vi.useRealTimers())

  it('gathers a burst of frames into one hint naming each session and task once', () => {
    vi.useFakeTimers()
    const sent: BridgeAgentHint[] = []
    const hints = agentHints((hint) => sent.push(hint), 100)
    hints.note('n1', { channel: 'agent:event', event: { sessionId: 's1' } })
    hints.note('n1', { channel: 'agent:event', event: { sessionId: 's1' } })
    hints.note('n1', { channel: 'agent:session', session: { id: 's2', taskId: 't1' } })
    hints.note('n1', { channel: 'term:status', sessionId: 'other' })
    expect(sent).toEqual([])
    vi.advanceTimersByTime(100)
    expect(sent).toEqual([{ nodeId: 'n1', sessions: ['s1', 's2'], tasks: ['t1'], missed: false }])
  })

  it('says frames were missed when the Node shed them', () => {
    vi.useFakeTimers()
    const sent: BridgeAgentHint[] = []
    const hints = agentHints((hint) => sent.push(hint), 100)
    hints.note('n1', { channel: 'ws:shed' })
    vi.advanceTimersByTime(100)
    expect(sent).toEqual([{ nodeId: 'n1', sessions: [], tasks: [], missed: true }])
  })
})

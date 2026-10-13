import { describe, expect, it } from 'vitest'
import type { AgentEventRecord, AgentSession, AgentSessionSnapshot, AgentTurn } from '../../contract/wire.ts'
import { mergeManagedSnapshot, newestManagedSession } from './managedSnapshot'

const session = (lastEventSeq: number): AgentSession => ({
  id: 'session',
  taskId: 'task',
  providerId: 'codex',
  profileId: 'codex',
  kind: 'interactive',
  driverKind: 'codex-app-server',
  driverVersion: 'test',
  providerSessionRef: null,
  controller: 'acorn',
  runtimeState: 'working',
  attention: 'none',
  statusAuthority: 'protocol',
  title: 'Test',
  model: null,
  config: {},
  parentSessionId: null,
  parentTurnId: null,
  subagents: [],
  queuedTurns: 0,
  lastEventSeq,
  lastReadSeq: 0,
  archivedAt: null,
  createdAt: 1,
  updatedAt: lastEventSeq,
})

const event = (seq: number, text: string): AgentEventRecord => ({
  id: `event-${seq}`,
  sessionId: 'session',
  turnId: 'turn',
  seq,
  schemaVersion: 1,
  event: { type: 'assistant_message', text },
  searchText: text,
  createdAt: seq,
})

const snapshot = (lastEventSeq: number, events: AgentEventRecord[]): AgentSessionSnapshot => ({
  session: session(lastEventSeq),
  turns: [],
  events,
  requests: [],
})

describe('managed-agent snapshot reconciliation', () => {
  it('does not let a slower mutation response replace a newer WebSocket session row', () => {
    const connected = { ...session(1), runtimeState: 'connecting' as const, updatedAt: 20 }
    const creationResponse = { ...session(0), runtimeState: 'creating' as const, updatedAt: 10 }

    expect(newestManagedSession(connected, creationResponse)).toBe(connected)
    expect(newestManagedSession(creationResponse, connected)).toBe(connected)
  })

  it('does not lose a live event when an older HTTP snapshot resolves later', () => {
    const live = snapshot(2, [event(1, 'first'), event(2, 'live')])
    const staleHttp = snapshot(1, [event(1, 'first')])

    const merged = mergeManagedSnapshot(live, staleHttp)

    expect(merged.session.lastEventSeq).toBe(2)
    expect(merged.events.map((record) => record.event)).toEqual([
      { type: 'assistant_message', text: 'first' },
      { type: 'assistant_message', text: 'live' },
    ])
  })
})

describe('steered turns', () => {
  const queued = (status: AgentTurn['status']): AgentTurn => ({
    id: 'queued',
    sessionId: 'session',
    ordinal: 1,
    source: 'interactive',
    status,
    input: [{ type: 'text', text: 'Stop' }],
    effectivePolicy: {},
    providerTurnRef: null,
    stopReason: null,
    usage: null,
    error: null,
    attempt: 0,
    createdAt: 1,
    startedAt: null,
    completedAt: null,
  })

  it('drops a held steering row that a later read lists as steered', () => {
    const held = { ...snapshot(1, []), turns: [queued('steering')] }
    const read = { ...snapshot(2, []), steeredTurns: [queued('steered')] }
    const merged = mergeManagedSnapshot(held, read)
    expect(merged.turns).toEqual([])
    expect(merged.steeredTurns?.map((turn) => turn.status)).toEqual(['steered'])
  })

  it('keeps a held queued row a read missed, as for any turn', () => {
    const merged = mergeManagedSnapshot({ ...snapshot(1, []), turns: [queued('queued')] }, snapshot(2, []))
    expect(merged.turns.map((turn) => turn.id)).toEqual(['queued'])
  })
})

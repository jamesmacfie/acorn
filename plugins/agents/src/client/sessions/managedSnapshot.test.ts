import { describe, expect, it } from 'vitest'
import type {
  AgentEventRecord,
  AgentSession,
  AgentSessionSnapshot,
} from '@acorn/protocol/managedAgents.ts'
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
  subagents: [], queuedTurns: 0,
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

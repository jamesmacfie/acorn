import { describe, expect, it } from 'vitest'
import type {
  AgentEventRecord,
  AgentSession,
  AgentSessionSnapshot,
} from '../../../core/shared/managedAgents'
import { mergeManagedSnapshot } from './managedSnapshot'

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

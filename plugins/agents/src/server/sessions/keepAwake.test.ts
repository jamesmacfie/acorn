import { describe, expect, it } from 'vitest'
import type { AgentSession, AgentWsFrame } from '../../contract/wire'
import { holdAwakeWhileBusy } from './keepAwake'

const session = (over: Partial<AgentSession>): AgentSession => ({
  id: 's1',
  taskId: 't1',
  providerId: 'claude',
  profileId: 'p',
  kind: 'interactive',
  driverKind: 'd',
  driverVersion: '1',
  providerSessionRef: null,
  controller: 'acorn',
  runtimeState: 'working',
  attention: 'none',
  statusAuthority: 'protocol',
  title: 'claude',
  model: null,
  config: {},
  parentSessionId: null,
  parentTurnId: null,
  subagents: [],
  queuedTurns: 0,
  lastEventSeq: 0,
  lastReadSeq: 0,
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

function harness() {
  let listener: ((frame: AgentWsFrame) => void) | null = null
  const counts = { holds: 0, releases: 0 }
  const stop = holdAwakeWhileBusy(
    (next) => {
      listener = next
      return () => (listener = null)
    },
    () => {
      counts.holds += 1
      return () => (counts.releases += 1)
    },
  )
  const send = (over: Partial<AgentSession>) => listener!({ channel: 'agent:session', session: session(over) })
  return { counts, send, stop, emit: (frame: AgentWsFrame) => listener!(frame), listening: () => listener !== null }
}

describe('holdAwakeWhileBusy', () => {
  it('holds one lease from working through blocked and releases it once at finished', () => {
    const { counts, send } = harness()
    send({ runtimeState: 'working' })
    send({ runtimeState: 'working', attention: 'question' })
    send({ runtimeState: 'working', attention: 'permission' })
    expect(counts).toEqual({ holds: 1, releases: 0 })
    send({ runtimeState: 'ready', attention: 'completed' })
    send({ runtimeState: 'ready', attention: 'none' })
    expect(counts).toEqual({ holds: 1, releases: 1 })
  })

  it('releases a deleted session and every lease when it stops', () => {
    const { counts, send, emit, stop, listening } = harness()
    send({ id: 'a' })
    send({ id: 'b' })
    emit({ channel: 'agent:deleted', sessionId: 'a' })
    expect(counts).toEqual({ holds: 2, releases: 1 })
    stop()
    expect(counts).toEqual({ holds: 2, releases: 2 })
    expect(listening()).toBe(false)
  })
})

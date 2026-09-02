// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { AgentSession, AgentAttentionReason, AgentRuntimeState } from '@acorn/protocol/managedAgents.ts'
import type { AgentState, TerminalSession } from '@acorn/protocol/terminal.ts'
import {
  edgesBetween, fromManagedSession, fromTerminalSession, type AttentionState, type Snapshot,
} from './attention'

const STATES: AttentionState[] = ['working', 'blocked', 'finished', 'error', 'idle']

const snap = (state: AttentionState, over: Partial<Snapshot> = {}): Snapshot =>
  ({ nodeId: 'n1', sessionId: 's1', taskId: 't1', title: 'claude', state, kind: 'interactive', ...over })

const from = (before: Snapshot | null, after: Snapshot) =>
  edgesBetween(before ? new Map([[`${before.nodeId}:${before.sessionId}`, before]]) : new Map(), [after])

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
    for (const kind of ['workflow', 'imported'] as const)
      expect(from(snap('working', { kind }), snap('finished', { kind }))).toEqual([])
    for (const kind of ['interactive', 'pty'] as const)
      expect(from(snap('working', { kind }), snap('finished', { kind }))).toHaveLength(1)
    // Blocked and error are news whatever the kind: a gate needs answering.
    expect(from(snap('working', { kind: 'workflow' }), snap('blocked', { kind: 'workflow' }))).toHaveLength(1)
  })

  it('a first sighting is not news, and neither is standing still', () => {
    expect(from(null, snap('blocked'))).toEqual([])
    expect(from(snap('blocked'), snap('blocked'))).toEqual([])
  })

  // Session ids are node-minted, so the same one on two nodes is two sessions.
  it('keys by node as well as session', () => {
    expect(from(snap('working'), snap('blocked', { nodeId: 'n2' }))).toEqual([])
  })
})

const session = (over: Partial<AgentSession>): AgentSession => ({
  id: 's1', taskId: 't1', providerId: 'claude', profileId: 'p', kind: 'interactive',
  driverKind: 'd', driverVersion: '1', providerSessionRef: null, controller: 'acorn',
  runtimeState: 'working', attention: 'none', statusAuthority: 'protocol', title: 'claude',
  model: null, config: {}, parentSessionId: null, parentTurnId: null, subagents: [],
  lastEventSeq: 0, lastReadSeq: 0, archivedAt: null, createdAt: 0, updatedAt: 0, ...over,
})

describe('the managed adapter (docs/notifications.md)', () => {
  const state = (attention: AgentAttentionReason, runtimeState: AgentRuntimeState) =>
    fromManagedSession(session({ attention, runtimeState }), 'n1').state

  it('reads attention first, then the runtime state', () => {
    for (const reason of ['permission', 'question', 'workflow_gate'] as const)
      expect(state(reason, 'working')).toBe('blocked')
    expect(state('completed', 'ready')).toBe('finished')
    expect(state('error', 'working')).toBe('error')
    // An attention reason outranks the runtime state: a failed process still asking a question is
    // a question.
    expect(state('permission', 'failed')).toBe('blocked')
  })

  it('maps every runtime state when nothing is asking', () => {
    for (const reason of ['none', 'unread'] as const) {
      for (const running of ['working', 'waiting', 'cancelling', 'reconnecting', 'connecting', 'replaying', 'creating'] as const)
        expect(state(reason, running)).toBe('working')
      for (const resting of ['ready', 'stopped', 'archived'] as const)
        expect(state(reason, resting)).toBe('idle')
      expect(state(reason, 'failed')).toBe('error')
    }
  })

  it('falls back to the provider when a session has no title', () => {
    expect(fromManagedSession(session({ title: '' }), 'n1').title).toBe('claude')
  })
})

const pty = (over: Partial<TerminalSession>): TerminalSession => ({
  id: 's1', taskId: 't1', title: 'codex', kind: 'agent', status: 'running', idle: false,
  agentState: 'working', exitCode: null, ...over,
} as TerminalSession)

describe('the PTY adapter', () => {
  const state = (over: Partial<TerminalSession>) => fromTerminalSession(pty(over), 'n1')?.state

  it('maps status, agent state, idle and exit code', () => {
    for (const blocked of ['blocked', 'permission'] as AgentState[]) expect(state({ agentState: blocked })).toBe('blocked')
    expect(state({ idle: false })).toBe('working')
    expect(state({ idle: true })).toBe('finished')
    // A blocked agent that has also gone quiet is blocked, not finished.
    expect(state({ idle: true, agentState: 'blocked' })).toBe('blocked')
    expect(state({ status: 'exited', exitCode: 0 })).toBe('idle')
    expect(state({ status: 'exited', exitCode: null })).toBe('idle')
    expect(state({ status: 'exited', exitCode: 1 })).toBe('error')
  })

  // A plain terminal exiting is not an agent needing you.
  it('ignores a shell', () => {
    expect(fromTerminalSession(pty({ kind: 'shell' }), 'n1')).toBeNull()
  })
})

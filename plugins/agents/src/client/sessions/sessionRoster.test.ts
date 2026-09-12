import { describe, expect, it } from 'vitest'
import type { AgentSession, AgentSessionDelegation, AgentSubagent } from '@acorn/protocol/managedAgents.ts'
import { agentSessionRoster, delegationSummary } from './sessionRoster'

const session = (id: string, over: Partial<AgentSession> = {}): AgentSession => ({
  id,
  taskId: 'task-1',
  providerId: 'codex',
  profileId: 'codex',
  kind: 'interactive',
  driverKind: 'codex-app-server',
  driverVersion: '1',
  providerSessionRef: null,
  controller: 'acorn',
  runtimeState: 'ready',
  attention: 'none',
  statusAuthority: 'protocol',
  title: id,
  model: null,
  config: {},
  parentSessionId: null,
  parentTurnId: null,
  subagents: [], queuedTurns: 0,
  lastEventSeq: 0,
  lastReadSeq: 0,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const managed = (sessionId: string, parentSessionId: string, depth: number): AgentSessionDelegation => ({
  sessionId,
  depth,
  isolation: 'shared',
  owner: { kind: 'managed', parentSessionId },
})

describe('managed session roster', () => {
  it('nests delegated sessions beneath managed parents while preserving sibling order', () => {
    const rows = agentSessionRoster(
      [session('child-2'), session('root'), session('child-1'), session('other')],
      {
        'child-1': managed('child-1', 'root', 1),
        'child-2': managed('child-2', 'root', 1),
      },
    )
    expect(rows.map((row) => [row.key, row.depth])).toEqual([
      ['root', 0],
      ['child-2', 1],
      ['child-1', 1],
      ['other', 0],
    ])
  })

  it('keeps terminal-owned and orphaned children visible without inventing parent rows', () => {
    const rows = agentSessionRoster(
      [session('terminal-child'), session('orphan')],
      {
        'terminal-child': {
          sessionId: 'terminal-child',
          depth: 1,
          isolation: 'shared',
          owner: { kind: 'terminal', label: 'Codex terminal', profileId: 'codex' },
        },
        orphan: managed('orphan', 'missing', 2),
      },
    )
    expect(rows.map((row) => [row.key, row.depth])).toEqual([
      ['terminal-child', 0],
      ['orphan', 0],
    ])
    const terminal = rows[0]
    const orphan = rows[1]
    expect(terminal?.kind === 'managed' ? delegationSummary(terminal) : null)
      .toBe('Delegated by Codex terminal (codex) · depth 1 · shared')
    expect(orphan?.kind === 'managed' ? delegationSummary(orphan) : null)
      .toBe('Delegated · parent unavailable · depth 2 · shared')
  })

  it('keeps provider-native subagents directly beneath their provider session', () => {
    const native: AgentSubagent = {
      id: 'native-1',
      turnId: null,
      title: 'Provider child',
      status: 'running',
      startedAt: 1,
      updatedAt: 2,
    }
    const rows = agentSessionRoster(
      [session('managed-child', { subagents: [native] }), session('root')],
      { 'managed-child': managed('managed-child', 'root', 1) },
    )
    expect(rows.map((row) => [row.kind, row.key, row.depth])).toEqual([
      ['managed', 'root', 0],
      ['managed', 'managed-child', 1],
      ['provider-subagent', 'managed-child/native-1', 2],
    ])
  })

  it('does not lose malformed cyclic rows', () => {
    const rows = agentSessionRoster(
      [session('a'), session('b')],
      { a: managed('a', 'b', 1), b: managed('b', 'a', 2) },
    )
    expect(rows.map((row) => [row.key, row.depth])).toEqual([['a', 0], ['b', 0]])
    expect(rows.every((row) => row.kind !== 'managed' || row.managedParent === null)).toBe(true)
  })
})

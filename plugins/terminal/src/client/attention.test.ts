// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { AgentState } from '@acorn/protocol/sessionActivity.ts'
import type { TerminalSession } from '../contract/wire'
import { fromTerminalSession } from './attention'

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

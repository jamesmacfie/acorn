import { describe, expect, it } from 'vitest'
import type { TerminalSession } from '../../../shared/terminal'
import type { WorkflowRunRow, WorkflowStepRow } from '../terminal/terminalClient'
import { buildRoster, feedFromEvents, resumeCommandFor, streamJsonToAgentState, streamJsonToFeedItems } from './model'

describe('streamJsonToAgentState (the 15 §status table)', () => {
  it.each([
    [{ type: 'system', subtype: 'init' }, 'starting'],
    [{ type: 'assistant' }, 'working'],
    [{ type: 'tool_use' }, 'working'],
    [{ type: 'tool_result' }, 'working'],
    [{ type: 'permission_request' }, 'blocked'],
    [{ type: 'result' }, 'done'],
    [{ type: 'mystery' }, 'unknown'],
  ])('%j → %s', (event, expected) => {
    expect(streamJsonToAgentState(event)).toBe(expected)
  })
})

describe('feed items from stream-json', () => {
  it('maps message/thinking/tool_call/tool_result/result (+cost) per the 15 table', () => {
    const events = [
      { type: 'system', subtype: 'init', model: 'opus' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'Let me check the login flow' },
            { type: 'text', text: 'Guarding the null token…' },
            { type: 'tool_use', name: 'Edit', input: { file: 'src/auth/login.ts' } },
          ],
        },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'result', result: 'Done.', total_cost_usd: 0.04 },
    ]
    expect(feedFromEvents(events)).toEqual([
      { kind: 'status', text: 'session started (opus)' },
      { kind: 'thinking', text: 'Let me check the login flow' },
      { kind: 'message', text: 'Guarding the null token…' },
      { kind: 'tool_call', text: 'Edit {"file":"src/auth/login.ts"}' },
      { kind: 'tool_result', text: 'ok' },
      { kind: 'result', text: 'Done.', costUsd: 0.04 },
    ])
  })
  it('unknown/empty events produce nothing', () => {
    expect(streamJsonToFeedItems({ type: 'weird' })).toEqual([])
    expect(streamJsonToFeedItems({ type: 'assistant', message: { content: [] } })).toEqual([])
  })
})

const session = (over: Partial<TerminalSession>): TerminalSession => ({
  id: 's1',
  title: 'claude',
  kind: 'agent',
  profileId: 'claude-code',
  backend: 'node-pty',
  status: 'running',
  idle: false,
  agentState: 'working',
  isWorktree: true,
  taskId: 't1',
  cwd: '/wt',
  command: 'claude',
  cols: 80,
  rows: 24,
  createdAt: 100,
  exitCode: null,
  ...over,
})

const step = (over: Partial<WorkflowStepRow>): WorkflowStepRow => ({
  id: 'st1',
  runId: 'r1',
  idx: 0,
  name: 'review',
  kind: 'agent',
  mode: 'headless',
  profileId: 'claude-code',
  model: null,
  status: 'done',
  resultJson: null,
  structuredJson: null,
  sessionId: 'sess-9',
  costUsd: 0.04,
  iteration: 0,
  error: null,
  createdAt: 50,
  updatedAt: 60,
  ...over,
})

const run: WorkflowRunRow = { id: 'r1', taskId: 't1', name: 'build-review', status: 'running', posture: 'gated', error: null, createdAt: 1, updatedAt: 2 }

describe('resumeCommandFor (15 P2 — open in terminal)', () => {
  it('builds the resume command per profile from the captured session id', () => {
    expect(resumeCommandFor({ profileId: 'claude-code', sessionId: 'sess-9', resumeCommand: 'claude --resume sess-9' })).toBe('claude --resume sess-9')
    expect(resumeCommandFor({ profileId: 'codex', sessionId: 'abc123', resumeCommand: 'codex resume abc123' })).toBe('codex resume abc123')
    expect(resumeCommandFor({ profileId: 'claude-code', sessionId: null })).toBeNull()
    // Shell-metachar session ids are refused (the command runs through $SHELL -lc).
    expect(resumeCommandFor({ profileId: 'claude-code', sessionId: 'x; rm -rf /', resumeCommand: 'unsafe' })).toBeNull()
  })
})

describe('gate-in-feed model (15 P2): a waiting-gate step surfaces as a gated roster row', () => {
  it('the row the approve action targets carries runId + stepId for the 6.3 IPC', () => {
    const gated = step({ id: 'gate-1', name: 'ship?', kind: 'gate-human', status: 'waiting-gate' })
    const roster = buildRoster('t1', [], [gated], [run])
    const row = roster[0]
    expect(row.kind).toBe('step')
    if (row.kind === 'step') {
      expect(row.gate).toBe(true)
      // These two ids are exactly what api.workflow.gate(runId, stepId, approved) consumes.
      expect(row.step.runId).toBe('r1')
      expect(row.step.id).toBe('gate-1')
    }
  })
})

describe('buildRoster (sessions + steps merged, needs-you first)', () => {
  it('merges, orders blocked → working → rest, and marks gates', () => {
    const roster = buildRoster(
      't1',
      [session({}), session({ id: 's2', taskId: 'other' }), session({ id: 's3', title: 'shell', kind: 'shell', agentState: 'unknown', createdAt: 500 })],
      [step({}), step({ id: 'st2', name: 'ship?', kind: 'gate-human', status: 'waiting-gate', updatedAt: 70 }), step({ id: 'st3', status: 'pending' })],
      [run],
    )
    expect(roster.map((r) => r.id)).toEqual(['st2', 's1', 's3', 'st1'])
    const gate = roster[0]
    expect(gate.kind).toBe('step')
    if (gate.kind === 'step') {
      expect(gate.gate).toBe(true)
      expect(gate.title).toBe('build-review · ship?')
      expect(gate.state).toBe('blocked')
    }
    // other-task sessions + pending steps excluded
    expect(roster.some((r) => r.id === 's2' || r.id === 'st3')).toBe(false)
  })
})

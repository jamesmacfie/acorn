import { describe, expect, it } from 'vitest'
import { subagentStatusLabel, subagentSummary } from './subagentDisplay'

describe('subagent display', () => {
  it('calls a resting subagent idle, the same word a session at rest gets', () => {
    expect(subagentStatusLabel('idle')).toBe('Idle')
  })

  it('reports only what the harness actually sent', () => {
    // Codex mid-run: no model, ever, so the session's own stands in for the one the child inherited.
    expect(subagentSummary({ id: 's1', title: 'alpha', status: 'running' }, 'GPT-5.6 Sol'))
      .toBe('Working · GPT-5.6 Sol')
    // Claude at completion: model, tool uses and duration all arrive together, and the child's own
    // model wins over the session's.
    expect(subagentSummary({
      id: 's2',
      title: 'Read alpha.txt first line',
      status: 'completed',
      role: 'general-purpose',
      model: 'claude-opus-5[1m]',
      toolUseCount: 3,
      durationMs: 1_538,
    }, 'claude-sonnet-5')).toBe('Completed · general-purpose · claude-opus-5[1m] · 3 tool uses · 1.5s')
  })

  it('says nothing about a model nobody named', () => {
    expect(subagentSummary({ id: 's1', title: 'alpha', status: 'running' })).toBe('Working')
  })

  it('does not say the name twice', () => {
    // Codex names a subagent from its agent path, so title and role are the same word.
    expect(subagentSummary({ id: 's1', title: 'alpha', role: 'alpha', status: 'idle' })).toBe('Idle')
  })

  it('agrees with itself about one tool use', () => {
    expect(subagentSummary({ id: 's1', title: 'x', status: 'completed', toolUseCount: 1 }))
      .toBe('Completed · 1 tool use')
  })
})

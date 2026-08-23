import { describe, expect, it } from 'vitest'
import { subagentStatusLabel, subagentSummary } from './subagentDisplay'

describe('subagent display', () => {
  it('says idle in full', () => {
    // "Idle" alone reads as stalled. A Codex child at rest is finished and resumable, which is the
    // opposite of stuck.
    expect(subagentStatusLabel('idle')).toBe('Idle, resumable')
  })

  it('reports only what the harness actually sent', () => {
    // Codex mid-run: a live token count off the child thread, and no model, ever.
    expect(subagentSummary({ id: 's1', title: 'alpha', status: 'running', usage: { contextUsed: 20_740 } }))
      .toBe('Working · 20,740 tok')
    // Claude at completion: model, tokens, tool uses and duration all arrive together.
    expect(subagentSummary({
      id: 's2',
      title: 'Read alpha.txt first line',
      status: 'completed',
      role: 'general-purpose',
      model: 'claude-opus-5[1m]',
      usage: { contextUsed: 17_375 },
      toolUseCount: 3,
      durationMs: 1_538,
    })).toBe('Completed · general-purpose · claude-opus-5[1m] · 17,375 tok · 3 tool uses · 1.5s')
  })

  it('does not say the name twice', () => {
    // Codex names a subagent from its agent path, so title and role are the same word.
    expect(subagentSummary({ id: 's1', title: 'alpha', role: 'alpha', status: 'idle' })).toBe('Idle, resumable')
  })

  it('agrees with itself about one tool use', () => {
    expect(subagentSummary({ id: 's1', title: 'x', status: 'completed', toolUseCount: 1 }))
      .toBe('Completed · 1 tool use')
  })
})

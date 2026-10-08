import { describe, expect, it } from 'vitest'
import type { AgentEventRecord, AgentSession, AgentTurn } from '../../contract/wire.ts'
import { goalDecision, goalEvidence, parseGoalVerdict } from './sessionGoal'

const verdict = (blocker: 'none' | 'missing_evidence' | 'needs_user_input' | 'run_failed' | 'external_wait' | 'goal_not_met_yet') =>
  parseGoalVerdict(JSON.stringify({ satisfied: blocker === 'none', blocker, reason: 'Reason',
    evidence_summary: 'Evidence', relied_on_assumption: false }), 'turn')

const session = (continuations = 0, noProgress = 0) => ({ goal: {
  objective: 'Finish the migration', status: 'active', continuations, noProgress, verdict: null,
} }) as AgentSession
const turn = (source: AgentTurn['source'] = 'goal') => ({ id: 'turn', source }) as AgentTurn
const event = (value: AgentEventRecord['event']) => ({ event: value } as AgentEventRecord)

describe('session goal verdict', () => {
  it.each(['none', 'missing_evidence', 'needs_user_input', 'run_failed', 'external_wait', 'goal_not_met_yet'] as const)(
    'accepts %s', (blocker) => expect(verdict(blocker).blocker).toBe(blocker))

  it('rejects contradictory and incomplete JSON', () => {
    expect(() => parseGoalVerdict('{"satisfied":true,"blocker":"goal_not_met_yet","reason":"x","evidence_summary":"x","relied_on_assumption":false}', 't')).toThrow()
    expect(() => parseGoalVerdict('{"satisfied":true}', 't')).toThrow()
    expect(() => parseGoalVerdict('not JSON', 't')).toThrow()
  })

  it('stops after eight continuations and two without tool or file progress', () => {
    expect(goalDecision(session(8), turn(), verdict('goal_not_met_yet'), []).status).toBe('exhausted')
    expect(goalDecision(session(1, 1), turn(), verdict('goal_not_met_yet'), []).status).toBe('exhausted')
    expect(goalDecision(session(1, 1), turn(), verdict('goal_not_met_yet'), [event({ type: 'file_change', path: 'a.ts' })]))
      .toMatchObject({ status: 'active', noProgress: 0 })
    expect(goalDecision(session(), turn('interactive'), verdict('goal_not_met_yet'), []).noProgress).toBe(0)
  })

  it('stops on every blocker other than work remaining', () => {
    for (const blocker of ['missing_evidence', 'needs_user_input', 'run_failed', 'external_wait'] as const) {
      expect(goalDecision(session(), turn(), verdict(blocker), []).status).toBe('blocked')
    }
    expect(goalDecision(session(), turn(), verdict('none'), []).status).toBe('satisfied')
  })

  it('labels requests and evidence, omits automatic prompts, and bounds tool text', () => {
    const evidence = goalEvidence('Finish', [
      event({ type: 'user_message', text: 'Do the work' }),
      event({ type: 'user_message', text: 'Internal goal nudge', automatic: true }),
      event({ type: 'tool', tool: { id: 't', title: 'Tests', input: 'i'.repeat(300), output: 'o'.repeat(300) } }),
      event({ type: 'assistant_message', text: 'Tests passed' }),
    ])
    expect(evidence).toContain('User request: Do the work')
    expect(evidence).toContain('Assistant evidence: Tests passed')
    expect(evidence).not.toContain('Internal goal nudge')
    expect(evidence).not.toContain('i'.repeat(201))
    expect(evidence).not.toContain('o'.repeat(201))
    expect(evidence.length).toBeLessThanOrEqual(12_000)
  })
})

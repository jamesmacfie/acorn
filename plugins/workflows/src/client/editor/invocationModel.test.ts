import { describe, expect, it } from 'vitest'
import type { WorkflowInvocationReview } from '../../shared/workflowInvocation'
import { initialInvocationForm, invocationApproval, invocationStatus } from './invocationModel'

const review = (patch: Partial<WorkflowInvocationReview> = {}): WorkflowInvocationReview => ({
  definitionKey: 'db:flow', workflowName: 'Flow', definitionDigest: 'd', graphDigest: 'g', posture: 'gated',
  nodes: [], inputs: [], inputUses: [],
  defaults: { limits: { maxTurns: 20, maxWallTimeMs: 3_600_000 }, startsPerSession: 5 },
  policy: null, changed: false, ...patch,
})

describe('invocation review model', () => {
  it('starts from the defaults, or from the active approval', () => {
    expect(initialInvocationForm(review())).toEqual({
      callerInputs: [], fixedInputs: {}, maxTurns: '20', maxMinutes: '60', maxCostUsd: '', startsPerSession: '5',
    })
    const policy = {
      id: 'p', projectId: 'project', definitionKey: 'db:flow', state: 'active' as const, graphDigest: 'g', definitionDigest: 'd',
      callerInputs: ['ticket'], fixedInputs: { area: 'billing' }, limits: { maxTurns: 3, maxWallTimeMs: 600_000, maxCostUsd: 2 }, startsPerSession: 2, updatedAt: 0,
    }
    expect(initialInvocationForm(review({ policy }))).toMatchObject({ callerInputs: ['ticket'], maxTurns: '3', maxMinutes: '10', maxCostUsd: '2', startsPerSession: '2' })
    expect(invocationStatus(review({ policy, changed: true }))).toEqual({ tone: 'warn', label: 'Changed since you approved it' })
  })

  it('builds the approval for the reviewed graph and drops fixed values the agent may set', () => {
    const form = { ...initialInvocationForm(review()), callerInputs: ['ticket'], fixedInputs: { ticket: 'x', area: 'billing' }, maxCostUsd: '1.5' }
    expect(invocationApproval(review(), 'project', form)).toEqual({
      approval: {
        projectId: 'project', definitionKey: 'db:flow', graphDigest: 'g', callerInputs: ['ticket'], fixedInputs: { area: 'billing' },
        limits: { maxTurns: 20, maxWallTimeMs: 3_600_000, maxCostUsd: 1.5 }, startsPerSession: 5,
      },
    })
    expect(invocationApproval(review(), 'project', { ...form, maxTurns: '0' })).toEqual({ problem: 'Set the most turns a run may take.' })
    expect(invocationApproval(review(), 'project', { ...form, maxCostUsd: '-1' })).toMatchObject({ problem: expect.stringContaining('cost') })
  })
})

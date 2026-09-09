import { describe, expect, it } from 'vitest'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import { workflowRunOf } from './workflowRun'

// Which rows in Agent Center get a way back to the run.
//
// The ids are on the session's own config from the moment the node creates it, which is what lets a
// row point at a step that is still running. A session a person started has none of this and must not
// grow a chip that goes nowhere.

const session = (fields: Partial<AgentSession>): AgentSession =>
  ({ id: 's1', kind: 'interactive', config: {}, ...fields }) as AgentSession

describe('the run behind a session', () => {
  it('names the run and the step a workflow started it for', () => {
    expect(workflowRunOf(session({
      kind: 'workflow',
      config: { workflowRunId: 'run-1', workflowStepId: 'st-2' },
    }))).toEqual({ runId: 'run-1', stepId: 'st-2' })
  })

  it('names the run alone when there is no step', () => {
    expect(workflowRunOf(session({ kind: 'workflow', config: { workflowRunId: 'run-1' } })))
      .toEqual({ runId: 'run-1', stepId: undefined })
  })

  it('is nothing for a session a person started', () => {
    expect(workflowRunOf(session({ config: { workflowRunId: 'run-1' } }))).toBeUndefined()
  })

  it('is nothing for a workflow session with no run on it', () => {
    // A config that never carried the ids, or one an older node wrote. A chip here would open a run
    // that does not exist.
    expect(workflowRunOf(session({ kind: 'workflow' }))).toBeUndefined()
    expect(workflowRunOf(session({ kind: 'workflow', config: { workflowRunId: '' } }))).toBeUndefined()
  })
})

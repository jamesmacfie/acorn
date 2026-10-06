import { parseDataSchema } from '@acorn/protocol/dataSchemas.ts'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import type { WorkflowDef, WorkflowStepDef } from './workflowContracts'

/** An agent item uses the durable run lifecycle in its parent's task. It has no saved definition. */
export function agentMapWorkflow(step: WorkflowStepDef): WorkflowDef {
  if (!step.agent) throw new Error('The loop has no agent configuration.')
  const { onFailure: _onFailure, ...agent } = step.agent
  return {
    baseline: ACORN_BASELINE,
    formatVersion: 1,
    name: step.name,
    inputs: [{ name: 'item', schema: { type: 'object' }, required: true }],
    steps: [{ ...agent, id: 'agent', name: step.name, kind: 'agent', after: [], inputs: 'none' }],
    outputs: agent.schema ? [{ name: 'result', schema: parseDataSchema(agent.schema), binding: { address: { from: 'step', stepId: 'agent', pointer: '' } } }] : undefined,
  }
}

export const AGENT_MAP_INTERRUPTED = 'Interrupted during restart. Review the session and working tree before retrying.'

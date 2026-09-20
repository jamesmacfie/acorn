import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { WorkflowDef, WorkflowStepDef } from '../../shared/workflowContracts'

export const CHILD_RECORD_INPUT = 'record'

export function childWorkflowDefinition(parentName: string, itemSchema: DataSchema): WorkflowDef {
  return {
    formatVersion: 2,
    name: `${parentName} item`,
    inputs: [{
      name: CHILD_RECORD_INPUT,
      label: 'Current record',
      description: 'The typed record selected by the parent workflow.',
      schema: itemSchema,
      required: true,
    }],
    steps: [],
  }
}

/** Configure the parent in the same edit that creates the child, including typed current-record prefill. */
export function connectCreatedChild(step: WorkflowStepDef, childId: string): Partial<WorkflowStepDef> {
  return {
    childWorkflow: {
      ref: { source: 'database', id: childId },
      inputs: {
        ...step.childWorkflow?.inputs,
        [CHILD_RECORD_INPUT]: { address: { from: 'item', pointer: '' } },
      },
    },
  }
}

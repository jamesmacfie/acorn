import type { WorkflowDef, WorkflowStepDef } from './workflowContracts'

export function stepIdentity(step: Pick<WorkflowStepDef, 'id' | 'name'>): string {
  // Editors and validators must remain able to inspect an invalid generated draft so they can
  // explain how to repair it. Persisted definitions are admitted only after the v2 parser and
  // validator require a stable id, so this fallback is never runtime compatibility authority.
  return step.id ?? step.name
}

/** A run freezes both its definition and row indices before execution. */
export function rowIdentity(def: WorkflowDef, row: { idx: number; name: string }): string {
  const step = def.steps[row.idx]
  return step ? stepIdentity(step) : row.name
}

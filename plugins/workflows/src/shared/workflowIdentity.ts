import type { WorkflowDef, WorkflowStepDef } from './workflowContracts'

export function stepIdentity(step: Pick<WorkflowStepDef, 'id' | 'name'>): string {
  // Editors and validators must remain able to inspect an invalid generated draft so they can
  // explain how to repair it. The parser and validator require a stable id before a definition is
  // persisted, so a run never relies on this fallback.
  return step.id ?? step.name
}

/** A run freezes both its definition and row indices before execution. */
export function rowIdentity(def: WorkflowDef, row: { idx: number; name: string }): string {
  const step = def.steps[row.idx]
  return step ? stepIdentity(step) : row.name
}

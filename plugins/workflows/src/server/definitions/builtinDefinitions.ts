import { stepIdentity } from '../../shared/workflowIdentity'
import type { StepValidationContext, StepValidator, WorkflowStepDef } from '../../shared/workflowContracts'

/** The built-in definition catalog shared by file validation and runtime registration. */
export const BUILTIN_STEP_KINDS = [
  'agent',
  'gate-human',
  'gate-policy',
  'ci-loop',
  'decide',
  'find-records',
  'get-record-details',
  'write-dataset',
  'if',
] as const
export const BUILTIN_POLICIES = ['checks-green', 'agent'] as const

/** Every branch names a step that waits on the branching one. Graph edges, not list position: a step
 *  that omits `after` waits on the step before it, and that implicit edge also satisfies this. */
export function branchTargetProblems(
  step: WorkflowStepDef,
  { label, indexes, precedes }: Pick<StepValidationContext, 'label' | 'indexes' | 'precedes'>,
): string[] {
  const errors: string[] = []
  for (const [verdict, target] of Object.entries(step.branches ?? {})) {
    if (!indexes.has(target)) errors.push(`${label} branch '${verdict}' has invalid target '${target}'`)
    else if (!precedes(stepIdentity(step), target))
      errors.push(`${label} branch '${verdict}' target '${target}' does not wait on ${label}`)
  }
  return errors
}

// `gate-policy` is checked in ../validation/policyGate.ts, because its timeout is held against the
// workflow's budget, which a step validator never sees.
export const BUILTIN_STEP_VALIDATORS: Partial<Record<(typeof BUILTIN_STEP_KINDS)[number], StepValidator>> = {
  decide: (step, context) => [
    ...(!step.branches || !Object.keys(step.branches).length ? [`${context.label} has no branches`] : []),
    ...branchTargetProblems(step, context),
  ],
}

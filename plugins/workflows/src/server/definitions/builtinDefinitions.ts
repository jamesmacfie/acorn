import { stepIdentity } from '../../shared/workflowIdentity'
import type { StepValidator } from '../../shared/workflowContracts'

/** The built-in definition catalog shared by file validation and runtime registration. */
export const BUILTIN_STEP_KINDS = ['agent', 'gate-human', 'gate-policy', 'ci-loop', 'decide', 'find-records', 'get-record-details', 'write-dataset', 'if'] as const
export const BUILTIN_POLICIES = ['checks-green'] as const

export const BUILTIN_STEP_VALIDATORS: Partial<Record<(typeof BUILTIN_STEP_KINDS)[number], StepValidator>> = {
  'gate-policy': (step, { label, policies }) => {
    if (!step.policy) return [`${label} has no policy`]
    return policies.has(step.policy) ? [] : [`${label} names unknown policy '${step.policy}'`]
  },
  decide: (step, { label, indexes, precedes }) => {
    const errors: string[] = []
    if (!step.branches || !Object.keys(step.branches).length) errors.push(`${label} has no branches`)
    for (const [verdict, target] of Object.entries(step.branches ?? {})) {
      // Graph edges, not list position: the target must wait for the decision. An implicit
      // predecessor in a legacy linear file also satisfies this relation.
      if (!indexes.has(target)) errors.push(`${label} branch '${verdict}' has invalid target '${target}'`)
      else if (!precedes(stepIdentity(step), target)) errors.push(`${label} branch '${verdict}' target '${target}' does not wait on ${label}`)
    }
    return errors
  },
}

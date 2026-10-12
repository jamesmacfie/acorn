// The timing and branch rules for a polling `gate-policy` and for `ci-loop`'s wait on the checks
// (docs/workflows/polling-gates.md). The policy's own settings are checked beside the
// step kinds' fields in ./definition.ts, because they use the same host-applied field checks.
import { branchTargetProblems } from '../definitions/builtinDefinitions'
import { MIN_POLL_INTERVAL_MS } from '../../shared/policyWait'
import type {
  PolicyDescription,
  StepValidationContext,
  WorkflowBudget,
  WorkflowStepDef,
} from '../../shared/workflowContracts'

const GATE_VERDICTS = new Set(['pass', 'fail', 'timed-out'])

type PolicyWaitValidation = Pick<StepValidationContext, 'label' | 'indexes' | 'precedes' | 'policies'> & {
  describePolicy?: (id: string) => PolicyDescription | undefined
  workflowBudget?: WorkflowBudget
}

const positiveInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** A wait must end before the step or the run reaches its wall-time limit. The runner's step timer
 *  restarts in full after a Node restart, so only the gate's saved deadline reports `timed-out`. */
function wallTimeProblems(
  label: string,
  field: string,
  timeoutMs: number,
  step: WorkflowStepDef,
  workflowBudget: WorkflowBudget | undefined,
): string[] {
  const limits = [step.budget?.maxWallTimeMs, workflowBudget?.maxWallTimeMs].filter(
    (limit): limit is number => limit != null,
  )
  const limit = limits.length ? Math.min(...limits) : undefined
  return limit != null && timeoutMs > limit
    ? [`${label} ${field} is longer than its wall-time limit of ${limit} ms`]
    : []
}

export function policyWaitProblems(step: WorkflowStepDef, context: PolicyWaitValidation): string[] {
  const kind = step.kind ?? 'agent'
  const { label } = context
  const errors: string[] = []
  if (kind !== 'gate-policy') {
    for (const field of ['intervalMs', 'timeoutMs'] as const)
      if (step[field] !== undefined) errors.push(`${label} is a '${kind}' step, which cannot take ${field}`)
  }
  if (kind !== 'ci-loop' && step.checksTimeoutMs !== undefined)
    errors.push(`${label} is a '${kind}' step, which cannot take checksTimeoutMs`)
  if (kind === 'ci-loop' && step.checksTimeoutMs !== undefined) {
    if (!positiveInteger(step.checksTimeoutMs)) errors.push(`${label} checksTimeoutMs must be a positive integer`)
    else errors.push(...wallTimeProblems(label, 'checksTimeoutMs', step.checksTimeoutMs, step, context.workflowBudget))
  }
  if (kind !== 'gate-policy') return errors

  if (!step.policy) return [...errors, `${label} has no policy`]
  if (!context.policies.has(step.policy)) return [...errors, `${label} names unknown policy '${step.policy}'`]
  // `timeoutMs` is what turns polling on. The interval has a default, so it never stands alone.
  const { intervalMs, timeoutMs } = step
  if (intervalMs !== undefined) {
    const floor = Math.max(MIN_POLL_INTERVAL_MS, context.describePolicy?.(step.policy)?.minIntervalMs ?? 0)
    if (!positiveInteger(intervalMs)) errors.push(`${label} intervalMs must be a positive integer`)
    else if (intervalMs < floor) errors.push(`${label} intervalMs must be at least ${floor} for '${step.policy}'`)
    if (timeoutMs === undefined) errors.push(`${label} polls, so it needs timeoutMs`)
  }
  if (timeoutMs !== undefined) {
    if (!positiveInteger(timeoutMs)) errors.push(`${label} timeoutMs must be a positive integer`)
    else errors.push(...wallTimeProblems(label, 'timeoutMs', timeoutMs, step, context.workflowBudget))
  }
  if (step.branches) {
    for (const verdict of Object.keys(step.branches))
      if (!GATE_VERDICTS.has(verdict)) errors.push(`${label} branch '${verdict}' must be pass, fail, or timed-out`)
    // A passing gate has to go somewhere once it branches, or every target would be skipped.
    if (!step.branches.pass) errors.push(`${label} has branches, so it needs a pass branch`)
    errors.push(...branchTargetProblems(step, context))
  }
  return errors
}

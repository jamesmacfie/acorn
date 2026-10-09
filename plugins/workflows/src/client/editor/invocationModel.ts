// The review dialog's state, apart from its drawing (./InvocationDialog.tsx).
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowInvocationApproval, WorkflowInvocationReview } from '../../shared/workflowInvocation'

export type InvocationForm = {
  callerInputs: string[]
  fixedInputs: Record<string, DataValue>
  maxTurns: string
  maxMinutes: string
  maxCostUsd: string
  startsPerSession: string
}

/** The form as the review opens: the current approval when there is one, else the defaults. */
export function initialInvocationForm(review: WorkflowInvocationReview): InvocationForm {
  const source = review.policy?.state === 'active' ? review.policy : null
  const limits = source?.limits ?? review.defaults.limits
  return {
    callerInputs: source?.callerInputs ?? [],
    fixedInputs: source?.fixedInputs ?? {},
    maxTurns: String(limits.maxTurns),
    maxMinutes: String(Math.round(limits.maxWallTimeMs / 60_000)),
    maxCostUsd: limits.maxCostUsd === undefined ? '' : String(limits.maxCostUsd),
    startsPerSession: String(source?.startsPerSession ?? review.defaults.startsPerSession),
  }
}

export function invocationStatus(review: WorkflowInvocationReview): { tone: 'ok' | 'warn' | 'neutral'; label: string } {
  if (review.policy?.state !== 'active') return { tone: 'neutral', label: "Agents can't start this" }
  if (review.changed) return { tone: 'warn', label: 'Changed since you approved it' }
  return { tone: 'ok', label: 'Agents can start this' }
}

const whole = (text: string): number | null => /^\d+$/.test(text.trim()) && Number(text) > 0 ? Number(text) : null

/** The approval the form describes, or the first thing to fix. */
export function invocationApproval(
  review: WorkflowInvocationReview,
  projectId: string,
  form: InvocationForm,
): { approval: WorkflowInvocationApproval } | { problem: string } {
  const maxTurns = whole(form.maxTurns)
  const minutes = whole(form.maxMinutes)
  const starts = whole(form.startsPerSession)
  const cost = form.maxCostUsd.trim() ? Number(form.maxCostUsd) : undefined
  if (!maxTurns) return { problem: 'Set the most turns a run may take.' }
  if (!minutes) return { problem: 'Set the longest a run may take, in minutes.' }
  if (cost !== undefined && !(Number.isFinite(cost) && cost > 0)) return { problem: 'Leave the cost limit empty, or set a positive amount.' }
  if (!starts) return { problem: 'Set how many runs one agent session may start.' }
  // A fixed value only for an input the agent may not set; the rest keep the workflow's default.
  const fixedInputs = Object.fromEntries(Object.entries(form.fixedInputs).filter(([name]) => !form.callerInputs.includes(name)))
  return {
    approval: {
      projectId,
      definitionKey: review.definitionKey,
      graphDigest: review.graphDigest,
      callerInputs: form.callerInputs,
      fixedInputs,
      limits: { maxTurns, maxWallTimeMs: minutes * 60_000, ...(cost !== undefined ? { maxCostUsd: cost } : {}) },
      startsPerSession: starts,
    },
  }
}

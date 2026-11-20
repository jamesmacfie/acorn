import { ToolError } from '@acorn/plugin-api/node'
import type { AgentSession } from '../../contract/wire.ts'
import { normalizeToolCeiling, RISK_ORDER, type ToolCeiling } from '@acorn/protocol/toolPolicy.ts'
import { validResultSchema } from '../sessions/resultContract'
import { executionPolicyOptionId, executionPolicyRank, executionPolicyValueRank } from '../sessions/executionPolicy'

export const assertBoundedDelegationConfig = (value: unknown, label: string): void => {
  if (value !== undefined && JSON.stringify(value).length > 64 * 1024) {
    throw new ToolError('bad_request', `${label} is limited to 64 KiB.`)
  }
}

export const assertDelegationResultSchema = (schema: object | undefined): void => {
  if (schema && !validResultSchema(schema)) {
    throw new ToolError('bad_request', 'The result schema is not a supported JSON Schema.')
  }
}

/** Return the most restrictive combination of the signed parent ceiling and the child's request. */
export const delegatedToolCeiling = (
  parent: ToolCeiling | undefined,
  requested: ToolCeiling | undefined,
): ToolCeiling => {
  const left = normalizeToolCeiling(parent)
  const right = normalizeToolCeiling(requested)
  const allow =
    left.allow && right.allow ? left.allow.filter((name) => right.allow!.includes(name)) : (left.allow ?? right.allow)
  const maxRisk =
    left.maxRisk && right.maxRisk
      ? RISK_ORDER[left.maxRisk] <= RISK_ORDER[right.maxRisk]
        ? left.maxRisk
        : right.maxRisk
      : (left.maxRisk ?? right.maxRisk)
  return normalizeToolCeiling({ ...(allow ? { allow } : {}), ...(maxRisk ? { maxRisk } : {}) })
}

export const sessionMayDelegate = (session: AgentSession): boolean =>
  session.kind !== 'workflow' && !Object.prototype.hasOwnProperty.call(session.config, 'workflowRunId')

/**
 * The widest execution policy a child may run at (`executionPolicyRefusal`): its parent's own, or the
 * owner's choice for this child when that is wider. Undefined when the parent reports no policy Acorn
 * knows, as a terminal agent never does. Such a child runs on the owner's settings alone, because its
 * parent can pick only the model and reasoning.
 */
export function delegatedExecutionCeiling(
  parent: AgentSession | null,
  childProviderId: string,
  ownerOptions: Record<string, string>,
): number | undefined {
  const parentRank = parent ? executionPolicyRank(parent.providerId, parent.config.configOptions) : null
  if (parentRank === null) return undefined
  const optionId = executionPolicyOptionId(childProviderId)
  const ownerRank = optionId ? executionPolicyValueRank(childProviderId, ownerOptions[optionId]) : null
  return Math.max(parentRank, ownerRank ?? parentRank)
}

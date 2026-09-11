import { ToolError } from '@acorn/plugin-api/node'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import { normalizeToolCeiling, RISK_ORDER, type ToolCeiling } from '@acorn/protocol/workflow.ts'
import { validResultSchema } from '../sessions/resultContract'

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
  const allow = left.allow && right.allow
    ? left.allow.filter((name) => right.allow!.includes(name))
    : left.allow ?? right.allow
  const maxRisk = left.maxRisk && right.maxRisk
    ? RISK_ORDER[left.maxRisk] <= RISK_ORDER[right.maxRisk] ? left.maxRisk : right.maxRisk
    : left.maxRisk ?? right.maxRisk
  return normalizeToolCeiling({ ...(allow ? { allow } : {}), ...(maxRisk ? { maxRisk } : {}) })
}

export const sessionMayDelegate = (session: AgentSession): boolean =>
  !Object.prototype.hasOwnProperty.call(session.config, 'workflowRunId')

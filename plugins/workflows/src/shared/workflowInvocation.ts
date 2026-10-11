// The owner's approval for agents to start a workflow (docs/agent-tools/workflow-tools.md § Invocation
// authority). Shared by the device routes and the editor's review dialog.
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowDefinitionProvenance } from './workflowContracts'

/** Turns and wall time are required, so every agent-launched run has a finite bound. */
export type WorkflowInvocationLimits = {
  maxTurns: number
  maxWallTimeMs: number
  maxCostUsd?: number
  maxInputTokens?: number
  maxOutputTokens?: number
}

export const DEFAULT_INVOCATION_STARTS = 5
export const MAX_INVOCATION_STARTS = 100

export type WorkflowInvocationPolicy = {
  id: string
  projectId: string
  definitionKey: string
  state: 'active' | 'revoked'
  graphDigest: string
  definitionDigest: string
  callerInputs: string[]
  fixedInputs: Record<string, DataValue>
  limits: WorkflowInvocationLimits
  startsPerSession: number
  updatedAt: number
}

/** What the owner reads before approving: the graph that would run, who runs each step, and which
 *  fields an agent's input values reach. */
export type WorkflowInvocationReview = {
  definitionKey: string
  workflowName: string
  definitionDigest: string
  graphDigest: string
  posture: 'gated' | 'autonomous'
  nodes: {
    path: string[]
    name: string
    provenance: WorkflowDefinitionProvenance
    steps: {
      id: string
      name: string
      kind: string
      profileId?: string
      model?: string
      configOptions?: Record<string, string>
    }[]
  }[]
  inputs: {
    name: string
    label?: string
    description?: string
    required?: boolean
    schema?: DataSchema
    hasDefault: boolean
  }[]
  /** Root step fields whose text or bindings read an input, so a caller's value can change them. */
  inputUses: { step: string; field: string; inputs: string[] }[]
  defaults: { limits: WorkflowInvocationLimits; startsPerSession: number }
  policy: WorkflowInvocationPolicy | null
  /** True when an approval exists for a different executable graph. */
  changed: boolean
}

export type WorkflowInvocationApproval = {
  projectId: string
  definitionKey: string
  /** The digest the owner reviewed. Approval fails if the graph changed since. */
  graphDigest: string
  callerInputs: string[]
  fixedInputs: Record<string, DataValue>
  limits: WorkflowInvocationLimits
  startsPerSession: number
}

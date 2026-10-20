import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { DataField } from '@acorn/protocol/dataBindings.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { Cadence } from '@acorn/protocol/schedules.ts'
import type { ResolvedWorkflowGraph, WorkflowBudget } from './workflowContracts'
import type { WorkflowRepeatPolicy } from './workflowProcessing'

/** What makes a trigger start a run. A clock trigger's cadence lives on core's scheduler row. */
export type WorkflowTriggerWhen = { kind: 'clock'; timezone: string }

export type WorkflowTriggerState = 'draft' | 'baselining' | 'active' | 'needs-review' | 'baseline-failed' | 'deleted'
export type WorkflowTriggerFirstCheck = 'process-current' | 'track-now'
export type WorkflowTriggerDisplayState = 'draft' | 'activating' | 'active' | 'paused' | 'needs-review' | 'unavailable'
export type WorkflowTriggerLimits = {
  maxDescendants: number
  maxConcurrency: number
  budget: WorkflowBudget & { maxWallTimeMs: number }
}

export type WorkflowTriggerLoopSetting = {
  loopId: string
  repeat: WorkflowRepeatPolicy
  incremental: boolean
}

export type WorkflowTriggerLoop = {
  loopId: string
  label: string
  sourceLabel: string
  schema: DataSchema
  fields: DataField[]
  checkpointAvailable: boolean
  checkpointReason?: string
  setting: WorkflowTriggerLoopSetting
}

export type WorkflowTriggerPreparation = {
  workflowName: string
  limits: WorkflowTriggerLimits
  loops: WorkflowTriggerLoop[]
  changes: Array<{ kind: 'workflow' | 'query' | 'field' | 'source'; label: string }>
}

type WorkflowTriggerOccurrenceSummary = {
  kind: 'scheduled' | 'manual' | 'baseline'
  state: 'active' | 'completed' | 'skipped' | 'blocked'
  taskId: string
  runId: string
  detail?: string
  createdAt: number
}

/** Device-facing trigger projection. Recovery identities and approval fingerprints never cross the route. */
export type WorkflowTriggerView = {
  id: string
  projectId: string
  workflowId: string
  workflowName: string
  inputs: Record<string, DataValue>
  when: WorkflowTriggerWhen
  cadence: Cadence
  limits: WorkflowTriggerLimits
  loops: WorkflowTriggerLoopSetting[]
  firstCheck: WorkflowTriggerFirstCheck
  state: WorkflowTriggerDisplayState
  error?: string
  nextRunAt?: number
  latest?: WorkflowTriggerOccurrenceSummary
  updatedAt: number
}

export type WorkflowTriggerPayload = {
  graph: ResolvedWorkflowGraph
  inputs: Record<string, DataValue>
  limits: WorkflowTriggerLimits
  baseline: boolean
}

export type WorkflowTriggerDraftInput = {
  id?: string
  name?: string
  projectId: string
  workflowId: string
  inputs?: Record<string, DataValue>
  when: WorkflowTriggerWhen
  cadence?: Cadence
  loops?: WorkflowTriggerLoopSetting[]
  limits?: { maxDescendants?: number; maxConcurrency?: number; budget?: WorkflowBudget }
}

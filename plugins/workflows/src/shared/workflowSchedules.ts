import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { DataField } from '@acorn/protocol/dataBindings.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { Cadence } from '@acorn/protocol/schedules.ts'
import type { ResolvedWorkflowGraph, WorkflowBudget } from './workflowContracts'
import type { WorkflowRepeatPolicy } from './workflowProcessing'

export type WorkflowScheduleState = 'draft' | 'baselining' | 'active' | 'needs-review' | 'baseline-failed' | 'deleted'
export type WorkflowScheduleFirstCheck = 'process-current' | 'track-now'
export type WorkflowScheduleDisplayState = 'draft' | 'activating' | 'active' | 'paused' | 'needs-review' | 'unavailable'
export type WorkflowScheduleLimits = {
  maxDescendants: number
  maxConcurrency: number
  budget: WorkflowBudget & { maxWallTimeMs: number }
}

export type WorkflowScheduleLoopSetting = {
  loopId: string
  repeat: WorkflowRepeatPolicy
  incremental: boolean
}

export type WorkflowScheduleLoop = {
  loopId: string
  label: string
  sourceLabel: string
  schema: DataSchema
  fields: DataField[]
  checkpointAvailable: boolean
  checkpointReason?: string
  setting: WorkflowScheduleLoopSetting
}

export type WorkflowSchedulePreparation = {
  workflowName: string
  limits: WorkflowScheduleLimits
  loops: WorkflowScheduleLoop[]
  changes: Array<{ kind: 'workflow' | 'query' | 'field' | 'source'; label: string }>
}

export type WorkflowScheduleOccurrenceSummary = {
  kind: 'scheduled' | 'manual' | 'baseline'
  state: 'active' | 'completed' | 'skipped' | 'blocked'
  taskId: string
  runId: string
  detail?: string
  createdAt: number
}

/** Device-facing schedule projection. Recovery identities and approval fingerprints never cross the route. */
export type WorkflowScheduleView = {
  id: string
  projectId: string
  workflowId: string
  workflowName: string
  inputs: Record<string, DataValue>
  timezone: string
  cadence: Cadence
  limits: WorkflowScheduleLimits
  loops: WorkflowScheduleLoopSetting[]
  firstCheck: WorkflowScheduleFirstCheck
  state: WorkflowScheduleDisplayState
  error?: string
  nextRunAt?: number
  latest?: WorkflowScheduleOccurrenceSummary
  updatedAt: number
}

export type WorkflowSchedulePayload = {
  graph: ResolvedWorkflowGraph
  inputs: Record<string, DataValue>
  limits: WorkflowScheduleLimits
  baseline: boolean
}

export type WorkflowScheduleDraftInput = {
  id?: string
  name?: string
  projectId: string
  workflowId: string
  inputs?: Record<string, DataValue>
  timezone: string
  cadence?: Cadence
  loops?: WorkflowScheduleLoopSetting[]
  limits?: { maxDescendants?: number; maxConcurrency?: number; budget?: WorkflowBudget }
}

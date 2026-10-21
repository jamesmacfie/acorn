import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { DataBinding, DataField } from '@acorn/protocol/dataBindings.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { Cadence } from '@acorn/protocol/schedules.ts'
import type { RecordChange } from '@acorn/protocol/starterTriggers.ts'
import type { ResolvedWorkflowGraph, WorkflowBudget } from './workflowContracts'
import type { WorkflowRepeatPolicy } from './workflowProcessing'

/** Which records start a run: one that's new, starts matching, or changes in the fields named. */
export type WorkflowRecordChange = RecordChange

/** A record trigger. Its pointers address the record envelope `{ ref, data, display }`, as a For each
 *  loop's do, so a field of the record's data is `/data/<field>`. */
export type WorkflowRecordsWhen = {
  kind: 'records'
  query: QueryReference
  change: WorkflowRecordChange
  /** Continue from the source's checkpoint instead of reading every match. Never with `enters`. */
  incremental?: boolean
  /** Workflow inputs filled from the record, each `{ address: { from: 'item', pointer } }`. */
  bindings?: Record<string, DataBinding>
  /** Circuit breakers: runs started by one check, and in any 24 hours. */
  runsPerCheck?: number
  runsPerDay?: number
}

/** What makes a trigger start a run. Either kind's cadence lives on core's scheduler row. */
export type WorkflowTriggerWhen = { kind: 'clock'; timezone: string } | WorkflowRecordsWhen

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
  /** The trigger reads core's Tasks source without excluding tasks an agent made. */
  agentTasks: boolean
}

/** A record trigger's last check: when it ran, how many runs it started, and whether it read every
 *  match. `partial` is the source's reason when it didn't. */
export type WorkflowTriggerCheck = { at: number; started: number; partial?: string }

/** One record a record trigger started a run for. */
export type WorkflowTriggerMatch = {
  title: string
  reason: WorkflowRecordChange['on']
  state: WorkflowTriggerOccurrenceSummary['state']
  taskId: string
  runId: string
  runStatus?: string
  detail?: string
  createdAt: number
}

/** What a record trigger's query returns now, and what its first check would do with it. */
export type WorkflowTriggerPreview = {
  source: {
    label: string
    schema: DataSchema
    fields: DataField[]
    incremental: boolean
    incrementalReason?: string
  }
  records: Array<{ title: string; link?: string; wouldStart: boolean }>
  partial?: string
}

type WorkflowTriggerOccurrenceSummary = {
  kind: 'scheduled' | 'manual' | 'baseline' | 'match'
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
  lastCheck?: WorkflowTriggerCheck
  /** A record trigger's last 50 matches, newest first. Only a single trigger's read carries them. */
  matches?: WorkflowTriggerMatch[]
  updatedAt: number
}

export type WorkflowTriggerPayload = {
  graph: ResolvedWorkflowGraph
  inputs: Record<string, DataValue>
  limits: WorkflowTriggerLimits
  baseline: boolean
  /** The record a record trigger's occurrence handles, which names its task. */
  record?: { title: string; reason: WorkflowRecordChange['on'] }
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

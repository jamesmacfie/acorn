import type { DataValue } from '@acorn/protocol/dataValues.ts'

export type WorkflowRepeatPolicy = { mode: 'every-match' | 'unseen' | 'changed'; fields?: string[] }
export type WorkflowProcessingDecision = 'admitted' | 'baseline' | 'active' | 'seen' | 'unchanged'
export type WorkflowProcessingScope = { scopeId: string; epoch: string }
export type WorkflowCheckpoint = {
  queryFingerprint: string
  boundary: DataValue
  previousBoundary?: DataValue
}
export type WorkflowRecordHistory = {
  id: string
  position: number
  recordKey: string
  decision: WorkflowProcessingDecision
  title: string
  attemptId: string | null
  taskId: string | null
  runId: string | null
  status: string | null
  reason: string | null
  result: string | null
  agentSessionId?: string | null
  taskMode?: 'child' | 'parent'
  retryStepId: string | null
  outputs: WorkflowNamedOutput[]
}

export type WorkflowNamedOutput = {
  name: string
  preview: string
  truncated: boolean
}

export type WorkflowRecordFilter = 'all' | 'running' | 'attention' | 'failed' | 'skipped'

export type WorkflowRecordCounts = {
  total: number
  running: number
  attention: number
  failed: number
  skipped: number
  completed: number
}

export type WorkflowSelectionProvenance = {
  source: { pluginId: string; sourceId: string } | null
  connectionId: string | null
  sourceRevision: string | null
  savedQuery: { id: string; revision: number } | null
  evaluationTime: number | null
  readTime: number | null
  completeness: { kind: 'complete' | 'bounded' | 'more' | 'incomplete'; cause?: string } | null
}

export type WorkflowRecordPage = {
  selectionId: string | null
  stepId: string | null
  records: WorkflowRecordHistory[]
  next: number | null
  counts: WorkflowRecordCounts
  emptyReason: 'no-matches' | 'all-skipped' | null
  provenance: WorkflowSelectionProvenance | null
}

export type WorkflowRecordAttempt = {
  id: string
  previousAttemptId: string | null
  createdAt: number
  taskId: string
  runId: string
  status: string
  error: string | null
  agentSessionId?: string | null
  taskMode?: 'child' | 'parent'
  retryStepId: string | null
  result: string | null
  outputs: WorkflowNamedOutput[]
}

import type { WorkflowRecordCounts, WorkflowRecordFilter, WorkflowRecordHistory } from '../../shared/workflowProcessing'

export const RECORD_FILTERS: readonly { value: WorkflowRecordFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'attention', label: 'Needs approval' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
]

export const recordStatus = (row: WorkflowRecordHistory): string => {
  if (row.decision === 'active') return ['reserved', 'task-created', 'run-started', 'running', 'cancelling'].includes(row.status ?? '')
    ? 'Running elsewhere'
    : 'Skipped while another attempt was active'
  if (row.status === 'gated') return 'Needs approval'
  if (row.decision === 'baseline') return 'Baseline only'
  if (row.decision === 'seen') return 'Previously processed'
  if (row.decision === 'unchanged') return 'Unchanged'
  if (!row.status) return row.decision === 'admitted' ? 'Pending' : 'Skipped'
  if (row.status === 'completed-with-failures') return 'Completed with failures'
  if (row.status === 'safety-rail') return 'Safety rail'
  return row.status.replaceAll('-', ' ')
}

export const progressSummary = (counts: WorkflowRecordCounts): string => {
  if (!counts.total) return 'No matching records'
  if (counts.skipped === counts.total) return `${counts.total} matches · all already processed`
  const settled = counts.completed + counts.failed + counts.skipped
  const parts = [`${settled} of ${counts.total} settled`]
  if (counts.running) parts.push(`${counts.running} running`)
  if (counts.attention) parts.push(`${counts.attention} need approval`)
  if (counts.failed) parts.push(`${counts.failed} failed`)
  if (counts.skipped) parts.push(`${counts.skipped} skipped`)
  return parts.join(' · ')
}

export const recordCanRetry = (row: WorkflowRecordHistory): boolean =>
  !!row.runId && !!row.retryStepId && ['failed', 'safety-rail', 'completed-with-failures'].includes(row.status ?? '')

export const recordCanReprocess = (row: WorkflowRecordHistory): boolean =>
  !!row.attemptId && !['reserved', 'task-created', 'run-started', 'running', 'gated', 'cancelling'].includes(row.status ?? '')

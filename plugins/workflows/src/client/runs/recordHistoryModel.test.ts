import { describe, expect, it } from 'vitest'
import type { WorkflowRecordHistory } from '../../shared/workflowProcessing'
import { progressSummary, recordCanReprocess, recordCanRetry, recordStatus } from './recordHistoryModel'

const row = (over: Partial<WorkflowRecordHistory> = {}): WorkflowRecordHistory => ({
  id: 'row', position: 0, recordKey: 'record', decision: 'admitted', title: 'Record', attemptId: 'attempt',
  taskId: 'task', runId: 'run', status: 'done', reason: null, result: null, retryStepId: null, outputs: [], ...over,
})

describe('record history presentation', () => {
  it('keeps zero matches distinct from an all-skipped selection', () => {
    expect(progressSummary({ total: 0, running: 0, attention: 0, failed: 0, skipped: 0, completed: 0 })).toBe('No matching records')
    expect(progressSummary({ total: 3, running: 0, attention: 0, failed: 0, skipped: 3, completed: 0 })).toBe('3 matches · all already processed')
  })

  it('names repeat decisions and separates retry from reprocess eligibility', () => {
    expect(recordStatus(row({ decision: 'unchanged', status: 'failed' }))).toBe('Unchanged')
    expect(recordStatus(row({ decision: 'active', status: 'running' }))).toBe('Running elsewhere')
    expect(recordStatus(row({ decision: 'active', status: 'failed' }))).toBe('Skipped while another attempt was active')
    expect(recordCanRetry(row({ status: 'failed', retryStepId: 'step' }))).toBe(true)
    expect(recordCanRetry(row({ status: 'cancelled', retryStepId: null }))).toBe(false)
    expect(recordCanReprocess(row({ status: 'cancelled' }))).toBe(true)
    expect(recordCanReprocess(row({ status: 'gated' }))).toBe(false)
  })
})

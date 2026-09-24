import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../node/schema'
import { workflowRecordAttemptPage, workflowRecordSnapshot, workflowSelectionPage } from './workflowProcessingReadModel'

describe('workflow processing history read model', () => {
  let database: TestPluginDb

  beforeEach(() => { database = makeTestPluginDb('workflows') })
  afterEach(() => database.cleanup())

  it('keeps a 500-row selection paged and distinguishes no matches from all skipped', () => {
    expect(workflowSelectionPage(database.db, 'missing').emptyReason).toBe('no-matches')
    database.db.insert(schema.workflowSelections).values({
      id: 'selection', invocationKey: 'selection', fingerprint: 'fingerprint', runId: 'root', stepId: 'loop',
      scopeKey: 'scope', snapshotJson: JSON.stringify({
        source: { pluginId: 'fixture', sourceId: 'issues' }, connectionId: 'connection', sourceRevision: '7',
        evaluationTime: 100, readTime: 101, completeness: { kind: 'complete' },
      }), createdAt: 1,
    }).run()
    database.db.insert(schema.workflowSelectedRecords).values(Array.from({ length: 500 }, (_, position) => ({
      id: `row-${position}`, selectionId: 'selection', position, recordKey: `record-${position}`,
      snapshotJson: JSON.stringify({ display: { title: `Record ${position}` } }), decision: 'unchanged', attemptId: null,
    }))).run()

    const first = workflowSelectionPage(database.db, 'root', undefined, -1, 100, 'loop')
    expect(first.records).toHaveLength(100)
    expect(first.next).toBe(99)
    expect(first.counts).toEqual({ total: 500, running: 0, attention: 0, failed: 0, skipped: 500, completed: 0 })
    expect(first.emptyReason).toBe('all-skipped')
    expect(first.provenance).toMatchObject({
      source: { pluginId: 'fixture', sourceId: 'issues' }, connectionId: 'connection',
      sourceRevision: '7', completeness: { kind: 'complete' },
    })
    const last = workflowSelectionPage(database.db, 'root', 'selection', 399, 100, 'loop', 'skipped')
    expect(last.records.map(row => row.position)).toEqual(Array.from({ length: 100 }, (_, index) => index + 400))
    expect(last.next).toBeNull()
    expect(workflowSelectionPage(database.db, 'root', 'selection', -1, 100, 'loop', 'failed').records).toEqual([])
  })

  it('keeps skipped rows separate from the status of the attempt they reference', () => {
    database.db.insert(schema.workflowSelections).values({ id: 'selection', invocationKey: 'selection', fingerprint: 'fingerprint',
      runId: 'root', stepId: 'loop', scopeKey: 'scope', snapshotJson: '{}', createdAt: 1 }).run()
    database.db.insert(schema.workflowSelectedRecords).values([
      { id: 'settled-row', selectionId: 'selection', position: 0, recordKey: 'settled', snapshotJson: '{}', decision: 'active', attemptId: 'settled-attempt' },
      { id: 'running-row', selectionId: 'selection', position: 1, recordKey: 'running', snapshotJson: '{}', decision: 'active', attemptId: 'running-attempt' },
    ]).run()
    database.db.insert(schema.workflowDispatches).values([
      { id: 'settled-dispatch', callerKey: 'settled', payloadFingerprint: 'one', payloadJson: '{}', parentTaskId: 'root-task', taskId: 'settled-task', runId: 'settled-run', rootRunId: 'root', parentRunId: 'root', parentStepId: 'loop', itemKey: 'settled', state: 'terminal', error: null, createdAt: 1, updatedAt: 1 },
      { id: 'running-dispatch', callerKey: 'running', payloadFingerprint: 'two', payloadJson: '{}', parentTaskId: 'root-task', taskId: 'running-task', runId: 'running-run', rootRunId: 'root', parentRunId: 'root', parentStepId: 'loop', itemKey: 'running', state: 'run-started', error: null, createdAt: 2, updatedAt: 2 },
    ]).run()
    database.db.insert(schema.workflowRecordAttempts).values([
      { id: 'settled-attempt', stateId: 'settled-state', selectionId: 'selection', dispatchId: 'settled-dispatch', previousAttemptId: null, createdAt: 1 },
      { id: 'running-attempt', stateId: 'running-state', selectionId: 'selection', dispatchId: 'running-dispatch', previousAttemptId: null, createdAt: 2 },
    ]).run()
    database.db.insert(schema.workflowRuns).values([
      { id: 'settled-run', taskId: 'settled-task', rootRunId: 'root', name: 'Settled', status: 'failed', error: 'failed earlier', defJson: JSON.stringify({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Settled', steps: [] }), createdAt: 1, updatedAt: 1 },
      { id: 'running-run', taskId: 'running-task', rootRunId: 'root', name: 'Running', status: 'running', error: null, defJson: JSON.stringify({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Running', steps: [] }), createdAt: 2, updatedAt: 2 },
    ]).run()

    const page = workflowSelectionPage(database.db, 'root')
    expect(page.counts).toMatchObject({ running: 1, skipped: 1, failed: 0 })
    expect(workflowSelectionPage(database.db, 'root', undefined, -1, 100, undefined, 'skipped').records.map(row => row.id)).toEqual(['settled-row'])
    expect(workflowSelectionPage(database.db, 'root', undefined, -1, 100, undefined, 'running').records.map(row => row.id)).toEqual(['running-row'])
  })

  it('loads frozen detail separately and bounds results, declared outputs, and attempt pages', () => {
    const large = 'x'.repeat(3_000)
    database.db.insert(schema.workflowSelections).values({ id: 'selection', invocationKey: 'selection', fingerprint: 'fingerprint',
      runId: 'root', stepId: 'loop', scopeKey: 'scope', snapshotJson: '{}', createdAt: 1 }).run()
    database.db.insert(schema.workflowSelectedRecords).values({ id: 'row', selectionId: 'selection', position: 0,
      recordKey: 'record', snapshotJson: JSON.stringify({ private: large }), decision: 'admitted', attemptId: 'attempt' }).run()
    database.db.insert(schema.workflowRecordStates).values({ id: 'state', scopeKey: 'scope', recordKey: 'record',
      snapshotJson: '{}', fieldsJson: '[]', projection: '{}', attemptId: 'attempt', updatedAt: 1 }).run()
    database.db.insert(schema.workflowDispatches).values({ id: 'dispatch', callerKey: 'dispatch', payloadFingerprint: 'fingerprint',
      payloadJson: JSON.stringify({ task: { title: 'Review record' } }), parentTaskId: 'root-task', taskId: 'child-task',
      runId: 'child-run', rootRunId: 'root', parentRunId: 'root', parentStepId: 'loop', itemKey: 'record',
      state: 'terminal', error: null, createdAt: 1, updatedAt: 1 }).run()
    database.db.insert(schema.workflowRecordAttempts).values({ id: 'attempt', stateId: 'state', selectionId: 'selection',
      dispatchId: 'dispatch', previousAttemptId: null, createdAt: 1 }).run()
    database.db.insert(schema.workflowRuns).values({ id: 'child-run', taskId: 'child-task', rootRunId: 'root', name: 'Review', status: 'failed',
      error: large, defJson: JSON.stringify({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Review', outputs: [{ name: 'summary', schema: { type: 'string' },
        binding: { address: { from: 'step', stepId: 'answer', pointer: '' } } }], steps: [{ id: 'answer', name: 'Answer' }] }),
      createdAt: 1, updatedAt: 1 }).run()
    database.db.insert(schema.workflowSteps).values({ id: 'answer-row', runId: 'child-run', idx: 0, name: 'Answer',
      kind: 'agent', status: 'done', structuredJson: JSON.stringify(large), resultJson: JSON.stringify({ result: large }),
      createdAt: 1, updatedAt: 1 }).run()
    database.db.insert(schema.workflowSteps).values({ id: 'failed-row', runId: 'child-run', idx: 1, name: 'Finish',
      kind: 'agent', status: 'failed', resultJson: JSON.stringify({ result: large }),
      createdAt: 1, updatedAt: 1 }).run()

    const page = workflowSelectionPage(database.db, 'root')
    expect(page.records[0]).toMatchObject({ status: 'failed', retryStepId: 'failed-row' })
    expect(page.records[0]!.reason!.length).toBeLessThanOrEqual(500)
    expect(page.records[0]!.result!.length).toBeLessThanOrEqual(500)
    expect(page.records[0]!.outputs).toEqual([])
    expect(workflowSelectionPage(database.db, 'root').records[0]).not.toHaveProperty('snapshot')
    const detail = workflowRecordSnapshot(database.db, 'root', 'row')
    expect(detail?.snapshot).toEqual({ private: large })
    expect(detail?.record?.outputs[0]).toMatchObject({ name: 'summary', truncated: true })
    expect(detail?.record?.outputs[0]!.preview.length).toBeLessThanOrEqual(2_000)
    expect(workflowRecordAttemptPage(database.db, 'root', 'row', '', 1).attempts[0]).toMatchObject({
      id: 'attempt', taskId: 'child-task', runId: 'child-run', status: 'failed', retryStepId: 'failed-row',
    })
  })
})

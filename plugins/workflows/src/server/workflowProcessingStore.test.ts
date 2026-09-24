import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../node/schema'
import { WorkflowDispatcher } from './workflowDispatch'
import { WorkflowProcessingStore, bindWorkflowProcessingScope, workflowProcessingScopeKey, type WorkflowSelectionRequest } from './workflowProcessingStore'
import { workflowRecordAttemptPage, workflowSelectionPage } from './workflowProcessingReadModel'
import { incrementalConsumer, workflowIncrementalQuery } from './workflowIncremental'
import type { WorkflowDef } from '../shared/workflowContracts'
import { prepareWorkflowReprocess, resolveWorkflowReprocess } from './workflowReprocess'

describe('atomic workflow processing selection', () => {
  let database: TestPluginDb
  let store: WorkflowProcessingStore
  let dispatcher: WorkflowDispatcher
  const tasks = { createChild: vi.fn(async (_parent: string, _task: unknown, intended?: string) => intended!) }
  const runner = { start: vi.fn(async (_task: string, _def: unknown, options: { intendedRunId?: string } = {}) => options.intendedRunId!) }
  const parent = (runId: string, scope = 'schedule-1', epoch = '1', name = 'Loop') => {
    database.db.insert(schema.workflowRuns).values({ id: runId, taskId: `task-${runId}`, name: 'Parent', status: 'running', rootRunId: runId,
      defJson: JSON.stringify({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Parent', steps: [{ id: 'stable-loop', name, kind: 'workflow-map' }] }), createdAt: 1, updatedAt: 1 }).run()
    database.db.insert(schema.workflowSteps).values({ id: `step-${runId}`, runId, name, idx: 0, kind: 'workflow-map', status: 'running', createdAt: 1, updatedAt: 1 }).run()
    if (scope) bindWorkflowProcessingScope(database.db, runId, { scopeId: scope, epoch })
  }
  const request = (runId: string, state = 'A', overrides: Partial<WorkflowSelectionRequest> = {}): WorkflowSelectionRequest => ({
    invocationKey: `selection-${runId}`, runId, stepId: `step-${runId}`, policy: { mode: 'changed', fields: ['/state'] },
    records: [{ key: 'record-1', snapshot: { state }, dispatch: { callerKey: `dispatch-${runId}`, parentRunId: runId, parentStepId: `step-${runId}`,
      itemKey: 'record-1', task: { title: 'Review record', branch: 'review' }, workflow: { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Review', steps: [{ name: 'Gate', kind: 'gate-human' }] } } }], ...overrides,
  })
  const settle = (selectionId: string, status = 'failed') => {
    const attempt = database.db.select().from(schema.workflowRecordAttempts).where(eq(schema.workflowRecordAttempts.selectionId, selectionId)).get()!
    const dispatch = database.db.select().from(schema.workflowDispatches).where(eq(schema.workflowDispatches.id, attempt.dispatchId)).get()!
    database.db.insert(schema.workflowRuns).values({ id: dispatch.runId, taskId: dispatch.taskId, rootRunId: dispatch.rootRunId, name: 'Review', status,
      defJson: '{}', createdAt: 1, updatedAt: 1 }).run()
    database.db.update(schema.workflowDispatches).set({ state: 'terminal' }).where(eq(schema.workflowDispatches.id, dispatch.id)).run()
  }
  beforeEach(() => {
    vi.clearAllMocks()
    database = makeTestPluginDb('workflows')
    dispatcher = new WorkflowDispatcher(database.db, runner, tasks)
    store = new WorkflowProcessingStore(database.db, dispatcher)
  })
  afterEach(() => database.cleanup())

  it('converges independent SQLite connections on one active attempt and one invocation', async () => {
    parent('one'); parent('two')
    const connection = database.openConnection()
    try {
      const other = new WorkflowProcessingStore(connection, new WorkflowDispatcher(connection, runner, tasks))
      const results = await Promise.all([Promise.resolve().then(() => store.reserve(request('one'))), Promise.resolve().then(() => other.reserve(request('two')))])
      expect(results.flatMap(result => result.dispatches)).toHaveLength(1)
      expect(other.reserve(request('one'))).toEqual(results[0])
      expect(connection.select().from(schema.workflowRecordAttempts).all()).toHaveLength(1)
    } finally { connection.close() }
  })

  it('retains A to B to A, skips failed unchanged records, and remains independent by schedule and epoch', () => {
    parent('one')
    const one = store.reserve(request('one')); settle(one.selectionId)
    parent('same', 'schedule-1', '1', 'Renamed loop')
    const same = store.reserve(request('same'))
    expect(same.dispatches).toHaveLength(0)
    const rows = workflowSelectionPage(database.db, 'same').records
    expect(rows[0]).toMatchObject({ decision: 'unchanged', status: 'failed', runId: one.dispatches[0].runId })
    parent('two'); const two = store.reserve(request('two', 'B')); settle(two.selectionId)
    parent('three'); expect(store.reserve(request('three', 'A')).dispatches).toHaveLength(1)
    parent('independent', 'schedule-2'); expect(store.reserve(request('independent')).dispatches).toHaveLength(1)
    parent('epoch', 'schedule-1', '2'); expect(store.reserve(request('epoch')).dispatches).toHaveLength(1)
    expect(database.db.select().from(schema.workflowRecordAttempts).all()).toHaveLength(5)
  })

  it('excludes active attempts and refuses checkpoints past changed active work', () => {
    parent('one'); store.reserve(request('one'))
    parent('two'); expect(store.reserve(request('two', 'B')).dispatches).toHaveLength(0)
    expect(workflowSelectionPage(database.db, 'two').records[0].decision).toBe('active')
    parent('three')
    expect(() => store.reserve(request('three', 'B', { checkpoint: { queryFingerprint: 'q', boundary: 'next' } }))).toThrow('undispatched changes')
    expect(() => store.reserve(request('three', 'B', { policy: { mode: 'every-match' }, checkpoint: { queryFingerprint: 'q', boundary: 'next' } }))).toThrow('undispatched changes')
    expect(database.db.select().from(schema.workflowProcessingBoundaries).all()).toHaveLength(0)
  })

  it('rolls back all selection rows and checkpoint when any child binding or limit fails', () => {
    parent('one')
    const invalid = request('one')
    invalid.records.push({ ...invalid.records[0], key: 'record-2', dispatch: { ...invalid.records[0].dispatch, callerKey: 'second', workflow: { baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'Required', inputs: [{ name: 'required', required: true, schema: { type: 'string' } }], steps: [{ name: 'Gate', kind: 'gate-human' }],
    } } })
    invalid.checkpoint = { queryFingerprint: 'q', boundary: 2 }
    expect(() => store.reserve(invalid)).toThrow()
    for (const table of [schema.workflowSelections, schema.workflowSelectedRecords, schema.workflowRecordStates, schema.workflowRecordAttempts, schema.workflowDispatches, schema.workflowProcessingBoundaries]) {
      expect(database.db.select().from(table).all()).toHaveLength(0)
    }
    expect(tasks.createChild).not.toHaveBeenCalled()
    database.db.update(schema.workflowRuns).set({ defJson: JSON.stringify({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Parent', maxDescendants: 1, steps: [{ id: 'stable-loop', name: 'Loop' }] }) }).run()
    invalid.records[1].dispatch.workflow = invalid.records[0].dispatch.workflow
    expect(() => store.reserve(invalid)).toThrow('descendant limit')
    expect(database.db.select().from(schema.workflowSelections).all()).toHaveLength(0)
  })

  it('replays a committed selection after a crash without new IDs or side effects before commit', async () => {
    parent('one')
    const original = store.reserve(request('one', 'A', { checkpoint: { queryFingerprint: 'q', boundary: { token: '2' } } }))
    expect(tasks.createChild).not.toHaveBeenCalled()
    expect(database.db.select().from(schema.workflowProcessingBoundaries).get()?.boundaryJson).toBe('{"token":"2"}')
    const restarted = new WorkflowProcessingStore(database.db, new WorkflowDispatcher(database.db, runner, tasks))
    expect(restarted.reserve(request('one', 'A', { checkpoint: { queryFingerprint: 'q', boundary: { token: '2' } } }))).toEqual(original)
    await dispatcher.reconcile()
    expect(tasks.createChild).toHaveBeenCalledTimes(1)
    expect(tasks.createChild.mock.calls[0][2]).toBe(original.dispatches[0].taskId)
    expect(() => restarted.reserve(request('one', 'B'))).toThrow('different content')
  })

  it('commits zero and all-skipped checks with compare-and-swap continuation', () => {
    parent('baseline')
    const baseline = store.reserve(request('baseline', 'A', { baseline: true, checkpoint: { queryFingerprint: 'q', boundary: '1' } }))
    expect(baseline.dispatches).toHaveLength(0)
    parent('skip')
    const skipped = store.reserve(request('skip', 'A', { checkpoint: { queryFingerprint: 'q', previousBoundary: '1', boundary: '2' } }))
    expect(skipped.dispatches).toHaveLength(0)
    parent('empty')
    store.reserve(request('empty', 'A', { records: [], checkpoint: { queryFingerprint: 'q', previousBoundary: '2', boundary: '3' } }))
    expect(database.db.select().from(schema.workflowProcessingBoundaries).get()?.boundaryJson).toBe('"3"')
    parent('stale')
    expect(() => store.reserve(request('stale', 'A', { records: [], checkpoint: { queryFingerprint: 'q', previousBoundary: '2', boundary: '4' } }))).toThrow('boundary changed')
    parent('edited')
    expect(() => store.reserve(request('edited', 'A', { records: [], checkpoint: { queryFingerprint: 'changed-query', previousBoundary: '3', boundary: '4' } }))).toThrow('fresh baseline or epoch')
    expect(database.db.select().from(schema.workflowProcessingBoundaries).get()?.boundaryJson).toBe('"3"')
    const rebaseline = store.reserve(request('edited', 'B', { baseline: true, checkpoint: { queryFingerprint: 'changed-query', previousBoundary: '3', boundary: '4' } }))
    expect(rebaseline.dispatches).toHaveLength(0)
    expect(database.db.select().from(schema.workflowProcessingBoundaries).get()).toMatchObject({ queryFingerprint: 'changed-query', boundaryJson: '"4"' })
    expect(database.db.select().from(schema.workflowRecordStates).all()).toHaveLength(1)
  })

  it('takes baseline behavior from the persisted scheduled root, not caller input', () => {
    parent('before-baseline')
    store.reserve(request('before-baseline', 'A', {
      records: [],
      checkpoint: { queryFingerprint: 'before', boundary: { token: 'before-baseline' } },
    }))
    parent('baseline-root')
    database.db.update(schema.workflowProcessingScopes).set({ baseline: true })
      .where(eq(schema.workflowProcessingScopes.runId, 'baseline-root')).run()
    const result = store.reserve(request('baseline-root', 'A', {
      baseline: false,
      checkpoint: {
        queryFingerprint: 'after',
        previousBoundary: { token: 'before-baseline' },
        boundary: { token: 'after-baseline' },
      },
    }))

    expect(result.dispatches).toHaveLength(0)
    expect(database.db.select().from(schema.workflowSelectedRecords).get()?.decision).toBe('baseline')
    expect(database.db.select().from(schema.workflowProcessingBoundaries).get()).toMatchObject({
      queryFingerprint: 'after',
      boundaryJson: '{"token":"after-baseline"}',
    })
  })

  it('uses fresh manual scopes and stable parent record paths', () => {
    parent('one', ''); parent('two', '')
    expect(workflowProcessingScopeKey(database.db, 'one', 'step-one')).not.toBe(workflowProcessingScopeKey(database.db, 'two', 'step-two'))
    parent('scheduled')
    const dispatched = store.reserve(request('scheduled')).dispatches[0]
    database.db.insert(schema.workflowRuns).values({ id: dispatched.runId, taskId: dispatched.taskId, parentRunId: 'scheduled', parentStepId: 'step-scheduled', rootRunId: 'scheduled',
      name: 'Child', status: 'running', defJson: JSON.stringify({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Child', steps: [{ id: 'nested', name: 'Renamed nested' }] }), createdAt: 1, updatedAt: 1 }).run()
    database.db.insert(schema.workflowSteps).values({ id: 'nested-row', runId: dispatched.runId, idx: 0, name: 'Renamed nested', status: 'running', createdAt: 1, updatedAt: 1 }).run()
    expect(JSON.parse(workflowProcessingScopeKey(database.db, dispatched.runId, 'nested-row'))).toEqual(['schedule-1', '1', [['stable-loop', 'record-1'], 'nested']])
  })

  it('creates a related reprocess attempt and returns paged history without foreign rows', () => {
    parent('one'); const first = store.reserve(request('one')); settle(first.selectionId)
    const previous = database.db.select().from(schema.workflowRecordAttempts).get()!
    const originalRow = workflowSelectionPage(database.db, 'one').records[0]
    const preparation = prepareWorkflowReprocess(database.db, 'one', originalRow.id)
    expect(resolveWorkflowReprocess(database.db, 'one', originalRow.id, preparation.digest)).toMatchObject({ snapshot: { state: 'A' }, previousAttemptId: previous.id })
    expect(() => resolveWorkflowReprocess(database.db, 'one', originalRow.id, 'changed')).toThrow('preparation changed')
    expect(() => prepareWorkflowReprocess(database.db, 'foreign', originalRow.id)).toThrow('not found')
    parent('two')
    const again = request('two'); again.records[0].previousAttemptId = previous.id
    const second = store.reserve(again)
    expect(second.dispatches[0].runId).not.toBe(first.dispatches[0].runId)
    const selected = workflowSelectionPage(database.db, 'two').records[0]
    const history = workflowRecordAttemptPage(database.db, 'two', selected.id)
    expect(history.attempts).toHaveLength(2)
    expect(history.attempts.find(attempt => attempt.previousAttemptId)?.previousAttemptId).toBe(previous.id)
    expect(workflowRecordAttemptPage(database.db, 'foreign', selected.id).attempts).toHaveLength(0)
  })

  it('starts an explicit reprocess as an idempotent root run without reopening its settled parent', async () => {
    parent('one')
    const first = store.reserve(request('one'))
    settle(first.selectionId)
    database.db.update(schema.workflowRuns).set({ status: 'done' }).where(eq(schema.workflowRuns.id, 'one')).run()
    const row = workflowSelectionPage(database.db, 'one').records[0]!
    const prepared = prepareWorkflowReprocess(database.db, 'one', row.id)
    vi.clearAllMocks()

    const command = { sourceRunId: 'one', recordId: row.id, digest: prepared.digest, requestId: 'owner-click' }
    const result = await store.reprocess(command)
    expect(result).toMatchObject({ state: 'run-started' })
    expect(tasks.createChild).toHaveBeenCalledWith('task-one', expect.objectContaining({ origin: 'workflows:child' }), result.taskId)
    expect(runner.start).toHaveBeenCalledWith(result.taskId, expect.objectContaining({ name: 'Review' }), expect.objectContaining({
      intendedRunId: result.runId,
      trigger: 'reprocess',
      invocation: expect.objectContaining({ rootRunId: result.runId, parentRunId: null, parentStepId: null, depth: 0 }),
    }))
    expect(workflowRecordAttemptPage(database.db, 'one', row.id).attempts).toHaveLength(2)

    await expect(store.reprocess(command)).resolves.toEqual(result)
    expect(tasks.createChild).toHaveBeenCalledTimes(1)
    expect(runner.start).toHaveBeenCalledTimes(1)
  })

  it('resolves only a declared single tracked checkpoint consumer', () => {
    parent('one')
    const def = { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Parent', steps: [{ id: 'find', name: 'Find', kind: 'find-records' }, { id: 'stable-loop', name: 'Loop', kind: 'workflow-map', items: { step: 'find', pointer: '/records' }, repeat: { mode: 'unseen' } }] }
    database.db.update(schema.workflowRuns).set({ defJson: JSON.stringify(def) }).run()
    database.db.update(schema.workflowSteps).set({ idx: 1 }).run()
    database.db.insert(schema.workflowSteps).values({ id: 'query', runId: 'one', idx: 0, name: 'Find', status: 'done', createdAt: 1, updatedAt: 1 }).run()
    const query = { source: { pluginId: 'fixture', sourceId: 'records' }, scope: { parameters: {} }, sort: [] }
    expect(workflowIncrementalQuery(database.db, 'one', 'query', query).incremental).toEqual({ kind: 'baseline' })
    expect(() => workflowIncrementalQuery(database.db, 'one', 'query', { ...query, take: 1 })).toThrow('take')
    def.steps.push({ ...def.steps[1], id: 'another' })
    database.db.update(schema.workflowRuns).set({ defJson: JSON.stringify(def) }).run()
    expect(() => workflowIncrementalQuery(database.db, 'one', 'query', query)).toThrow('exactly one')
  })

  it('reprocesses a nested record as a fresh root attempt in its original history scope', () => {
    parent('outer')
    const outer = store.reserve(request('outer')).dispatches[0]
    database.db.insert(schema.workflowRuns).values({ id: outer.runId, taskId: outer.taskId, parentRunId: 'outer', parentStepId: 'step-outer', rootRunId: 'outer', depth: 1,
      name: 'Nested', status: 'running', defJson: JSON.stringify({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Nested', steps: [{ id: 'nested-loop', name: 'Nested loop', kind: 'workflow-map' }] }), createdAt: 1, updatedAt: 1 }).run()
    database.db.insert(schema.workflowSteps).values({ id: `step-${outer.runId}`, runId: outer.runId, idx: 0, name: 'Nested loop', status: 'running', createdAt: 1, updatedAt: 1 }).run()
    const selected = store.reserve(request(outer.runId)); settle(selected.selectionId)
    const row = workflowSelectionPage(database.db, outer.runId).records[0]
    const preparation = prepareWorkflowReprocess(database.db, outer.runId, row.id)
    const originalScope = workflowProcessingScopeKey(database.db, outer.runId, `step-${outer.runId}`)
    const command = { sourceRunId: outer.runId, recordId: row.id, digest: preparation.digest, requestId: 'reprocess' }
    expect(() => store.reserveReprocess({ ...command, digest: 'changed' })).toThrow('preparation changed')
    const again = store.reserveReprocess(command)
    expect(again.dispatches[0].runId).not.toBe(selected.dispatches[0].runId)
    expect(again.dispatches[0].taskId).not.toBe(selected.dispatches[0].taskId)
    expect(database.db.select().from(schema.workflowSelections).where(eq(schema.workflowSelections.id, again.selectionId)).get()?.scopeKey).toBe(originalScope)
    expect(again.dispatches[0].rootRunId).toBe(again.dispatches[0].runId)
    const history = workflowRecordAttemptPage(database.db, outer.runId, row.id)
    expect(history.attempts).toHaveLength(2)
    expect(history.attempts.some(attempt => attempt.previousAttemptId === preparation.previousAttemptId)).toBe(true)
    expect(store.reserveReprocess(command)).toEqual(again)
    expect(() => store.reserveReprocess({ ...command, digest: 'changed' })).toThrow('different content')
    expect(database.db.select().from(schema.workflowRecordStates).all()).toHaveLength(2)
  })

  it('allows conditions after the checkpoint consumer but rejects conditional admission', () => {
    const def: WorkflowDef = { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Check records', steps: [
      { id: 'find', name: 'Find', kind: 'find-records' },
      { id: 'loop', name: 'Loop', kind: 'workflow-map', items: { step: 'find', pointer: '/records' }, repeat: { mode: 'unseen' } },
      { id: 'condition', name: 'Report?', kind: 'if', branches: { true: 'report', otherwise: 'finish' } },
      { id: 'report', name: 'Report', after: ['condition'] },
      { id: 'finish', name: 'Finish', after: ['condition'] },
    ] }
    expect(incrementalConsumer(def, def.steps[0])).toBe(def.steps[1])
    def.steps.unshift({ id: 'before', name: 'Process?', kind: 'if', branches: { true: 'find', otherwise: 'finish' } })
    expect(() => incrementalConsumer(def, def.steps[1])).toThrow('skip its consuming loop')
  })
})

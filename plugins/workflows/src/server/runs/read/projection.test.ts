import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../../../node/schema'
import { workflowRunList, workflowTaskNavigation } from './projection'

describe('workflow task navigation projection', () => {
  let database: TestPluginDb
  beforeEach(() => { database = makeTestPluginDb('workflows') })
  afterEach(() => database.cleanup())

  it('uses admitted turns for run totals, including child turns, and leaves unknown totals unknown', async () => {
    const run = (id: string, depth: number, rootRunId: string) => ({
      id, taskId: `${id}-task`, name: id, status: 'done', posture: 'gated', trigger: 'manual',
      defJson: JSON.stringify({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: id, steps: [] }), rootRunId,
      parentRunId: depth ? rootRunId : null, parentStepId: null, depth, createdAt: 1, updatedAt: 2,
    })
    await database.db.insert(schema.workflowRuns).values([
      run('root', 0, 'root'), run('child', 1, 'root'), run('unpriced', 0, 'unpriced'), run('zero', 0, 'zero'),
    ])
    await database.db.insert(schema.workflowSteps).values({
      id: 'old-step', runId: 'unpriced', idx: 0, name: 'Old step', kind: 'agent', mode: 'headless',
      status: 'done', costUsd: 99, createdAt: 1, updatedAt: 2,
    })
    await database.db.insert(schema.workflowTurnAdmissions).values([
      { id: 'root-turn', rootRunId: 'root', runId: 'root', stepId: 'one', state: 'settled', costUsd: 0.1, createdAt: 1 },
      { id: 'child-turn', rootRunId: 'root', runId: 'child', stepId: 'two', state: 'settled', costUsd: 0.2, createdAt: 1 },
      { id: 'reserved', rootRunId: 'root', runId: 'child', stepId: 'three', state: 'reserved', costUsd: 0, createdAt: 1 },
      { id: 'zero-turn', rootRunId: 'zero', runId: 'zero', stepId: 'one', state: 'settled', costUsd: 0, createdAt: 1 },
    ])

    const rows = (await workflowRunList(database.db)).runs
    expect(rows.find((row) => row.id === 'root')?.costUsd).toBeCloseTo(0.3)
    expect(rows.find((row) => row.id === 'child')?.costUsd).toBeCloseTo(0.2)
    expect(rows.find((row) => row.id === 'unpriced')?.costUsd).toBeNull()
    expect(rows.find((row) => row.id === 'zero')?.costUsd).toBe(0)
    expect(rows.find((row) => row.id === 'child')).toMatchObject({ startedAt: 1, endedAt: 2, status: 'done' })
  })

  it('keeps insertion order for tied descendant timestamps and falls back when reprocess sources disappear', async () => {
    const run = (id: string, taskId: string, status: string, parentRunId: string | null, rootRunId: string, trigger = 'manual') => ({
      id, taskId, name: id, status, trigger, defJson: '{}', parentRunId, rootRunId, createdAt: 1, updatedAt: 2,
    })
    database.db.insert(schema.workflowRuns).values([
      run('root', 'root-task', 'running', null, 'root'),
      run('z-first', 'child-task', 'gated', 'root', 'root'),
      run('a-second', 'child-task', 'done', 'root', 'root'),
      run('orphan', 'orphan-task', 'failed', 'missing', 'missing'),
      run('reprocess', 'reprocess-task', 'cancelling', null, 'reprocess', 'reprocess'),
    ]).run()
    database.db.insert(schema.workflowDispatches).values({
      id: 'dispatch', callerKey: 'reprocess', payloadFingerprint: 'fingerprint', payloadJson: '{}',
      parentTaskId: 'gone', taskId: 'reprocess-task', runId: 'reprocess', rootRunId: 'reprocess',
      parentRunId: 'gone', parentStepId: 'loop', state: 'run-started', createdAt: 1, updatedAt: 2,
    }).run()
    expect(await workflowTaskNavigation(database.db)).toEqual({ groups: [
      { rootTaskId: 'root-task', descendants: 1, running: 0, attention: 1 },
      { rootTaskId: 'reprocess-task', descendants: 1, running: 1, attention: 0 },
    ] })
    expect((await workflowRunList(database.db)).runs.map(run => run.id)).toEqual(['root', 'z-first', 'a-second', 'orphan', 'reprocess'])
  })

  it('aggregates latest descendant attention under the original root, including reprocess roots', async () => {
    const run = (id: string, taskId: string, status: string, parentRunId: string | null, rootRunId: string, trigger = 'manual', updatedAt = 1) => ({
      id, taskId, name: id, status, trigger, defJson: JSON.stringify({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: id, steps: [] }),
      parentRunId, rootRunId, createdAt: 1, updatedAt,
    })
    await database.db.insert(schema.workflowRuns).values([
      run('root', 'root-task', 'running', null, 'root'),
      run('child-old', 'child-task', 'failed', 'root', 'root', 'manual', 1),
      run('child-latest', 'child-task', 'done', 'root', 'root', 'manual', 2),
      run('gate', 'gate-task', 'gated', 'root', 'root'),
      run('reprocess', 'reprocess-task', 'running', null, 'reprocess', 'reprocess'),
    ]).run()
    await database.db.insert(schema.workflowDispatches).values({
      id: 'reprocess-dispatch', callerKey: 'reprocess:one', payloadFingerprint: 'fingerprint',
      payloadJson: JSON.stringify({ rootReprocess: true }), parentTaskId: 'root-task', taskId: 'reprocess-task',
      runId: 'reprocess', rootRunId: 'reprocess', parentRunId: 'root', parentStepId: 'loop', itemKey: 'record',
      state: 'run-started', error: null, createdAt: 1, updatedAt: 1,
    }).run()

    await expect(workflowTaskNavigation(database.db)).resolves.toEqual({ groups: [{
      rootTaskId: 'root-task', descendants: 3, running: 1, attention: 1,
    }] })
  })
})

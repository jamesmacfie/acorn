import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../node/schema'
import { workflowTaskNavigation } from './workflowRunProjection'

describe('workflow task navigation projection', () => {
  let database: TestPluginDb
  beforeEach(() => { database = makeTestPluginDb('workflows') })
  afterEach(() => database.cleanup())

  it('aggregates latest descendant attention under the original root, including reprocess roots', async () => {
    const run = (id: string, taskId: string, status: string, parentRunId: string | null, rootRunId: string, trigger = 'manual', updatedAt = 1) => ({
      id, taskId, name: id, status, trigger, defJson: JSON.stringify({ name: id, steps: [] }),
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

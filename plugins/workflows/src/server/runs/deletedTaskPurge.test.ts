import { expect, it } from 'vitest'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import { workflowRuns, workflowSteps } from '../../node/schema'
import { purgeDeletedTaskRuns } from './deletedTaskPurge'

it('deletes a deleted task\'s settled runs and their steps, and leaves a moving run for later', async () => {
  const fixture = makeTestPluginDb('workflows')
  try {
    const at = Date.now()
    const run = (id: string, taskId: string, status: string) => ({ id, taskId, rootRunId: id, name: id, status, defJson: '{}', createdAt: at, updatedAt: at })
    await fixture.db.insert(workflowRuns).values([run('done', 'gone', 'done'), run('moving', 'gone', 'running'), run('other', 'kept', 'done')])
    await fixture.db.insert(workflowSteps).values(['done', 'moving', 'other'].map((runId) => ({
      id: `${runId}-step`, runId, idx: 0, name: 'step', status: 'done', createdAt: at, updatedAt: at,
    })))

    expect(purgeDeletedTaskRuns(fixture.db, ['gone'])).toBe(1)

    expect((await fixture.db.select({ id: workflowRuns.id }).from(workflowRuns)).map((row) => row.id).sort()).toEqual(['moving', 'other'])
    expect((await fixture.db.select({ id: workflowSteps.id }).from(workflowSteps)).map((row) => row.id).sort()).toEqual(['moving-step', 'other-step'])
    expect(purgeDeletedTaskRuns(fixture.db, ['gone'])).toBe(0)
  } finally { fixture.cleanup() }
})

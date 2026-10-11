import { expect, it } from 'vitest'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import { workflowAgentLaunches, workflowRuns, workflowSteps } from '../../node/schema'
import { purgeDeletedTaskRuns } from './deletedTaskPurge'

it("deletes a deleted task's settled runs and their steps, and leaves a moving run for later", async () => {
  const fixture = makeTestPluginDb('workflows')
  try {
    const at = Date.now()
    const run = (id: string, taskId: string, status: string) => ({
      id,
      taskId,
      rootRunId: id,
      name: id,
      status,
      defJson: '{}',
      createdAt: at,
      updatedAt: at,
    })
    await fixture.db
      .insert(workflowRuns)
      .values([run('done', 'gone', 'done'), run('moving', 'gone', 'running'), run('other', 'kept', 'done')])
    await fixture.db.insert(workflowSteps).values(
      ['done', 'moving', 'other'].map((runId) => ({
        id: `${runId}-step`,
        runId,
        idx: 0,
        name: 'step',
        status: 'done',
        createdAt: at,
        updatedAt: at,
      })),
    )

    const launch = (id: string, taskId: string, state: string) => ({
      id,
      key: id,
      taskId,
      sessionId: 's',
      callerTitle: 'Chat',
      callerTurnId: null,
      policyId: 'p',
      definitionKey: 'db:x',
      graphDigest: 'g',
      payloadFingerprint: 'f',
      graphJson: '{}',
      effectiveJson: '{}',
      state,
      error: null,
      createdAt: at,
      updatedAt: at,
    })
    // Receipts share their run's ID. One still waiting for its caller has no run row yet.
    await fixture.db
      .insert(workflowAgentLaunches)
      .values([
        launch('done', 'gone', 'started'),
        launch('moving', 'gone', 'started'),
        launch('waiting', 'gone', 'awaiting-caller'),
        launch('other', 'kept', 'started'),
      ])

    expect(purgeDeletedTaskRuns(fixture.db, ['gone'])).toBe(1)
    expect(
      (await fixture.db.select({ id: workflowAgentLaunches.id }).from(workflowAgentLaunches))
        .map((row) => row.id)
        .sort(),
    ).toEqual(['moving', 'other'])

    expect((await fixture.db.select({ id: workflowRuns.id }).from(workflowRuns)).map((row) => row.id).sort()).toEqual([
      'moving',
      'other',
    ])
    expect((await fixture.db.select({ id: workflowSteps.id }).from(workflowSteps)).map((row) => row.id).sort()).toEqual(
      ['moving-step', 'other-step'],
    )
    expect(purgeDeletedTaskRuns(fixture.db, ['gone'])).toBe(0)
  } finally {
    fixture.cleanup()
  }
})

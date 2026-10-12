import { expect, it } from 'vitest'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import { eq } from 'drizzle-orm'
import { workflowRuns, workflowSteps } from '../../node/schema'
import { readWorkflowCheckoutActivity, workflowCheckoutActivity } from './checkoutActivity'

it('keeps running, gated, cancelling, and unknown runs busy across recovery', () => {
  for (const status of ['running', 'gated', 'cancelling', 'unknown']) {
    expect(workflowCheckoutActivity({ taskId: 'task', status })).toHaveLength(1)
  }
})

it('reads durable gated and cancelling runs until terminal settlement', async () => {
  const fixture = makeTestPluginDb('workflows')
  try {
    const at = Date.now()
    await fixture.db.insert(workflowRuns).values({
      id: 'run',
      taskId: 'task',
      rootRunId: 'run',
      name: 'Fixture',
      status: 'gated',
      defJson: '{}',
      createdAt: at,
      updatedAt: at,
    })
    expect(await readWorkflowCheckoutActivity(fixture.db, ['task'])).toMatchObject([{ description: 'workflow gated' }])
    await fixture.db.update(workflowRuns).set({ status: 'cancelling' }).where(eq(workflowRuns.id, 'run'))
    expect(await readWorkflowCheckoutActivity(fixture.db, ['task'])).toMatchObject([
      { description: 'workflow cancelling' },
    ])
    await fixture.db.update(workflowRuns).set({ status: 'cancelled' }).where(eq(workflowRuns.id, 'run'))
    expect(await readWorkflowCheckoutActivity(fixture.db, ['task'])).toEqual([])
  } finally {
    fixture.cleanup()
  }
})

it('releases a checkout only after terminal workflow settlement', () => {
  for (const status of ['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled']) {
    expect(workflowCheckoutActivity({ taskId: 'task', status })).toEqual([])
  }
})

it('frees the checkout while the run only waits, at a person or between polls', () => {
  const sleeping = JSON.stringify({ policyWait: { since: 1, deadlineAt: 2, polls: 1, state: 'sleeping' } })
  const polling = JSON.stringify({ policyWait: { since: 1, deadlineAt: 2, polls: 1, state: 'polling' } })
  const run = { taskId: 'task', status: 'running' }
  expect(workflowCheckoutActivity({ ...run, status: 'gated' }, [{ status: 'waiting-gate', inputsJson: null }])).toEqual(
    [],
  )
  expect(workflowCheckoutActivity(run, [{ status: 'running', inputsJson: sleeping }])).toEqual([])
  // A poll in progress, any other running step, or a run being cancelled still holds it.
  expect(workflowCheckoutActivity(run, [{ status: 'running', inputsJson: polling }])).toHaveLength(1)
  expect(
    workflowCheckoutActivity(run, [
      { status: 'running', inputsJson: sleeping },
      { status: 'running', inputsJson: null },
    ]),
  ).toHaveLength(1)
  expect(
    workflowCheckoutActivity({ ...run, status: 'cancelling' }, [{ status: 'waiting-gate', inputsJson: null }]),
  ).toHaveLength(1)
  // Between one step settling and the next starting, nothing is waiting, so it is busy.
  expect(workflowCheckoutActivity(run, [])).toHaveLength(1)
})

it('reads waiting steps from the database', async () => {
  const fixture = makeTestPluginDb('workflows')
  try {
    const at = Date.now()
    await fixture.db.insert(workflowRuns).values({
      id: 'run',
      taskId: 'task',
      rootRunId: 'run',
      name: 'Fixture',
      status: 'running',
      defJson: '{}',
      createdAt: at,
      updatedAt: at,
    })
    const step = {
      runId: 'run',
      kind: 'gate-policy',
      createdAt: at,
      updatedAt: at,
    }
    await fixture.db.insert(workflowSteps).values([
      {
        ...step,
        id: 'gate',
        idx: 0,
        name: 'await-review',
        status: 'running',
        inputsJson: JSON.stringify({ policyWait: { since: at, deadlineAt: at + 1, polls: 1, state: 'sleeping' } }),
      },
      { ...step, id: 'after', idx: 1, name: 'address-review', status: 'pending' },
    ])
    expect(await readWorkflowCheckoutActivity(fixture.db, ['task'])).toEqual([])
  } finally {
    fixture.cleanup()
  }
})

import { expect, it } from 'vitest'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import { eq } from 'drizzle-orm'
import { workflowRuns } from '../../node/schema'
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

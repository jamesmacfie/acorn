import { expect, it } from 'vitest'
import { workflowCheckoutActivity } from './checkoutActivity'

it('keeps running, gated, cancelling, and unknown runs busy across recovery', () => {
  for (const status of ['running', 'gated', 'cancelling', 'unknown']) {
    expect(workflowCheckoutActivity({ taskId: 'task', status })).toHaveLength(1)
  }
})

it('releases a checkout only after terminal workflow settlement', () => {
  for (const status of ['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled']) {
    expect(workflowCheckoutActivity({ taskId: 'task', status })).toEqual([])
  }
})

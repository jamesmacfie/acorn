import { expect, it } from 'vitest'
import { agentCheckoutActivity } from './checkoutActivity'

it('blocks queued and unsettled turns even when their session appears idle or archived', () => {
  for (const status of ['queued', 'dispatching', 'active', 'waiting-permission', 'waiting-question', 'retrying', 'cancelling', 'unknown']) {
    expect(agentCheckoutActivity({ taskId: 'task', runtimeState: 'ready', status })).toHaveLength(1)
  }
  expect(agentCheckoutActivity({ taskId: 'task', runtimeState: 'archived', status: 'cancelling' })).toHaveLength(1)
})

it('allows idle sessions but blocks live or unknown session states', () => {
  for (const runtimeState of ['ready', 'stopped', 'failed', 'archived']) {
    expect(agentCheckoutActivity({ taskId: 'task', runtimeState, status: null })).toEqual([])
  }
  for (const runtimeState of ['creating', 'running', 'waiting-permission', 'cancelling', 'unknown']) {
    expect(agentCheckoutActivity({ taskId: 'task', runtimeState, status: 'completed' })).toHaveLength(1)
  }
})

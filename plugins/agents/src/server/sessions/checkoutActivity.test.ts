import { expect, it } from 'vitest'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import { eq } from 'drizzle-orm'
import * as schema from '../../node/schema'
import { agentCheckoutActivity, readAgentCheckoutActivity } from './checkoutActivity'

it('blocks queued and unsettled turns even when their session appears idle or archived', () => {
  for (const status of ['queued', 'dispatching', 'active', 'waiting-permission', 'waiting-question', 'retrying', 'cancelling', 'unknown']) {
    expect(agentCheckoutActivity({ taskId: 'task', runtimeState: 'ready', status })).toHaveLength(1)
  }
  expect(agentCheckoutActivity({ taskId: 'task', runtimeState: 'archived', status: 'cancelling' })).toHaveLength(1)
})

it('reads durable queued, permission-waiting, and cancelling turns across an archived session', async () => {
  const fixture = makeTestPluginDb('agents')
  try {
    const at = Date.now()
    await fixture.db.insert(schema.agentSessions).values({ id: 'session', taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive',
      driverKind: 'fake', driverVersion: '1', runtimeState: 'ready', statusAuthority: 'protocol', title: 'Fixture', createdAt: at, updatedAt: at })
    await fixture.db.insert(schema.agentTurns).values({ id: 'turn', sessionId: 'session', ordinal: 0, source: 'interactive', status: 'queued',
      inputJson: '[]', idempotencyKey: 'key', createdAt: at })
    expect(await readAgentCheckoutActivity(fixture.db, ['task'])).toMatchObject([{ description: 'agent turn queued' }])
    await fixture.db.update(schema.agentTurns).set({ status: 'waiting-permission' }).where(eq(schema.agentTurns.id, 'turn'))
    expect(await readAgentCheckoutActivity(fixture.db, ['task'])).toMatchObject([{ description: 'agent turn waiting-permission' }])
    await fixture.db.update(schema.agentSessions).set({ archivedAt: at }).where(eq(schema.agentSessions.id, 'session'))
    await fixture.db.update(schema.agentTurns).set({ status: 'cancelling' }).where(eq(schema.agentTurns.id, 'turn'))
    expect(await readAgentCheckoutActivity(fixture.db, ['task'])).toMatchObject([{ description: 'agent turn cancelling' }])
    await fixture.db.update(schema.agentTurns).set({ status: 'cancelled' }).where(eq(schema.agentTurns.id, 'turn'))
    expect(await readAgentCheckoutActivity(fixture.db, ['task'])).toEqual([])
  } finally { fixture.cleanup() }
})

it('allows idle sessions but blocks live or unknown session states', () => {
  for (const runtimeState of ['ready', 'stopped', 'failed', 'archived']) {
    expect(agentCheckoutActivity({ taskId: 'task', runtimeState, status: null })).toEqual([])
  }
  for (const runtimeState of ['creating', 'running', 'waiting-permission', 'cancelling', 'unknown']) {
    expect(agentCheckoutActivity({ taskId: 'task', runtimeState, status: 'completed' })).toHaveLength(1)
  }
})

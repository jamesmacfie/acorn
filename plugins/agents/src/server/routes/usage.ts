import { Hono } from 'hono'
import type { AgentUsageSnapshot } from '../../shared/usage'
import {
  validateAgentPricingPreferences,
  type AgentPricingPreferences,
} from '../../shared/pricing'
import { bridgeSlot, viaBridge } from '@acorn/node-core/server/bridge.ts'
import { getDb } from '@acorn/node-core/server/db/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import {
  readAgentPricingPreferences,
  writeAgentPricingPreferences,
} from '../pricingStore'

export type AgentUsageBridge = {
  read(options: { userId: string; force?: boolean }): Promise<AgentUsageSnapshot>
}

export const agentUsageBridgeSlot = bridgeSlot<AgentUsageBridge>()
export const setAgentUsageBridge = agentUsageBridgeSlot.set

export const agentUsage = new Hono<AppEnv>()
  .get('/pricing', async (c) => {
    const uid = ownerId(c)
    return c.json(await readAgentPricingPreferences(getDb(c.env), uid))
  })
  .put('/pricing', async (c) => {
    const body = await c.req.json().catch(() => null) as unknown
    const result = validateAgentPricingPreferences(body)
    if (!result.ok) return respondError(c, 400, 'bad_request', result.errors)
    const uid = ownerId(c)
    await writeAgentPricingPreferences(getDb(c.env), uid, result.value)
    return c.json(result.value satisfies AgentPricingPreferences)
  })
  .get('/usage', (c) => {
    const userId = ownerId(c)
    return viaBridge(c, agentUsageBridgeSlot, (bridge) => bridge.read({ userId }))
  })
  .post('/usage/refresh', (c) => {
    const userId = ownerId(c)
    return viaBridge(c, agentUsageBridgeSlot, (bridge) => bridge.read({ userId, force: true }))
  })

import { Hono } from 'hono'
import type { AgentUsageSnapshot } from '../../shared/usage'
import {
  validateAgentPricingPreferences,
  type AgentPricingPreferences,
} from '../../shared/pricing'
import { bridgeSlot, viaBridge } from '../../../../core/server/bridge'
import { getDb } from '../../../../core/server/db'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'
import { respondError } from '../../../../core/server/respond'
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
    const user = getUser(c)
    return c.json(await readAgentPricingPreferences(getDb(c.env), user.login))
  })
  .put('/pricing', async (c) => {
    const body = await c.req.json().catch(() => null) as unknown
    const result = validateAgentPricingPreferences(body)
    if (!result.ok) return respondError(c, 400, 'bad_request', result.errors)
    const user = getUser(c)
    await writeAgentPricingPreferences(getDb(c.env), user.login, result.value)
    return c.json(result.value satisfies AgentPricingPreferences)
  })
  .get('/usage', (c) => {
    const userId = getUser(c).login
    return viaBridge(c, agentUsageBridgeSlot, (bridge) => bridge.read({ userId }))
  })
  .post('/usage/refresh', (c) => {
    const userId = getUser(c).login
    return viaBridge(c, agentUsageBridgeSlot, (bridge) => bridge.read({ userId, force: true }))
  })

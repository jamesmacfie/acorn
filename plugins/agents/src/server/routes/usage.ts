import { Hono } from 'hono'
import type { AgentUsageSnapshot } from '../../shared/usage'
import {
  validateAgentPricingPreferences,
  type AgentPricingPreferences,
} from '../../shared/pricing'
import { bridgeSlot, viaBridge } from '@acorn/node-core/server/bridge.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'

// Account-scoped local provider usage, plus the pricing overrides it is computed against.
//
// All four handlers go through the bridge now. The two pricing handlers used to read and write core's
// `prefs` table directly with `getDb(c.env)`, which stopped being allowed when this plugin took
// ownership of its own database: `c.env` carries CORE's handle, and a plugin route reaching into it is
// the coupling the split removes. The plugin's init fills the bridge over `CoreServices.prefs`
// (main/pricingStore.ts), so the preference still lives in core's table — read by its owner, on behalf
// of the caller whose identity `ownerId(c)` resolves.
export type AgentUsageBridge = {
  read(options: { userId: string; force?: boolean }): Promise<AgentUsageSnapshot>
  pricing(userId: string): Promise<AgentPricingPreferences>
  setPricing(userId: string, preferences: AgentPricingPreferences): Promise<void>
}

export const agentUsageBridgeSlot = bridgeSlot<AgentUsageBridge>()
export const setAgentUsageBridge = agentUsageBridgeSlot.set

export const agentUsage = new Hono<AppEnv>()
  .get('/pricing', (c) => {
    const userId = ownerId(c)
    return viaBridge(c, agentUsageBridgeSlot, (bridge) => bridge.pricing(userId))
  })
  .put('/pricing', async (c) => {
    const body = await c.req.json().catch(() => null) as unknown
    // Validated at the boundary, before anything is stored: the renderer is the less-trusted side, and
    // a malformed override would otherwise be parsed back into the built-in table on every read and
    // look like a silently discarded save.
    const result = validateAgentPricingPreferences(body)
    if (!result.ok) return respondError(c, 400, 'bad_request', result.errors)
    const userId = ownerId(c)
    return viaBridge(c, agentUsageBridgeSlot, async (bridge) => {
      await bridge.setPricing(userId, result.value)
      return result.value satisfies AgentPricingPreferences
    })
  })
  .get('/usage', (c) => {
    const userId = ownerId(c)
    return viaBridge(c, agentUsageBridgeSlot, (bridge) => bridge.read({ userId }))
  })
  .post('/usage/refresh', (c) => {
    const userId = ownerId(c)
    return viaBridge(c, agentUsageBridgeSlot, (bridge) => bridge.read({ userId, force: true }))
  })

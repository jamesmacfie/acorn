import { Hono } from 'hono'
import type { AgentUsageSnapshot } from '../../shared/usage'
import {
  validateAgentPricingPreferences,
  type AgentPricingPreferences,
} from '../../shared/pricing'
import { routeCapability, setRouteTestCapability, viaBridge } from '@acorn/node-core/server/bridge.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId, requireDevice } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'

export type AgentUsageBridge = {
  read(options: { userId: string; force?: boolean }): Promise<AgentUsageSnapshot>
  pricing(userId: string): Promise<AgentPricingPreferences>
  setPricing(userId: string, preferences: AgentPricingPreferences): Promise<void>
}

export const AGENT_USAGE = routeCapability<AgentUsageBridge>('agents.usageRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setAgentUsageBridge = (bridge: AgentUsageBridge | null): void => setRouteTestCapability(AGENT_USAGE, bridge)

export const agentUsage = new Hono<AppEnv>()
  .get('/pricing', (c) => {
    const userId = ownerId(c)
    return viaBridge(c, AGENT_USAGE, (bridge) => bridge.pricing(userId))
  })
  // Device only. This writes the OWNER's pricing preferences, keyed on `ownerId(c)` — which is the same value for
  // a device and for an agent-spawned child, so nothing else here distinguished them. A task-scoped agent could
  // overwrite the cost table every usage figure in the app is computed against, for every task; that is a
  // settings surface, not something a session needs. The reads stay open: an agent asking what a turn costs is
  // reasonable, and it is the owner's own data either way.
  .put('/pricing', requireDevice, async (c) => {
    const body = await c.req.json().catch(() => null) as unknown
    // Validated at the boundary, before anything is stored: the renderer is the less-trusted side, and
    // a malformed override would otherwise be parsed back into the built-in table on every read and
    // look like a silently discarded save.
    const result = validateAgentPricingPreferences(body)
    if (!result.ok) return respondError(c, 400, 'bad_request', result.errors)
    const userId = ownerId(c)
    return viaBridge(c, AGENT_USAGE, async (bridge) => {
      await bridge.setPricing(userId, result.value)
      return result.value satisfies AgentPricingPreferences
    })
  })
  .get('/usage', (c) => {
    const userId = ownerId(c)
    return viaBridge(c, AGENT_USAGE, (bridge) => bridge.read({ userId }))
  })
  .post('/usage/refresh', (c) => {
    const userId = ownerId(c)
    return viaBridge(c, AGENT_USAGE, (bridge) => bridge.read({ userId, force: true }))
  })

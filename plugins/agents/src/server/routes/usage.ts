import { Hono } from 'hono'
import type { AgentUsageSnapshot } from '../../shared/usage'
import {
  validateAgentPricingPreferences,
  type AgentPricingPreferences,
} from '../../shared/pricing'
import { type AppEnv, ownerId, requireDevice, respondError, routeCapability, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'

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
  // Device only. This writes the owner's pricing preferences, keyed on `ownerId(c)`, which is the same
  // value for a device and for an agent-spawned child, so nothing else here distinguished them. A
  // task-scoped agent could otherwise overwrite the cost table every usage figure in the app is
  // computed against, for every task. The reads stay open: an agent asking what a turn costs is
  // reasonable, and it's the owner's own data either way.
  .put('/pricing', requireDevice, async (c) => {
    const body = await c.req.json().catch(() => null) as unknown
    // Validated at the boundary, before anything is stored: the renderer is the less-trusted side, and
    // a malformed override would be parsed back into the built-in table on every read and look like a
    // silently discarded save.
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

import { Hono } from 'hono'
import type { AgentUsageSnapshot } from '../../shared/usage'
import { bridgeSlot, viaBridge } from '../../../../core/server/bridge'
import type { AppEnv } from '../../../../core/server/middleware/auth'

export type AgentUsageBridge = {
  read(options?: { force?: boolean }): Promise<AgentUsageSnapshot>
}

export const agentUsageBridgeSlot = bridgeSlot<AgentUsageBridge>()
export const setAgentUsageBridge = agentUsageBridgeSlot.set

export const agentUsage = new Hono<AppEnv>()
  .get('/usage', (c) => viaBridge(c, agentUsageBridgeSlot, (bridge) => bridge.read()))
  .post('/usage/refresh', (c) => viaBridge(c, agentUsageBridgeSlot, (bridge) => bridge.read({ force: true })))

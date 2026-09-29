// Settings → MCP servers (docs/mcp.md § Your own servers).
//
// Device only, reads included, for the reason project config is: a stdio server is a command this
// node runs in every session that switches it on. A task-scoped agent that could add one would be
// choosing what runs in the next session, and one that could read them would see every command line.
import { Hono } from 'hono'
import { BridgeError, type AppEnv, requireDevice, respondError, routeCapability, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'
import {
  agentMcpServerInputSchema,
  validateAgentMcpServerName,
  type AgentMcpProbeResult,
  type AgentMcpServer,
  type AgentMcpServerInput,
} from '../../shared/mcpServers'

export type AgentMcpServersBridge = {
  list(): Promise<AgentMcpServer[]>
  save(name: string, input: AgentMcpServerInput): Promise<AgentMcpServer>
  remove(name: string): Promise<boolean>
  test(name: string): Promise<AgentMcpProbeResult | null>
}

export const AGENT_MCP_SERVERS = routeCapability<AgentMcpServersBridge>('agents.mcpServersRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setAgentMcpServersBridge = (bridge: AgentMcpServersBridge | null): void =>
  setRouteTestCapability(AGENT_MCP_SERVERS, bridge)

export const agentMcpServers = new Hono<AppEnv>()
  // Hono's trailing `/*` matches zero segments too, so this covers the bare list route.
  .use('/mcp-servers/*', requireDevice)
  .get('/mcp-servers', (c) => viaBridge(c, AGENT_MCP_SERVERS, (bridge) => bridge.list()))
  .put('/mcp-servers/:name', async (c) => {
    const name = c.req.param('name')
    const nameError = validateAgentMcpServerName(name)
    if (nameError) return respondError(c, 400, 'bad_request', [nameError])
    const parsed = agentMcpServerInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((issue) => issue.message))
    return viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      try {
        return await bridge.save(name, parsed.data)
      } catch (error) {
        // The store's one refusal: a secret named with no value and none stored under it.
        throw new BridgeError(400, 'bad_request', error instanceof Error ? error.message : 'The MCP server could not be saved.')
      }
    })
  })
  .delete('/mcp-servers/:name', (c) =>
    viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      if (!await bridge.remove(c.req.param('name'))) throw new BridgeError(404, 'not_found', 'No MCP server has that name.')
      return { ok: true }
    }))
  .post('/mcp-servers/:name/test', (c) =>
    viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      const result = await bridge.test(c.req.param('name'))
      if (!result) throw new BridgeError(404, 'not_found', 'No MCP server has that name.')
      return result
    }))

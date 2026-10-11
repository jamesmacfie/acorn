// Settings → MCP servers (docs/mcp.md § Your own servers).
//
// Device only, reads included, for the reason project config is: a stdio server is a command this
// node runs in every session that switches it on. A task-scoped agent that could add one would be
// choosing what runs in the next session, and one that could read them would see every command line.
import { Hono } from 'hono'
import {
  BridgeError,
  type AppEnv,
  requireDevice,
  respondError,
  routeCapability,
  setRouteTestCapability,
  viaBridge,
} from '@acorn/plugin-api/node'
import {
  agentMcpServerInputSchema,
  agentMcpPackageActivateInputSchema,
  agentMcpPackagePlanInputSchema,
  validateAgentMcpServerName,
  type AgentMcpProbeResult,
  type AgentMcpServer,
  type AgentMcpServerInput,
  type AgentMcpPackagePlan,
  type AgentMcpPackageTest,
  type AgentMcpPendingReview,
} from '../../shared/mcpServers'

export type AgentMcpServersBridge = {
  list(): Promise<AgentMcpServer[]>
  save(name: string, input: AgentMcpServerInput): Promise<AgentMcpServer>
  remove(name: string): Promise<boolean>
  test(name: string): Promise<AgentMcpProbeResult | null>
  consent(name: string, revision: string): Promise<AgentMcpServer | null>
  planPackage(
    coordinate: string,
    targetName: string,
    expectedRevision: string | null,
    exceptions: Array<{ coordinate: string; reason: string }>,
    signal: AbortSignal,
  ): Promise<AgentMcpPackagePlan>
  testPackagePlan(name: string, planId: string, bin: string, signal: AbortSignal): Promise<AgentMcpPackageTest>
  activatePackage(
    name: string,
    planId: string,
    bin: string,
    enabled: boolean,
    signal: AbortSignal,
  ): Promise<AgentMcpServer>
  pendingReviews(): Promise<AgentMcpPendingReview[]>
  approveReview(name: string, sessionId: string, revision: string, digest: string): Promise<AgentMcpServer>
}

export const AGENT_MCP_SERVERS = routeCapability<AgentMcpServersBridge>('agents.mcpServersRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setAgentMcpServersBridge = (bridge: AgentMcpServersBridge | null): void =>
  setRouteTestCapability(AGENT_MCP_SERVERS, bridge)

export const agentMcpServers = new Hono<AppEnv>()
  // Both mount forms, so the bare list route doesn't depend on how a Hono version matches `/*`.
  .use('/mcp-servers', requireDevice)
  .use('/mcp-servers/*', requireDevice)
  .get('/mcp-servers', (c) => viaBridge(c, AGENT_MCP_SERVERS, (bridge) => bridge.list()))
  .get('/mcp-servers/reviews', (c) => viaBridge(c, AGENT_MCP_SERVERS, (bridge) => bridge.pendingReviews()))
  .post('/mcp-servers/:name/review', async (c) => {
    const input = (await c.req.json().catch(() => null)) as {
      sessionId?: unknown
      revision?: unknown
      digest?: unknown
    } | null
    if (
      typeof input?.sessionId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.sessionId) ||
      typeof input.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.revision) ||
      typeof input.digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.digest)
    ) {
      return respondError(c, 400, 'bad_request', [
        'An exact live connection, configuration revision, and catalogue digest are required.',
      ])
    }
    return viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      try {
        return await bridge.approveReview(
          c.req.param('name'),
          input.sessionId as string,
          input.revision as string,
          input.digest as string,
        )
      } catch {
        throw new BridgeError(409, 'conflict', 'The MCP connection or catalogue changed. Review it again.')
      }
    })
  })
  .post('/mcp-servers/package-plan', async (c) => {
    const parsed = agentMcpPackagePlanInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return respondError(
        c,
        400,
        'bad_request',
        parsed.error.issues.map((issue) => issue.message),
      )
    return viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      try {
        return await bridge.planPackage(
          parsed.data.coordinate,
          parsed.data.targetName,
          parsed.data.expectedRevision,
          parsed.data.exceptions ?? [],
          c.req.raw.signal,
        )
      } catch (error) {
        throw new BridgeError(
          400,
          'bad_request',
          error instanceof Error ? error.message : 'The package could not be planned.',
        )
      }
    })
  })
  .post('/mcp-servers/package-plan/:id/test', async (c) => {
    const planId = c.req.param('id')
    const input = (await c.req.json().catch(() => null)) as { name?: unknown; bin?: unknown } | null
    if (
      !/^[0-9a-f-]{36}$/.test(planId) ||
      typeof input?.name !== 'string' ||
      validateAgentMcpServerName(input.name) ||
      typeof input.bin !== 'string' ||
      !input.bin ||
      input.bin.length > 256
    ) {
      return respondError(c, 400, 'bad_request', ['A staged plan, server name, and binary choice are required.'])
    }
    return viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      try {
        return await bridge.testPackagePlan(input.name as string, planId, input.bin as string, c.req.raw.signal)
      } catch (error) {
        throw new BridgeError(
          400,
          'bad_request',
          error instanceof Error ? error.message : 'The staged package test failed.',
        )
      }
    })
  })
  .post('/mcp-servers/:name/package-activate', async (c) => {
    const name = c.req.param('name')
    const nameError = validateAgentMcpServerName(name)
    if (nameError) return respondError(c, 400, 'bad_request', [nameError])
    const parsed = agentMcpPackageActivateInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return respondError(
        c,
        400,
        'bad_request',
        parsed.error.issues.map((issue) => issue.message),
      )
    return viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      try {
        return await bridge.activatePackage(
          name,
          parsed.data.planId,
          parsed.data.bin,
          parsed.data.enabled,
          c.req.raw.signal,
        )
      } catch (error) {
        throw new BridgeError(
          400,
          'bad_request',
          error instanceof Error ? error.message : 'The package could not be activated.',
        )
      }
    })
  })
  .put('/mcp-servers/:name', async (c) => {
    const name = c.req.param('name')
    const nameError = validateAgentMcpServerName(name)
    if (nameError) return respondError(c, 400, 'bad_request', [nameError])
    const parsed = agentMcpServerInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return respondError(
        c,
        400,
        'bad_request',
        parsed.error.issues.map((issue) => issue.message),
      )
    return viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      try {
        return await bridge.save(name, parsed.data)
      } catch (error) {
        // The store's one refusal: a secret named with no value and none stored under it.
        throw new BridgeError(
          400,
          'bad_request',
          error instanceof Error ? error.message : 'The MCP server could not be saved.',
        )
      }
    })
  })
  .delete('/mcp-servers/:name', (c) =>
    viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      if (!(await bridge.remove(c.req.param('name'))))
        throw new BridgeError(404, 'not_found', 'No MCP server has that name.')
      return { ok: true }
    }),
  )
  .post('/mcp-servers/:name/test', (c) =>
    viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      const result = await bridge.test(c.req.param('name'))
      if (!result) throw new BridgeError(404, 'not_found', 'No MCP server has that name.')
      return result
    }),
  )
  .post('/mcp-servers/:name/consent', async (c) => {
    const input = (await c.req.json().catch(() => null)) as { revision?: unknown } | null
    if (typeof input?.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision))
      return respondError(c, 400, 'bad_request', ['An exact configuration revision is required.'])
    return viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      try {
        const server = await bridge.consent(c.req.param('name'), input.revision as string)
        if (!server) throw new BridgeError(404, 'not_found', 'No MCP server has that name.')
        return server
      } catch (error) {
        if (error instanceof BridgeError) throw error
        throw new BridgeError(409, 'conflict', 'The MCP server changed. Review its configuration again.')
      }
    })
  })

// Settings → MCP servers (docs/mcp.md § Your own servers).
//
// Device only, reads included, for the reason project config is: a stdio server is a command this
// node runs in every session that switches it on. A task-scoped agent that could add one would be
// choosing what runs in the next session, and one that could read them would see every command line.
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { BridgeError, type AppEnv, requireDevice, respondError, viaBridge } from '@acorn/plugin-api/node'
import {
  agentMcpServerInputSchema,
  agentMcpPackageActivateInputSchema,
  agentMcpPackagePlanInputSchema,
  validateAgentMcpServerName,
  type AgentMcpServer,
} from '../../shared/mcpServers'
import { AGENT_MCP_SERVERS } from './mcpServersBridge'

// The browser returns to this address on the person's own machine. Loopback only, so the code in it
// never leaves that machine, and plain http, because no certificate exists for a loopback port.
function redirectUriProblem(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'The return address is not a URL.'
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
    return 'The return address must be http on 127.0.0.1, [::1], or localhost.'
  if (url.username || url.password || url.hash) return 'The return address cannot carry credentials or a fragment.'
  return null
}

const signInStartSchema = z.object({
  redirectUri: z
    .string()
    .max(4_096)
    .superRefine((value, ctx) => {
      const problem = redirectUriProblem(value)
      if (problem) ctx.addIssue({ code: 'custom', message: problem })
    }),
})

const signInFinishSchema = z.union([
  z.strictObject({ code: z.string().min(1).max(4_096), state: z.string().min(1).max(4_096) }),
  z.strictObject({ address: z.string().min(1).max(4_096) }),
])

// A sign-in attempt belongs to the device that started it, so another device cannot finish or cancel it.
const deviceOf = (c: Context<AppEnv>): string | null => c.get('principal')?.deviceId ?? null

const badRequest = (error: unknown, fallback: string) =>
  new BridgeError(400, 'bad_request', error instanceof Error ? error.message : fallback)

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
  // Sign-in (docs/mcp/sign-in.md). The client opens the browser and carries the code
  // back; everything else happens on the node.
  .post('/mcp-servers/:name/sign-in', async (c) => {
    const deviceId = deviceOf(c)
    if (!deviceId) return respondError(c, 403, 'interactive_user_required')
    const parsed = signInStartSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return respondError(
        c,
        400,
        'bad_request',
        parsed.error.issues.map((issue) => issue.message),
      )
    return viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      try {
        return await bridge.startSignIn(c.req.param('name'), parsed.data.redirectUri, deviceId)
      } catch (error) {
        throw badRequest(error, 'The sign-in could not start.')
      }
    })
  })
  .post('/mcp-servers/:name/sign-in/:attemptId/finish', async (c) => {
    const deviceId = deviceOf(c)
    if (!deviceId) return respondError(c, 403, 'interactive_user_required')
    const parsed = signInFinishSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Send the code and state, or the whole address.'])
    return viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      let server: AgentMcpServer | null
      try {
        server = await bridge.finishSignIn(c.req.param('name'), c.req.param('attemptId'), deviceId, parsed.data)
      } catch (error) {
        throw badRequest(error, 'The sign-in could not finish.')
      }
      if (!server) throw new BridgeError(404, 'not_found', 'No MCP server has that name.')
      return server
    })
  })
  .delete('/mcp-servers/:name/sign-in/:attemptId', (c) => {
    const deviceId = deviceOf(c)
    if (!deviceId) return respondError(c, 403, 'interactive_user_required')
    return viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      if (!(await bridge.cancelSignIn(c.req.param('name'), c.req.param('attemptId'), deviceId)))
        throw new BridgeError(404, 'not_found', 'No sign-in is waiting for this server.')
      return { ok: true }
    })
  })
  .post('/mcp-servers/:name/sign-out', (c) =>
    viaBridge(c, AGENT_MCP_SERVERS, async (bridge) => {
      const server = await bridge.signOut(c.req.param('name'))
      if (!server) throw new BridgeError(404, 'not_found', 'No MCP server has that name.')
      return server
    }),
  )

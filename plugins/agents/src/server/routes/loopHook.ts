// The harness bridge's ingress, and what Settings → Plugins shows about it (docs/managed-agents/loop-hooks.md).
//
// The bridge program posts here with the task token every acorn MCP server already holds
// (docs/mcp.md § Launch environment). The token, not the body, names the task and the session, so a
// body can't point a hook at somebody else's session. Every refusal on this route is the empty reply,
// because the bridge prints whatever it gets and an error would only be noise in the harness.
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { type AppEnv, requireDevice, routeCapability, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'
import {
  LOOP_HOOK_VERSION,
  type AgentLoopCoverage,
  type AgentLoopHookReply,
  type AgentLoopHookRequest,
} from '../../contract/loopHook.ts'

export type AgentLoopHooksBridge = {
  answer(caller: { taskId: string; sessionId: string }, request: AgentLoopHookRequest): Promise<AgentLoopHookReply>
  coverage(pluginId: string): Promise<AgentLoopCoverage>
}

export const AGENT_LOOP_HOOKS = routeCapability<AgentLoopHooksBridge>('agents.loopHooksRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setAgentLoopHooksBridge = (bridge: AgentLoopHooksBridge | null): void =>
  setRouteTestCapability(AGENT_LOOP_HOOKS, bridge)

// A hook input carries one tool call's arguments and, after it, its result. Claude spills an output
// over its own limit to a file, so a megabyte is generous.
const MAX_BODY_BYTES = 1024 * 1024

const requestSchema = z.object({
  version: z.literal(LOOP_HOOK_VERSION),
  harness: z.literal('claude'),
  event: z.enum(['PreToolUse', 'PostToolUse']),
  input: z.unknown(),
})

const NO_DECISION: AgentLoopHookReply = { version: LOOP_HOOK_VERSION, output: '' }

export const agentLoopHooks = new Hono<AppEnv>()
  .post('/loop-hook', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json(NO_DECISION) }), async (c) => {
    const principal = c.get('principal')
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null))
    // Only a task token bound to one session. A device, the service, or a token with no session has
    // no tool call of its own to answer for.
    if (!parsed.success || principal?.scope !== 'task' || !principal.taskId || !principal.sessionId)
      return c.json(NO_DECISION)
    const caller = { taskId: principal.taskId, sessionId: principal.sessionId }
    return viaBridge(c, AGENT_LOOP_HOOKS, (bridge) => bridge.answer(caller, parsed.data as AgentLoopHookRequest))
  })
  .get('/loop-coverage/:pluginId', requireDevice, (c) =>
    viaBridge(c, AGENT_LOOP_HOOKS, (bridge) => bridge.coverage(c.req.param('pluginId'))),
  )

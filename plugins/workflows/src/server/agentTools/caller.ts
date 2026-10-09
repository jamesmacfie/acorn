import { ToolError, type ToolContext } from '@acorn/plugin-api/node'
import type { AgentToolCaller, AgentToolCallerLookup } from '@acorn/plugin-agents/contract/toolCaller.ts'

/** Resolved per call: plugin init order is not defined, and a Node with Agents disabled has none. */
export type CallerLookup = () => AgentToolCallerLookup | undefined

/** The signed managed session behind a call, or null for a terminal session or no session. The
 *  session ID comes from the credential (ToolContext), never from tool input. */
export async function managedCaller(lookup: CallerLookup, context: ToolContext): Promise<AgentToolCaller | null> {
  if (!context.sessionId) return null
  return (await lookup()?.resolve(context.taskId, context.sessionId)) ?? null
}

export async function requireManagedCaller(lookup: CallerLookup, context: ToolContext): Promise<AgentToolCaller> {
  const caller = await managedCaller(lookup, context)
  if (!caller) throw new ToolError('not_found', 'Only a managed agent session can use this tool.')
  return caller
}

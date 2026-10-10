import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

/** The managed session behind a signed agent tool call, as another plugin's tool may see it. */
export type AgentToolCaller = {
  taskId: string
  sessionId: string
  title: string
  /** True for a session a workflow step started. Such a session may not start fresh workflow roots. */
  workflowOwned: boolean
  /** True for a session another agent started with `agent_spawn`. */
  delegated: boolean
  /** The run that owns the session, when the session recorded one. */
  workflowRunId: string | null
  /** The turn running now. A tool call arrives during one, so this is usually the caller's own turn. */
  activeTurnId: string | null
}

/** A turn that reached a final status. `cancelled` is a stop: the owner's, or a delegating agent's. */
export type AgentSettledTurn = {
  taskId: string
  sessionId: string
  turnId: string
  status: 'completed' | 'cancelled' | 'failed' | 'interrupted'
}

/** Resolve a signed tool caller (docs/managed-agents/session-control.md § Tool callers). `null` covers a
 *  terminal session, an archived one, and one outside the task, so a caller learns nothing about
 *  sessions it may not address. Read only; the session store stays with this plugin. */
export type AgentToolCallerLookup = {
  resolve(taskId: string, sessionId: string): Promise<AgentToolCaller | null>
  /** Hear every turn that settles, after its write commits. Not durable: after a restart, a subscriber
   *  reads `agents.turns` for anything it missed. Returns the unsubscribe. */
  onTurnSettled(listener: (turn: AgentSettledTurn) => void): () => void
}

export const AGENTS_TOOL_CALLER = capabilityId<AgentToolCallerLookup>('agents.toolCaller')

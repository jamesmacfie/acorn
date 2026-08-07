import type { HeadlessResult, StreamEvent } from '@acorn/node-core/main/headless.ts'
import { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'
import type { ToolCeiling } from '@acorn/protocol/workflow.ts'

export type AgentSessionExecuteRequest = {
  taskId: string
  // The agent profile to run as. A profile with no managed driver (i.e. not claude-code or codex)
  // resolves to `null` from the implementation, which is how a caller learns to fall back to its own
  // headless path rather than failing.
  profileId: string | undefined
  // Session title, used only when a new session is created.
  title: string
  prompt: string
  schema?: object
  model?: string
  tools?: ToolCeiling
  timeoutMs?: number
  // Reuse an existing managed session rather than creating one. Validated by the provider against
  // taskId/providerId/kind — a mismatched id is an error, not a silent new session.
  managedSessionId?: string
  // Correlation ids stored on the session/turn so the owner can trace a turn back to its run. Also
  // the basis of the idempotency keys, so a retried step does not double-spend a turn.
  runId?: string
  stepId?: string
  onEvent?: (event: StreamEvent) => void
  signal?: AbortSignal
}

// Resolves to null when the profile has no managed driver — the caller then owns the fallback.
export type AgentSessionExecute = (request: AgentSessionExecuteRequest) => Promise<HeadlessResult | null>

export const AGENTS_SESSION_EXECUTE = capabilityId<AgentSessionExecute>('agents.sessionExecute')

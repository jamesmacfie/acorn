// agents.sessionExecute — run one agent turn to completion through the durable managed-agent
// runtime and return a headless-shaped result (docs/vNext/plugins.md § Cross-plugin collaboration).
//
// This file is the agents plugin's CONTRACT: the only surface another plugin may import. It carries
// the capability id and its signature, nothing executable. The consumer (workflows) never sees
// ManagedAgentRuntime, and the provider never sees WorkflowStepDef — which is why the 234 lines that
// implement this used to live in apps/node/src/wiring/managedWorkflowStep.ts, in the app, purely
// because neither plugin was allowed to import the other.
//
// The request shape is deliberately NOT workflows' RunStepOptions. It is the narrow set of fields the
// implementation actually reads, restated here so the signature belongs to the provider (as
// plugins.md requires) rather than being defined by its first caller.
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

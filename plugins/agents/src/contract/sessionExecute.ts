import { type HeadlessResult, type StreamEvent } from '@acorn/plugin-api/node'
import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import type { ToolCeiling } from '@acorn/protocol/workflow.ts'

export type AgentSessionExecuteRequest = {
  taskId: string
  // The agent profile to run as. A profile with no managed driver, meaning not claude-code or codex,
  // resolves to `null`, which is how a caller learns to fall back to its own headless path rather than
  // failing.
  profileId: string | undefined
  // Session title, used only when a new session is created.
  title: string
  prompt: string
  schema?: object
  model?: string
  // Provider option ids to the values this turn wants, as the provider advertises them (`model`,
  // `reasoning`, and whatever else its descriptor lists). Applied to the session after the provider
  // reports its option list and before the turn is enqueued, because that list is the only thing a
  // value can be validated against. A value the provider does not offer is dropped with a diagnostic
  // rather than failing the step.
  configOptions?: Record<string, string>
  tools?: ToolCeiling
  timeoutMs?: number
  // Reuse an existing managed session rather than creating one. Validated by the provider against
  // taskId, providerId and kind: a mismatched id is an error, not a silent new session.
  managedSessionId?: string
  // Correlation ids stored on the session and turn, so the owner can trace a turn back to its run. Also
  // the basis of the idempotency keys, so a retried step doesn't double-spend a turn.
  runId?: string
  stepId?: string
  onEvent?: (event: StreamEvent) => void
  signal?: AbortSignal
}

// Resolves to null when the profile has no managed driver; the caller then owns the fallback.
export type AgentSessionExecute = (request: AgentSessionExecuteRequest) => Promise<HeadlessResult | null>

export const AGENTS_SESSION_EXECUTE = capabilityId<AgentSessionExecute>('agents.sessionExecute')

// Which agent profiles have a durable managed driver. Here rather than beside the implementation
// because it is the other half of the sentence above: a caller reads it to know, before it calls,
// whether this profile will resolve to a session or to `null`. The workflows catalog says `managed`
// on a profile from this (docs/workflows.md § Contributed step kinds).
const MANAGED_PROVIDERS: Readonly<Record<string, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
}

export const managedProviderForProfile = (profileId: string | undefined): string | null =>
  MANAGED_PROVIDERS[profileId ?? ''] ?? null

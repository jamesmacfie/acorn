import { agentProfileRegistry, type HeadlessResult, type StreamEvent } from '@acorn/plugin-api/node'
import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import type { ToolCeiling } from '@acorn/protocol/toolPolicy.ts'

export type AgentSessionExecuteRequest = {
  taskId: string
  // The agent profile to run as. A profile that names no managed driver (`managedProvider`) resolves
  // to `null`, which is how a caller learns to fall back to its own headless path rather than
  // failing.
  profileId: string | undefined
  // Session title, used only when a new session is created.
  title: string
  prompt: string
  // Material the prompt works on, such as an earlier step's output or the task context. Each item
  // goes to the model as its own context block after the prompt, so the model reads it as
  // information rather than instructions and the transcript folds it instead of drawing it inline.
  context?: { label: string; source: string; content: string }[]
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
  /** Resolved from the workflow run by the workflows plugin, never from an HTTP or tool body. */
  posture?: 'gated' | 'autonomous'
  onEvent?: (event: StreamEvent) => void
  signal?: AbortSignal
}

// Resolves to null when the profile has no managed driver; the caller then owns the fallback. The
// result covers every turn the step owns, including plugin notes that joined it: the last turn's output,
// and usage across them all (docs/managed-agents/unattended-follow-ups.md).
export type AgentSessionExecute = (request: AgentSessionExecuteRequest) => Promise<HeadlessResult | null>

export const AGENTS_SESSION_EXECUTE = capabilityId<AgentSessionExecute>('agents.sessionExecute')

/** Task-checked control of a managed session another plugin didn't start
 *  (docs/managed-agents/session-control.md). */
export type AgentSessionControl = {
  /** Stop the session's running turn. */
  cancel(taskId: string, sessionId: string): Promise<void>
  /** Pick one of the values the harness advertised for one of its options, such as the model or the
   *  reasoning effort, the same way the composer's picker does. Throws for an archived or
   *  terminal-held session, an option or value the harness didn't advertise, or another task's session.
   *  The transcript names the plugin that made the change. */
  setConfig(taskId: string, sessionId: string, optionId: string, value: string): Promise<void>
}

export const AGENTS_SESSION_CONTROL = capabilityId<AgentSessionControl>('agents.sessionControl')

// Which agent profiles have a durable managed driver. Here rather than beside the implementation
// because it is the other half of the sentence above: a caller reads it to know, before it calls,
// whether this profile will resolve to a session or to `null`. The workflows catalog says `managed`
// on a profile from this (docs/workflows/step-kinds.md § Contributed step kinds).
//
// Read off the profile, which names its own driver: the built-in Claude and Codex profiles, and every
// harness a manifest contributes (../server/harnessRegistry.ts).
export const managedProviderForProfile = (profileId: string | undefined): string | null =>
  (profileId ? agentProfileRegistry.get(profileId)?.managedProvider : undefined) ?? null

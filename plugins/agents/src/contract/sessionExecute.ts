import { agentProfileRegistry, type HeadlessResult, type StreamEvent } from '@acorn/plugin-api/node'
import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import type { ToolCeiling } from '@acorn/protocol/toolPolicy.ts'
import type { AgentGoalVerdict } from './wire.ts'

/** The longest completion condition a step may carry, after rendering. */
export const MAX_AGENT_GOAL_CHARS = 2_000

/** Usage across the turns and checks a step owns so far. An unknown value stays unknown. */
type AgentExecuteUsage = { costUsd: number | null; usage: HeadlessResult['capture']['usage'] }

/** Where a step's completion condition stands (docs/workflows/agent-steps.md § Completion conditions).
 *  `checking` and `continuing` are progress. The rest are terminal: `stopped` means the step ended for
 *  a reason of its own (a refusal, `BLOCKED:`, a failed turn, cancellation, a timeout, or the budget). */
export type AgentExecuteGoalStatus =
  | 'checking'
  | 'continuing'
  | 'satisfied'
  | 'blocked'
  | 'exhausted'
  | 'unavailable'
  | 'stopped'

export type AgentExecuteGoalSummary = {
  objective: string
  status: AgentExecuteGoalStatus
  /** Goal continuations queued so far. Result repairs are counted separately. */
  continuations: number
  repairs: number
  /** The last check's verdict, which carries its reason and evidence summary. */
  verdict: AgentGoalVerdict | null
  /** The turns Acorn queued on its own, in order, and why. */
  automaticTurns: { turnId: string; reason: 'goal' | 'repair' }[]
  /** Why the step ended, when it ended without the goal satisfied. */
  reason?: string
}

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
  /** Lets an autonomous turn run with the harness's checks off. Without it the step is refused with
   *  UnguardedAgentError. Resolved by the workflows plugin like `posture`. */
  allowUnguardedAgents?: boolean
  /** A completion condition, already rendered. The step continues in the same session until a
   *  check finds it satisfied, or the step reaches a blocker or a limit. Needs a profile with a
   *  one-shot mode, because the check runs through it. */
  goal?: string
  /**
   * Asked before each turn Acorn queues on its own (a goal continuation or a result repair) and
   * before each completion check, with the usage so far. Return a reason to stop, or null to go on.
   * The step then ends with status `error` and that reason. A check never consumes a turn.
   */
  admitAutomatic?: (request: { kind: 'turn' | 'check'; usage: AgentExecuteUsage }) => Promise<string | null>
  /** Each change to the completion condition's state, for a live view of the step. */
  onGoal?: (summary: AgentExecuteGoalSummary) => void
  onEvent?: (event: StreamEvent) => void
  signal?: AbortSignal
}

/** An autonomous step was refused because its session runs commands with no sandbox and no approval,
 *  such as Claude Code's `bypassPermissions`. `mode` is the setting's value (docs/workflows/triggers.md). */
export class UnguardedAgentError extends Error {
  constructor(readonly mode: string) {
    super(`The agent runs commands without a sandbox or approval (${mode}).`)
    this.name = 'UnguardedAgentError'
  }
}

/** The step's outcome, plus its completion condition's final state when it had one. */
export type AgentSessionExecuteResult = HeadlessResult & { goal?: AgentExecuteGoalSummary }

// Resolves to null when the profile has no managed driver; the caller then owns the fallback. The
// result covers every turn the step owns, including plugin notes that joined it: the last turn's output,
// and usage across them all (docs/managed-agents/unattended-follow-ups.md).
export type AgentSessionExecute = (request: AgentSessionExecuteRequest) => Promise<AgentSessionExecuteResult | null>

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
// harness a manifest contributes (`createHarnessRegistry`).
export const managedProviderForProfile = (profileId: string | undefined): string | null =>
  (profileId ? agentProfileRegistry.get(profileId)?.managedProvider : undefined) ?? null

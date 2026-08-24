// The plugin's domain-to-StatusDot tone mapping, declared once.
//
// StatusDot takes a semantic tone, not a domain state, because the shared component has no business
// knowing what "reconnecting" means. See docs/ui-design.md § Primitive adoption ratchet.

import type { AgentSubagentStatus } from '@acorn/protocol/managedAgents.ts'

type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'accent'

/** A managed session's runtime state, as shown in the pane header, task sidebar and Agent Center. */
export const runtimeTone = (state: string): Tone => {
  if (state === 'ready') return 'ok'
  if (state === 'working' || state === 'connecting' || state === 'reconnecting') return 'accent'
  if (state === 'waiting') return 'warn'
  if (state === 'failed') return 'bad'
  return 'muted'
}

/* A tool call's dot lives elsewhere: its status is a protocol type the changes plugin also renders,
   so `agentToolTone` sits beside the renderer contract in client-core instead. */

/** A subagent's status, in its transcript card and its sidebar row. `idle` is settled rather than
 *  in flight: a Codex child rests resumable when it is done, and an accent dot on a resting subagent
 *  reads as stuck. The word for each status lives in subagentDisplay.ts. */
export const subagentTone = (status: AgentSubagentStatus | undefined): Tone => {
  if (status === 'running' || status === 'pending') return 'accent'
  if (status === 'completed') return 'ok'
  if (status === 'failed') return 'bad'
  return 'muted'
}

/** A provider's install/auth health in the Agent Center header. */
export const providerTone = (health: 'ok' | 'error' | 'missing'): Tone => {
  if (health === 'ok') return 'ok'
  // Authentication required is recoverable, so it warns rather than reading as a failure, despite the
  // state being named 'error'.
  if (health === 'error') return 'warn'
  return 'muted'
}

/** Plan-usage health, a separate vocabulary from provider health. */
export const usageTone = (health: string): Tone => {
  if (health === 'healthy') return 'ok'
  if (health === 'warning') return 'warn'
  if (health === 'critical') return 'bad'
  return 'muted'
}

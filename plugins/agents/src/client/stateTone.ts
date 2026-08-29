// The plugin's domain-to-StatusDot tone mapping, declared once.
//
// StatusDot takes a semantic tone, not a domain state, because the shared component has no business
// knowing what "reconnecting" means. See docs/ui-design.md § The closed kit.

import type { AgentSubagentStatus } from '@acorn/protocol/managedAgents.ts'

type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'accent'

/** A managed session's runtime state, as shown in the pane header, task sidebar, Agent Center and the
 *  sessions dashboard panel.
 *
 *  A finished session is muted rather than green. Most rows in a busy task are finished, so colouring
 *  all of them buries the one that is running or needs an answer. Green is reserved for work in
 *  flight, which is the row worth finding. */
export const runtimeTone = (state: string): Tone => {
  if (state === 'working') return 'ok'
  if (state === 'creating' || state === 'connecting' || state === 'replaying' || state === 'reconnecting') {
    return 'accent'
  }
  if (state === 'waiting' || state === 'cancelling' || state === 'stopped') return 'warn'
  if (state === 'failed') return 'danger'
  return 'muted'
}

/** The icon for a runtime state, beside the tone above, because the two are one decision: a shape
 *  and a colour saying the same thing. Host icon names (docs/ui-design.md § Icons), so both the
 *  sidebar's own markup and the dashboard panel's enum values draw from this one map. */
const RUNTIME_ICON: Record<string, string> = {
  creating: 'clock',
  connecting: 'clock',
  replaying: 'clock',
  ready: 'circle',
  working: 'loader-circle',
  waiting: 'circle-alert',
  cancelling: 'loader-circle',
  reconnecting: 'loader-circle',
  stopped: 'circle-stop',
  failed: 'triangle-alert',
  archived: 'archive',
}

export const runtimeIcon = (state: string): string => RUNTIME_ICON[state] ?? 'circle-dashed'

/* A tool call's dot lives elsewhere: its status is a protocol type the changes plugin also renders,
   so `agentToolTone` sits beside the renderer contract in client-core instead. */

/** A subagent's status, in its transcript card and its sidebar row. `idle` is settled rather than
 *  in flight: a Codex child rests resumable when it is done, and an accent mark on a resting subagent
 *  reads as stuck. The word for each status lives in subagentDisplay.ts. */
export const subagentTone = (status: AgentSubagentStatus | undefined): Tone => {
  if (status === 'running' || status === 'pending') return 'accent'
  if (status === 'completed') return 'ok'
  if (status === 'failed') return 'danger'
  return 'muted'
}

/** The shape beside that colour, the pair RUNTIME_ICON makes for a session. A subagent that is running
 *  gets the same turning loader as a session that is working, because a reader scanning the sidebar is
 *  asking one question of both kinds of row: is this thing moving? An idle subagent borrows `ready`'s
 *  circle for the same reason: it is resting, not finished. */
const SUBAGENT_ICON: Record<AgentSubagentStatus, string> = {
  pending: 'clock',
  running: 'loader-circle',
  idle: 'circle',
  completed: 'circle-check',
  failed: 'triangle-alert',
}

export const subagentIcon = (status: AgentSubagentStatus | undefined): string =>
  status ? SUBAGENT_ICON[status] : SUBAGENT_ICON.running

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
  if (health === 'critical') return 'danger'
  return 'muted'
}

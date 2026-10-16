import type { JSX } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { BridgeAgentSession } from '@acorn/protocol/extensionBridge.ts'
import { statusGuidance } from './guidance'

// How the panel draws a state: a coloured dot beside a word, never colour alone. Green means working
// or online, amber means waiting, red means failed, and an empty ring means idle. `active` is
// something still in flight: a pulsing accent dot, as the desktop draws it.
type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'active'

export function State(props: { tone: Tone; children: JSX.Element }) {
  return (
    <span class="state">
      <span class="dot" data-tone={props.tone} aria-hidden="true" />
      {props.children}
    </span>
  )
}

const AGENT_STATES: Record<string, { label: string; tone: Tone }> = {
  creating: { label: 'Starting', tone: 'ok' },
  connecting: { label: 'Starting', tone: 'ok' },
  replaying: { label: 'Starting', tone: 'ok' },
  ready: { label: 'Ready', tone: 'idle' },
  working: { label: 'Working', tone: 'ok' },
  waiting: { label: 'Waiting for you', tone: 'warn' },
  cancelling: { label: 'Stopping', tone: 'idle' },
  reconnecting: { label: 'Reconnecting', tone: 'warn' },
  stopped: { label: 'Stopped', tone: 'idle' },
  failed: { label: 'Failed', tone: 'bad' },
  archived: { label: 'Archived', tone: 'idle' },
}

// `waiting` is whether one of the Node's waiting requests is this conversation's, which says more
// than the runtime state: an agent can be working while a subagent waits on the person.
export function agentState(session: BridgeAgentSession, waiting: boolean): { label: string; tone: Tone } {
  if (waiting) return { label: 'Waiting for you', tone: 'warn' }
  return AGENT_STATES[session.runtimeState] ?? { label: session.runtimeState, tone: 'idle' }
}

// A tool call's mark, in the desktop's colours (agentToolTone in the agents plugin's contract).
type ToolMark = { icon: string; tone: 'ok' | 'accent' | 'danger' | 'muted' }
const TOOL_MARKS: Record<string, ToolMark> = {
  completed: { icon: 'circle-check', tone: 'ok' },
  running: { icon: 'loader-circle', tone: 'accent' },
  failed: { icon: 'circle-x', tone: 'danger' },
}
export const toolMark = (status: string | null): ToolMark =>
  TOOL_MARKS[status ?? ''] ?? { icon: 'circle', tone: 'muted' }

// The agent's name as the panel shows it, from the provider the conversation runs on.
export const agentName = (session: BridgeAgentSession) =>
  session.providerId.charAt(0).toUpperCase() + session.providerId.slice(1)

export function nodeState(status: NodeStatus | null): { label: string; tone: Tone } {
  const { label } = statusGuidance(status)
  if (!status) return { label, tone: 'idle' }
  if (status.error?.code === 'identity_mismatch') return { label, tone: 'bad' }
  if (status.state === 'online') return { label, tone: 'ok' }
  if (status.state === 'degraded') return { label, tone: 'warn' }
  return { label, tone: 'bad' }
}

import type { JSX } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { BridgeAgentSession } from '@acorn/protocol/extensionBridge.ts'
import { agentToolTone } from '@acorn/plugin-agents/contract/toolTone.ts'
import { statusGuidance } from './guidance'

// How the panel draws a state: a coloured dot beside a word, never colour alone. Green means running
// or online, amber means waiting, red means failed, and an empty ring means idle.
type Tone = 'ok' | 'warn' | 'bad' | 'idle'

export function State(props: { tone: Tone; children: JSX.Element }) {
  return (
    <span class="state">
      <span class="dot" data-tone={props.tone} aria-hidden="true" />
      {props.children}
    </span>
  )
}

const AGENT_STATES: Record<string, string> = {
  creating: 'Starting',
  connecting: 'Starting',
  replaying: 'Starting',
  ready: 'Ready',
  working: 'Working',
  waiting: 'Waiting for you',
  cancelling: 'Stopping',
  reconnecting: 'Reconnecting',
  stopped: 'Stopped',
  failed: 'Failed',
  archived: 'Archived',
}

// What a conversation's agent is doing, in words. `waiting` is whether one of the Node's waiting
// requests is this conversation's, which says more than the runtime state: an agent can be working
// while a subagent waits on the person.
export const agentState = (session: BridgeAgentSession, waiting: boolean): string =>
  waiting ? AGENT_STATES.waiting! : (AGENT_STATES[session.runtimeState] ?? session.runtimeState)

// A tool call's mark, in the desktop's colours.
const TOOL_ICONS: Record<string, string> = { completed: 'circle-check', running: 'loader-circle', failed: 'circle-x' }
export const toolMark = (status: string | null) => ({
  icon: TOOL_ICONS[status ?? ''] ?? 'circle',
  tone: agentToolTone(status),
})

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

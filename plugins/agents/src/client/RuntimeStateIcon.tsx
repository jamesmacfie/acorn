import { Icon } from '@acorn/plugin-api/ui'
import type { AgentSubagentStatus } from '@acorn/protocol/managedAgents.ts'
import { runtimeIcon, runtimeTone, subagentIcon, subagentTone } from './stateTone'
import './runtime-state-icon.css'

// The one place a managed session's runtime state becomes a mark: the rows in the task sidebar, the
// word in the pane header, the Agent Center roster. Shape and colour are the pair in stateTone.ts,
// which the sessions dashboard panel also reads, so a state looks the same on every surface.
export default function RuntimeStateIcon(props: { state: string }) {
  return (
    <span class="agent-state-icon" data-state={props.state} data-tone={runtimeTone(props.state)}>
      <Icon name={runtimeIcon(props.state)} />
    </span>
  )
}

// The same mark for a subagent, which has its own smaller vocabulary of statuses. Drawn here rather
// than as a dot, so a running child turns exactly like the session above it does.
export function SubagentStateIcon(props: { status: AgentSubagentStatus | undefined }) {
  return (
    <span
      class="agent-state-icon"
      data-state={props.status ?? 'running'}
      data-tone={subagentTone(props.status)}
    >
      <Icon name={subagentIcon(props.status)} />
    </span>
  )
}

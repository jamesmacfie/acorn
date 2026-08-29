import { Icon } from '@acorn/plugin-api/ui'
import type { AgentSubagentStatus } from '@acorn/protocol/managedAgents.ts'
import { runtimeIcon, runtimeTone, subagentIcon, subagentTone } from './stateTone'

// The one place a managed session's runtime state becomes a mark: the rows in the task sidebar, the
// word in the pane header, the Agent Center roster. Shape and colour are the pair in stateTone.ts,
// which the sessions dashboard panel also reads, so a state looks the same on every surface. The
// mark carries no title: every surface that draws it also writes the state out beside it, and a
// screen reader meeting both would read the state twice.
//
// Motion is the third thing the mark says: a state that is mid-flight turns, which is what a reader
// scanning the sidebar is actually asking about.
const SPINS = new Set(['working', 'cancelling', 'reconnecting'])

export default function RuntimeStateIcon(props: { state: string }) {
  return (
    <Icon
      name={runtimeIcon(props.state)}
      tone={runtimeTone(props.state)}
      spin={SPINS.has(props.state)}
    />
  )
}

// The same mark for a subagent, which has its own smaller vocabulary of statuses. Drawn here rather
// than as a dot, so a running child turns exactly like the session above it does.
export function SubagentStateIcon(props: { status: AgentSubagentStatus | undefined }) {
  const status = () => props.status ?? 'running'
  return (
    <Icon
      name={subagentIcon(props.status)}
      tone={subagentTone(props.status)}
      spin={status() === 'running'}
    />
  )
}

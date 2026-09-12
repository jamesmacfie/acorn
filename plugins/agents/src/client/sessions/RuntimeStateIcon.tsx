import { Show } from 'solid-js'
import { Icon } from '@acorn/plugin-api/ui'
import type { AgentSubagentStatus } from '@acorn/protocol/managedAgents.ts'
import { queuedMark, runtimeIcon, runtimeTone, subagentIcon, subagentTone } from './stateTone'

// The one place a managed session's runtime state becomes a mark: the rows in the task sidebar, the
// word in the pane header, the Agent Center roster. Shape and colour are the pair in stateTone.ts,
// which the sessions dashboard panel also reads, so a state looks the same on every surface. The
// mark carries no title: every surface that draws it also writes the state out beside it, and a
// screen reader meeting both would read the state twice.
//
// Motion is the third thing the mark says: a state that is mid-flight turns, which is what a reader
// scanning the sidebar is actually asking about.
const SPINS = new Set(['working', 'cancelling', 'reconnecting'])

export default function RuntimeStateIcon(props: { state: string; queued?: number }) {
  // A queued follow-up is not a runtime state: a session holds one while it works and while it rests.
  // It takes the slot only when nothing is in flight, because motion is what a reader scans a busy list
  // for and a still mark in a turning one's place costs more than the queue is worth saying here. The
  // case worth the slot is the other one: a session sitting at `ready` behind the concurrency limit
  // with a prompt it cannot send yet, which the resting mark would otherwise draw as simply done.
  //
  // Either way the state itself survives, because every surface that draws this mark also writes the
  // state out in words beside it. That is also why the queued mark carries a title and this one does
  // not: nothing else on the row says how many are waiting.
  const queued = () => (props.queued ?? 0) > 0 && !SPINS.has(props.state)
  return (
    <Show
      when={queued()}
      fallback={(
        <Icon
          name={runtimeIcon(props.state)}
          tone={runtimeTone(props.state)}
          spin={SPINS.has(props.state)}
        />
      )}
    >
      <Icon {...queuedMark(props.queued ?? 0)} />
    </Show>
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

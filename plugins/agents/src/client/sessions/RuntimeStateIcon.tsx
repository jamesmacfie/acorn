import { Show } from 'solid-js'
import { Icon } from '@acorn/plugin-api/ui'
import type { AgentSubagentStatus } from '../../contract/wire.ts'
import { runtimeIcon, runtimeTone } from '../../contract/runtimeState.ts'
import { queuedMark, subagentIcon, subagentTone } from './stateTone'

// The one place a managed session's runtime state becomes a mark: the rows in the task sidebar, the
// word in the pane header, the Agent Center roster. Shape and colour are `runtimeIcon` and
// `runtimeTone`, which the sessions dashboard panel also reads, so a state looks the same on every
// surface. The
// mark carries no title: every surface that draws it also writes the state out beside it, and a
// screen reader meeting both would read the state twice.
//
// Motion is the third thing the mark says: a state that is mid-flight turns, which is what a reader
// scanning the sidebar is actually asking about.
const SPINS = new Set(['working', 'cancelling', 'reconnecting'])

export default function RuntimeStateIcon(props: { state: string; queued?: number }) {
  // A queued follow-up is not a runtime state: a session holds one while it works and while it rests.
  // It takes the slot only when nothing is in flight, because motion is what a reader scans a busy list
  // for. The case worth the slot is a session resting at `ready` behind the concurrency limit with a
  // prompt it cannot send yet, which the resting mark would draw as simply done.
  //
  // The queued mark carries a title and the state mark does not: every surface writes the state out in
  // words beside the mark, but nothing else on the row says how many are waiting.
  const queued = () => (props.queued ?? 0) > 0 && !SPINS.has(props.state)
  return (
    <Show
      when={queued()}
      fallback={<Icon name={runtimeIcon(props.state)} tone={runtimeTone(props.state)} spin={SPINS.has(props.state)} />}
    >
      <Icon {...queuedMark(props.queued ?? 0)} />
    </Show>
  )
}

// The same mark for a subagent, which has its own smaller vocabulary of statuses. Drawn here rather
// than as a dot, so a running child turns exactly like the session above it does.
export function SubagentStateIcon(props: { status: AgentSubagentStatus | undefined }) {
  const status = () => props.status ?? 'running'
  return <Icon name={subagentIcon(props.status)} tone={subagentTone(props.status)} spin={status() === 'running'} />
}

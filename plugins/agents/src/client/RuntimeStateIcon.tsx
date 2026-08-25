import { Icon } from '@acorn/plugin-api/ui'
import { runtimeIcon, runtimeTone } from './stateTone'
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

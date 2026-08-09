import { Show } from 'solid-js'
import type { PluginSlotDescriptor } from '@acorn/protocol/api.ts'
import { activeNodeId } from '../../node/activeNode'
import { createFleetQuery } from '../../node/fanout'
import { Badge } from '../../ui/primitives'
import Icon from '../../ui/Icon'
import { runChromeAction } from './actions'
import { chromeKey, chromeRevision, readBadge } from './data'

// The generic slot badge. Small enough that the phase doc calls an iframe for it absurd, and — more to
// the point — it has to be live when no plugin frame is mounted anywhere, so its data comes from the
// plugin's node half rather than from plugin UI code.
//
// `null` from the route hides it entirely, which is how a badge with nothing to say disappears without
// the host needing a second route to ask whether to draw one. `docker-footer-badge` renders nothing
// when its summary is absent for the same reason; this is that pattern, generalised.

export type ChromeBadgeProps = { pluginId: string; descriptor: PluginSlotDescriptor }

export default function ChromeBadge(props: ChromeBadgeProps) {
  const nodeId = activeNodeId() ?? ''

  const [result] = createFleetQuery(
    () => chromeKey(props.pluginId, props.descriptor.id),
    (node, _revision, signal) => readBadge(props.pluginId, props.descriptor.data, node, signal),
    chromeRevision,
    { nodeIds: [nodeId] },
  )

  // Survives a disconnect as a stale read: the fan-out serves the node's last answer from its own
  // QueryClient rather than dropping the row, so the badge stops updating instead of vanishing.
  const badge = () => result().rows[0]?.data ?? null
  const click = (): void => {
    if (props.descriptor.onClick) runChromeAction(props.descriptor.onClick, { pluginId: props.pluginId, nodeId })
  }

  return (
    <Show when={badge()}>
      {(value) => (
        <button
          type="button"
          class="ui-btn"
          data-variant="ghost"
          data-size="xs"
          title={value().tooltip ?? props.descriptor.id}
          disabled={!props.descriptor.onClick}
          onClick={click}
        >
          <Show when={props.descriptor.icon}>{(name) => <Icon name={name()} />}</Show>
          <Badge tone={value().tone ?? 'neutral'}>{value().text}</Badge>
        </button>
      )}
    </Show>
  )
}

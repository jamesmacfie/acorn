import { Show } from 'solid-js'
import { Badge } from '../../ui/primitives'
import { brandMarkRegistry } from '../../ui/brandMarks'
import Icon from '../../ui/Icon'

// Which source a row came from, on a panel that unions more than one collection
// (docs/dashboards.md § The mapping layer, and cross-source panels). The brand mark and its text
// fallback for an unmatched name are docs/ui-design.md § Icons.

export default function Provenance(props: { pluginId: string }) {
  const mark = () => brandMarkRegistry.get(props.pluginId)
  return (
    <Show
      when={mark()}
      fallback={<Badge size="xs" class="dash-provenance">{props.pluginId}</Badge>}
    >
      <Icon class="dash-provenance" name={`brand:${props.pluginId}`} title={props.pluginId} />
    </Show>
  )
}

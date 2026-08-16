import { Show } from 'solid-js'
import { Badge } from '../../ui/primitives'
import { brandMarkRegistry } from '../../ui/brandMarks'
import Icon from '../../ui/Icon'

// WHICH SOURCE THIS ROW CAME FROM, on a panel that unions more than one
// (docs/dashboards.md § The mapping layer, and cross-source panels).
//
// Drawn from the HOST'S STAMP — `row.pluginId`, bound when the response was parsed and never read off
// the response body (plugins/chrome/data.ts § readCollection). That is the whole point of the stamp:
// the badge and the row's click action resolve to the same plugin, so no collection can put its rows
// on a board wearing another plugin's identity.
//
// The mark is the SAME machinery the rail uses for plugin identity — `brand:<pluginId>`, registered
// by the descriptor pass from the manifest's `icon` (plugins/chrome/register.ts) or by core for its
// own (ui/brandMarks.ts). There is deliberately no second path: a plugin that ships a logo gets it
// here for free, and one that does not gets its name rather than a generic puzzle piece.
//
// The fallback is not a nicety. `Icon`'s own fallback renders an unmatched name as TEXT, so naming
// `brand:whatever` blind would print the literal string `brand:whatever` onto a card.

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

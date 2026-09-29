import { For } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsOptions, prefsOptions } from '../../infra/queries'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { availableSources } from '../tabs/railSources'
import { parseRailVisibility, pluginSources, setShownInRail, shownInRail } from '../tabs/railVisibility'
import { Checkbox } from '../../kit/components/primitives'

// The "Show in left rail" switches for one plugin's sources, drawn by the host (features/tabs/railVisibility.ts).
//
// Two places draw this, Settings > Plugins and the top of a plugin page that declared
// `railSourceVisibility`, and both read and write the one preference, so they cannot disagree. It sits
// outside any frame or remote tree: the plugin names which of its sources get a switch and never
// touches the value.
//
// Ownership is the live registry's answer rather than the declaration's. `pluginSources(pluginId)`
// only returns sources that plugin registered, so a page naming somebody else's source draws nothing.
export default function RailVisibilitySwitches(props: { pluginId: string; sourceIds?: readonly string[] }) {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const integrations = createQuery(() => integrationsOptions(true))
  const rows = () => pluginSources(props.pluginId)
    .filter(({ source }) => !props.sourceIds || props.sourceIds.includes(source.id))
  // The provider gate only. The workspace-link gate needs a workspace, and Settings is not showing one.
  const openable = () => new Set(availableSources(integrations.data?.integrations).map((source) => source.id))
  const visibility = () => parseRailVisibility(prefs.data?.[PrefKeys.railVisibility])

  return (
    <For each={rows()}>
      {({ source }) => (
        <Checkbox
          switch
          label={rows().length > 1 ? `Show ${source.label} in left rail` : 'Show in left rail'}
          hint={integrations.data && !openable().has(source.id)
            ? 'Not available right now. The icon appears when it is.'
            : undefined}
          checked={shownInRail(source.id, visibility())}
          onChange={(checked) => void setShownInRail(qc, props.pluginId, source.id, checked)}
        />
      )}
    </For>
  )
}

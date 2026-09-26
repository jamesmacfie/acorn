import { For, Show } from 'solid-js'
import type { PluginInstallSource } from '@acorn/protocol/api.ts'
import { describePluginSource } from '@acorn/protocol/plugin/source.ts'
import { configPluginOffers } from '../../infra/persistence/deviceConfigSync'
import { devicePlugins } from '../../host/plugins/distribution'
import { Button } from '../../kit/components/primitives'

export default function ConfigPluginOffers(props: {
  busy: boolean
  onInstall: (id: string, source: PluginInstallSource) => void
}) {
  const offers = () => configPluginOffers(new Set(devicePlugins().map((plugin) => plugin.row.name)))
  return (
    <Show when={offers().length}>
      <p class="muted">acorn.json requests these plugins. Installing each one still asks for trust.</p>
      <ul class="plugin-list">
        <For each={offers()}>{(offer) => <li class="plugin-row">
          <span class="plugin-name">{offer.id}</span>
          <span class="plugin-source muted">{describePluginSource(offer.source)}</span>
          <Button size="sm" disabled={props.busy} onPress={() => props.onInstall(offer.id, offer.source)}>Install</Button>
        </li>}</For>
      </ul>
    </Show>
  )
}

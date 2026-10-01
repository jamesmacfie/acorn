import { For, Show } from 'solid-js'
import type { PluginInstallSource } from '@acorn/protocol/api.ts'
import { describePluginSource } from '@acorn/protocol/plugin/source.ts'
import { configPluginOffers } from '../../../infra/persistence/deviceConfigSync'
import { devicePlugins } from '../../../host/plugins/distribution'
import { Badge, Button } from '../../../kit/components/primitives'
import { Inline } from '../../../kit/components/layout/Inline'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'

// The plugins this device's acorn.json asks for and this device does not hold yet, each a row with its
// source and an Install.
export default function ConfigPluginOffers(props: {
  busy: boolean
  onInstall: (id: string, source: PluginInstallSource) => void
}) {
  const offers = () => configPluginOffers(new Set(devicePlugins().map((plugin) => plugin.row.name)))
  return (
    <Show when={offers().length}>
      <SettingsSection
        id="config-offers"
        label="Asked for by acorn.json"
        description="This computer's acorn.json asks for these plugins. Each one asks for your approval when you install it."
      >
        <For each={offers()}>
          {(offer) => (
            <SettingRow label={offer.id} description={describePluginSource(offer.source)}>
              <Inline>
                <Badge>Not installed</Badge>
                <Button size="sm" variant="ghost" label={`Install ${offer.id}`} disabled={props.busy} onPress={() => props.onInstall(offer.id, offer.source)}>Install</Button>
              </Inline>
            </SettingRow>
          )}
        </For>
      </SettingsSection>
    </Show>
  )
}

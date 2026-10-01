import { For, Show } from 'solid-js'
import { connectionName } from '@acorn/protocol/integrations.ts'
import type { SettingsPageContext } from '../../../host/registries/shell/settings'
import { Badge, Button, EmptyState } from '../../../kit/components/primitives'
import Icon from '../../../kit/components/content/Icon'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { ConnectionsPage } from './ConnectionsPage'
import { connectionRowText, connectionStatusLabel, connectionTone, SERVICES_PAGE } from './connections'

// Settings > Connections > Services: every connection on this node except the model keys, which AI
// models lists (./connections.ts). A connection that needs its owner is listed first, and the rail draws
// a dot beside this page for it (./connectionAttention.ts).

export default function ServicesSettings(props: { context: SettingsPageContext }) {
  return (
    <ConnectionsPage page={SERVICES_PAGE} label="Services" navigate={props.context.navigate}>
      {(list) => (
        <>
          <SettingsSection
            id="connections"
            label="Connections"
            help="Services acorn reads issues, errors, and pull requests from, such as GitHub, Linear, and Rollbar."
            actions={<Button size="sm" onPress={list.openAdd}><Icon name="plus" /> Add connection</Button>}
          >
            <For
              each={list.connections()}
              fallback={<Show when={!list.failed()}><EmptyState align="start" size="sm" busy={list.pending()}>{list.pending() ? 'Reading connections…' : 'Nothing connected. Add a connection to see its issues and errors in the rail.'}</EmptyState></Show>}
            >
              {(connection) => {
                const provider = () => list.providerOf(connection)
                return (
                  <SettingRow
                    label={connectionName(connection)}
                    description={connectionRowText(connection, provider())}
                  >
                    <Badge tone={connectionTone(connection)}>{connectionStatusLabel(connection)}</Badge>
                    <Button size="sm" variant="ghost" label={`Manage ${connectionName(connection)}`} onPress={() => list.openConnection(connection)}>Manage</Button>
                  </SettingRow>
                )
              }}
            </For>
          </SettingsSection>
        </>
      )}
    </ConnectionsPage>
  )
}

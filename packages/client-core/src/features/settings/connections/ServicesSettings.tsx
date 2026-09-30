import { For, Show } from 'solid-js'
import { connectionName } from '@acorn/protocol/integrations.ts'
import type { SettingsPageContext } from '../../../host/registries/shell/settings'
import { Button, EmptyState, StatusDot } from '../../../kit/components/primitives'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { ConnectionsPage } from './ConnectionsPage'
import { AI_MODELS_PAGE, connectionRowText, connectionStatusLabel, connectionTone, SERVICES_PAGE } from './connections'

// Settings > Connections > Services: every connection on this node except the model keys, which AI
// models lists (./connections.ts). A connection that needs its owner is listed first with a dot, the
// same dot the rail draws beside this page (./connectionAttention.ts).

export default function ServicesSettings(props: { context: SettingsPageContext }) {
  return (
    <ConnectionsPage page={SERVICES_PAGE} label="Services" navigate={props.context.navigate}>
      {(list) => (
        <>
          <SettingsSection
            id="connections"
            label="Connections"
            description="The services acorn reads issues, errors, and pull requests from."
            actions={<Button size="sm" onPress={list.openAdd}>Add connection</Button>}
          >
            <For
              each={list.connections()}
              fallback={<Show when={!list.failed()}><EmptyState align="start">{list.pending() ? 'Reading connections…' : 'Nothing connected yet. Add a connection to see its items in the rail.'}</EmptyState></Show>}
            >
              {(connection) => {
                const provider = () => list.providerOf(connection)
                return (
                  <SettingRow
                    label={connectionName(connection)}
                    description={connectionRowText(connection, provider())}
                  >
                    <StatusDot tone={connectionTone(connection)} label={connectionStatusLabel(connection)} />
                    <Button size="sm" variant="ghost" label={`Manage ${connectionName(connection)}`} onPress={() => list.openConnection(connection)}>Manage</Button>
                  </SettingRow>
                )
              }}
            </For>
          </SettingsSection>
          <SettingsSection id="models" label="AI models">
            <SettingRow label="Keys for generating text" description="Anthropic and OpenAI keys are on AI models, beside the agent CLIs this machine has.">
              <Button size="sm" variant="ghost" onPress={() => props.context.navigate(AI_MODELS_PAGE)}>Open AI models</Button>
            </SettingRow>
          </SettingsSection>
        </>
      )}
    </ConnectionsPage>
  )
}

import { For, Index, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { connectionName } from '@acorn/protocol/integrations.ts'
import { modelBackendsOptions } from '../../../infra/queries'
import type { SettingsPageContext } from '../../../host/registries/shell/settings'
import { Badge, Button, EmptyState } from '../../../kit/components/primitives'
import Icon from '../../../kit/components/content/Icon'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { ConnectionsPage } from '../connections/ConnectionsPage'
import { AI_MODELS_PAGE, connectionRowText, connectionStatusLabel, connectionTone } from '../connections/connections'

// Settings > Connections > AI models: model keys and installed agent CLIs
// (docs/integrations/model-providers.md § Model providers).
//
// The keys are connections, so each one opens the same connection page Services draws. The agent CLIs
// come from the backends route rather than being counted off the connections, because whether a CLI is
// on PATH is a question only the node can ask, and it asks it per read, so a CLI installed while acorn
// is open shows up on the next look.
//
// No switches on the backends. A backend the owner does not want is one they do not pick, and keys
// come first in the list, so every silent path keeps spending a key the owner configured on purpose.

export default function AiModelsSettings(props: { context: SettingsPageContext }) {
  const status = createQuery(() => modelBackendsOptions(true))
  const backends = () => status.data?.backends ?? []
  const harnesses = () => backends().filter((backend) => backend.kind === 'harness')
  // Every harness that offered a one-shot mode and is not installed here. A row that says so, not an
  // error: nothing is broken, a program is simply not on this machine.
  const missing = () => status.data?.missing ?? []

  return (
    <ConnectionsPage page={AI_MODELS_PAGE} label="AI models" navigate={props.context.navigate}>
      {(list) => (
        <>
          <SettingsSection id="keys" label="API keys" actions={<Button size="sm" onPress={list.openAdd}><Icon name="plus" /> Add a key</Button>}>
            <For
              each={list.connections()}
              fallback={<Show when={!list.failed()}><EmptyState align="start" size="sm" busy={list.pending()}>{list.pending() ? 'Reading keys…' : 'No API keys. Add one from Anthropic or OpenAI.'}</EmptyState></Show>}
            >
              {(connection) => (
                <SettingRow
                  label={connectionName(connection)}
                  description={connectionRowText(connection, list.providerOf(connection))}
                >
                  <Badge tone={connectionTone(connection)}>{connectionStatusLabel(connection)}</Badge>
                  <Button size="sm" variant="ghost" label={`Manage ${connectionName(connection)}`} onPress={() => list.openConnection(connection)}>Manage</Button>
                </SettingRow>
              )}
            </For>
          </SettingsSection>

          <SettingsSection id="clis" label="Agent CLIs" help="Command-line agents on this computer, such as Claude Code. Each one uses its own sign-in.">
            <Show when={harnesses().length || missing().length} fallback={<EmptyState align="start" size="sm" busy={status.isPending}>{status.isError ? "Couldn't ask this node which agent CLIs it has." : status.isPending ? 'Looking for agent CLIs…' : 'No agent CLIs found on this computer.'}</EmptyState>}>
              {/* `Index` rather than `For`: the route refetches on a short stale time, so every row would
                  be a new object each time. */}
              <Index each={harnesses()}>
                {(harness) => <SettingRow label={harness().label}><Badge tone="ok">Installed</Badge></SettingRow>}
              </Index>
              <Index each={missing()}>
                {(harness) => <SettingRow label={harness().label}><Badge>Not installed</Badge></SettingRow>}
              </Index>
            </Show>
          </SettingsSection>
        </>
      )}
    </ConnectionsPage>
  )
}

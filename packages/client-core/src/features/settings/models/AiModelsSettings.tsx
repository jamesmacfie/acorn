import { createMemo, For, Index, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { connectionName } from '@acorn/protocol/integrations.ts'
import { modelBackendsOptions, prefsOptions } from '../../../infra/queries'
import type { SettingsPageContext } from '../../../host/registries/shell/settings'
import { Badge, Button, EmptyState } from '../../../kit/components/primitives'
import Icon from '../../../kit/components/content/Icon'
import { Text } from '../../../kit/components/content/Text'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { createSettingSave } from '../settingSave'
import { ConnectionsPage } from '../connections/ConnectionsPage'
import { AI_MODELS_PAGE, connectionRowText, connectionStatusLabel, connectionTone } from '../connections/connections'
import ModelBackendPicker from './ModelBackendPicker'
import { effectiveModelPick, readGeneratePick, saveGeneratePick } from './generatePick'

// Settings > Connections > AI models: what this owner can generate text with, and which of it a
// Generate control reaches for by default (docs/integrations.md § Model providers).
//
// The keys are connections, so each one opens the same connection page Services draws. The agent CLIs
// come from the backends route rather than being counted off the connections, because whether a CLI is
// on PATH is a question only the node can ask, and it asks it per read, so a CLI installed while acorn
// is open shows up on the next look.
//
// Generate with is this device's, on a node page, so its row carries its own chip (./generatePick.ts
// says why the pick is the device's).
//
// No switches on the backends. A backend the owner does not want is one they do not pick, and keys
// come first in the list, so every silent path keeps spending a key the owner configured on purpose.

export default function AiModelsSettings(props: { context: SettingsPageContext }) {
  const qc = useQueryClient()
  const status = createQuery(() => modelBackendsOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const backends = () => status.data?.backends ?? []
  // A memo, not a getter: the picker reads both halves of it, and a getter would redo the resolution
  // on every unrelated prefs tick.
  const pick = createMemo(() => effectiveModelPick(backends(), readGeneratePick(prefs.data)))
  const harnesses = () => backends().filter((backend) => backend.kind === 'harness')
  // Every harness that offered a one-shot mode and is not installed here. A row that says so, not an
  // error: nothing is broken, a program is simply not on this machine.
  const missing = () => status.data?.missing ?? []
  // The picker's selects are their own sign that a pick landed, so the row shows only a failure.
  const save = createSettingSave()

  return (
    <ConnectionsPage page={AI_MODELS_PAGE} label="AI models" navigate={props.context.navigate}>
      {(list) => (
        <>
          <SettingsSection
            id="generate"
            label="Generating text"
            help="acorn writes commit messages, SQL, and workflow drafts with the model you pick. An API key is billed to that key. An agent CLI uses its own sign-in."
          >
            {/* Stacked when there are two selects, which do not fit the control column side by side. */}
            <SettingRow label="Generate with" scope="device" layout={backends().length > 1 ? 'stacked' : 'inline'} error={save.error()}>
              {/* The one place the default is changed outside a dialog. The picker hides its backend
                  select when there is a single choice: there is no choice to make, and the model select
                  beside it still is one. */}
              <Show when={backends().length} fallback={<Text emphasis="muted">{status.isError ? "Couldn't ask this node what it can generate with." : status.isPending ? 'Reading what this node can generate with…' : 'Nothing to generate with. Add a key, or install an agent CLI.'}</Text>}>
                <ModelBackendPicker
                  backends={backends()}
                  backendId={pick()?.backendId ?? ''}
                  modelId={pick()?.modelId ?? ''}
                  onChange={(next) => void save.run(() => saveGeneratePick(qc, next))}
                />
              </Show>
            </SettingRow>
          </SettingsSection>

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

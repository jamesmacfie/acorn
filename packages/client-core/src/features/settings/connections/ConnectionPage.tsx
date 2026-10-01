import { createSignal, For, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import type { Integration } from '@acorn/protocol/api.ts'
import type { PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'
import { connectionName, MAX_CONNECTION_NAME } from '@acorn/protocol/integrations.ts'
import { integrationsKey } from '../../../infra/queries'
import { ApiError } from '../../../infra/node/apiClient'
import { deleteIntegration, renameIntegration, setIntegrationDisabled, testIntegration } from '../../integrations/integrationClient'
import { createCredentialForm } from '../../integrations/credentialForm'
import { confirmAction } from '../../../host/registries/shell/willPhase'
import { Alert, Button, Checkbox, Input } from '../../../kit/components/primitives'
import { Inline } from '../../../kit/components/layout/Inline'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { Text } from '../../../kit/components/content/Text'
import ConnectionProjectMap from '../ConnectionProjectMap'
import { useSettingsDetail } from '../settingsDetail'
import { createSettingSave, createTextSetting } from '../settingSave'
import { useUnsavedChanges } from '../unsavedChanges'
import { connectionStatusText } from './connections'

// One connection's page, a detail of Services or AI models (docs/integrations.md § Settings). What is
// wrong with it comes first, with the button that fixes it, then its name and switch, where its projects
// show up, and disconnecting it in the danger zone.
//
// Replacing the key is a form: the fields only work together, so it has Save and Cancel, and anything
// typed into it counts as unsaved. A device-flow provider such as GitHub has no key to replace, because
// the owner never holds its token, and the node refuses a second connection to a provider at its limit.
// So the honest fix there is to disconnect and connect again, and the page says so.

export type ConnectionPageProps = {
  connection: Integration
  provider: PublicIntegrationProvider | undefined
  /** The list this page was opened from, for the back link drawn outside settings. */
  listLabel: string
  onBack: () => void
}

export function ConnectionPage(props: ConnectionPageProps) {
  const qc = useQueryClient()
  const hostDrawsBack = useSettingsDetail(() => connectionName(props.connection), props.onBack)
  const refresh = () => qc.invalidateQueries({ queryKey: integrationsKey })
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [replacing, setReplacing] = createSignal(false)

  const manageable = () => props.provider?.connection.disconnectable === true
  const deviceFlow = () => props.provider?.connection.kind === 'device-flow'

  const run = async (work: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await work()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const form = createCredentialForm(() => props.provider, async () => {
    setReplacing(false)
    await refresh()
  }, () => props.connection.id)
  useUnsavedChanges(() => replacing() && form.fields().some((field) => !!form.value(field.id).trim()))
  const startReplacing = () => {
    form.reset()
    setReplacing(true)
  }
  const cancelReplacing = () => {
    form.reset()
    setReplacing(false)
  }

  // An empty box means "go back to what the provider calls it", so it clears the name rather than being
  // refused. That is also why the box holds the name and not the fallback label: typing over a
  // pre-filled "Linear · Acme" would store the label as a name and freeze it against a later rotate.
  const name = createTextSetting({
    value: () => props.connection.name ?? '',
    save: async (value) => {
      await renameIntegration(props.connection.id, value.trim() || null)
      await refresh()
    },
  })

  const enabled = createSettingSave()
  const setEnabled = (on: boolean) => enabled.run(async () => {
    await setIntegrationDisabled(props.connection.id, !on)
    await refresh()
  })

  // A failed test changes the connection's status, which the banner above already explains, so the
  // error line only says the test failed and keeps the node's code for the log.
  const test = () => run(async () => {
    try {
      await testIntegration(props.connection.id)
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : undefined
      throw new Error(code ? `The test did not pass. (${code})` : 'The test did not pass.')
    } finally {
      await refresh()
    }
  })

  // Disconnecting runs the node's cascade (server/db/cascade.ts), so the confirmation names what that
  // takes with it.
  const disconnect = async () => {
    const confirmed = await confirmAction({
      title: `Disconnect ${connectionName(props.connection)}`,
      actionLabel: 'Disconnect',
      goes: 'acorn deletes its stored credentials, its project links, the issues it cached, and the links from tasks to those issues.',
      stays: 'Your tasks and worktrees stay, and so does the account at the provider.',
      danger: true,
    })
    if (!confirmed) return
    await run(async () => {
      await deleteIntegration(props.connection.id)
      props.onBack()
      await refresh()
    })
  }

  const fix = () => {
    switch (props.connection.status) {
      case 'needs-auth':
        return deviceFlow()
          ? <Button size="sm" tone="danger" disabled={busy()} onPress={() => void disconnect()}>Disconnect…</Button>
          : <Button size="sm" disabled={busy() || replacing()} onPress={startReplacing}>Replace key</Button>
      case 'disabled':
        return <Button size="sm" disabled={busy()} onPress={() => void setEnabled(true)}>Turn on</Button>
      case 'degraded':
        return <Button size="sm" disabled={busy()} onPress={() => void test()}>Test</Button>
      default:
        return undefined
    }
  }

  return (
    <>
      <Show when={!hostDrawsBack}>
        <Inline><Button variant="bare" size="sm" onPress={props.onBack}>‹ {props.listLabel}</Button></Inline>
      </Show>

      {/* The problem and its fix first, above everything else on the page. */}
      <Show when={props.connection.status !== 'connected'}>
        <Alert tone={props.connection.status === 'needs-auth' ? 'warn' : 'muted'} variant="banner" actions={manageable() ? fix() : undefined}>
          {connectionStatusText(props.connection, props.provider)}
          {props.connection.status === 'needs-auth' && deviceFlow() ? ' Disconnect it, then connect it again from Add connection.' : ''}
        </Alert>
      </Show>
      <Show when={error()}><Alert>{error()}</Alert></Show>

      <Show when={replacing()}>
        <SettingsSection id="credential" label={props.provider ? `New ${props.provider.label} credentials` : 'New credentials'} description="acorn checks them with the provider before it keeps them.">
          <For each={form.fields()}>
            {(field) => (
              <SettingRow label={field.label} description={field.hint} layout="stacked">
                <Input
                  label={field.label}
                  type={field.type}
                  assist={false}
                  placeholder={field.placeholder}
                  value={form.value(field.id)}
                  onInput={(value) => form.setValue(field.id, value)}
                  onSubmit={() => void form.submit()}
                />
              </SettingRow>
            )}
          </For>
          <Show when={form.error()}><Alert>{form.error()}</Alert></Show>
          <Inline>
            <Button onPress={() => void form.submit()} disabled={form.busy() || !form.complete()}>{form.busy() ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" onPress={cancelReplacing} disabled={form.busy()}>Cancel</Button>
          </Inline>
        </SettingsSection>
      </Show>

      <SettingsSection
        id="connection"
        label="Connection"
        description={`${props.provider?.label ?? props.connection.providerId}${props.connection.account?.label ? ` · ${props.connection.account.label}` : ''}`}
      >
        <Show when={manageable()} fallback={<Text emphasis="muted">acorn manages this connection itself.</Text>}>
          <SettingRow label="Name" description="Leave it empty to use the provider's name." savedAt={name.savedAt()} error={name.error()}>
            <Input
              label="Name"
              value={name.value()}
              placeholder={props.connection.label}
              maxLength={MAX_CONNECTION_NAME}
              onInput={name.input}
              onChange={(value) => void name.commit(value)}
            />
          </SettingRow>
          <SettingRow
            label="Credentials"
            description={props.connection.status === 'connected'
              ? 'Connected. Test asks the provider whether they still work.'
              : 'Test asks the provider whether they still work.'}
          >
            <Inline>
              <Button size="sm" variant="ghost" disabled={busy()} onPress={() => void test()}>Test</Button>
              <Show when={!deviceFlow()}>
                <Button size="sm" variant="ghost" disabled={busy() || replacing()} onPress={startReplacing}>Replace key</Button>
              </Show>
            </Inline>
          </SettingRow>
          <SettingRow label="On" description="Turning it off pauses it. Its project links stay." error={enabled.error()}>
            <Checkbox switch ariaLabel={`Turn ${connectionName(props.connection)} on`} checked={props.connection.status !== 'disabled'} disabled={busy()} onChange={setEnabled} />
          </SettingRow>
        </Show>
      </SettingsSection>

      {/* Only a provider that enumerates projects has a map to draw. A connection that is off keeps its
          map visible and editable: turning it off is a pause, not an unlink. */}
      <Show when={props.provider?.supportsProjects}>
        <SettingsSection id="where" label="Where it shows up">
          <ConnectionProjectMap connection={props.connection} />
        </SettingsSection>
      </Show>

      <Show when={manageable()}>
        <SettingsSection id="danger" label="Danger zone" tone="danger">
          <SettingRow label="Disconnect" description="Deletes its stored credentials and its project links.">
            <Button tone="danger" disabled={busy()} onPress={() => void disconnect()}>Disconnect…</Button>
          </SettingRow>
        </SettingsSection>
      </Show>
    </>
  )
}

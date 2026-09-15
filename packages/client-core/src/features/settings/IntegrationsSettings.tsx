import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'
import { connectionName, MAX_CONNECTION_NAME } from '@acorn/protocol/integrations.ts'
import CopyButton from '../../kit/components/inputs/CopyButton'
import Icon from '../../kit/components/content/Icon'
import { brandStyle } from '../../kit/tokens/brandMarks'
import {
  deleteIntegration,
  renameIntegration,
  setIntegrationDisabled,
  testIntegration,
} from '../integrations/integrationClient'
import { createCredentialForm } from '../integrations/credentialForm'
import { createDeviceFlow } from '../integrations/deviceFlow'
import { integrationsKey, integrationsOptions } from '../../infra/queries'
import ConnectionProjectMap from './ConnectionProjectMap'
import GenerateSettings from './models/GenerateSettings'
import { Alert, Button, Chip } from '../../kit/components/primitives'

function IntegrationLogo(props: { provider: PublicIntegrationProvider | undefined }) {
  // The tint comes off the mark the provider names, not off a rule keyed to its id, so a plugin that
  // ships a mark ships the colour with it.
  const glyph = () => props.provider?.glyph ?? props.provider?.label[0] ?? '?'
  return (
    <span class="integration-logo" style={brandStyle(glyph())}>
      <span class="integration-logo-mono"><Icon name={glyph()} /></span>
    </span>
  )
}

export default function IntegrationsSettings() {
  const qc = useQueryClient()
  const status = createQuery(() => integrationsOptions(true))
  const providers = () => status.data?.providers ?? []
  const integrations = () => status.data?.integrations ?? []
  const byId = createMemo(() => new Map(providers().map((provider) => [provider.id, provider])))
  const connectionCount = (providerId: string) =>
    integrations().filter((connection) => connection.providerId === providerId).length
  const connectable = () => providers().filter((provider) =>
    provider.connection.connectable &&
    (provider.connection.maxConnections === undefined ||
      connectionCount(provider.id) < provider.connection.maxConnections),
  )

  const [adding, setAdding] = createSignal(false)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [draftName, setDraftName] = createSignal('')
  const [rotationId, setRotationId] = createSignal<string | null>(null)
  const [providerId, setProviderId] = createSignal('')
  const selectedProvider = () => byId().get(providerId()) ?? connectable()[0]
  const [busy, setBusy] = createSignal(false)

  // --- Device authorization grant (RFC 8628), for a provider whose descriptor says `kind:
  // 'device-flow'`. Currently only GitHub, and one branch here rather than a page of its own: this
  // component is already descriptor-driven, so "how the credential is obtained" is one more thing the
  // descriptor answers. The pacing itself lives in ../integrations/deviceFlow.ts because first-run
  // onboarding runs the same grant.
  const deviceFlow = createDeviceFlow(() => selectedProvider()?.id, async () => {
    setAdding(false)
    await refresh()
  })

  const refresh = () => qc.invalidateQueries({ queryKey: integrationsKey })

  // The fields, the completeness rule, the write and the error copy live in
  // ../integrations/credentialForm.ts, because first-run onboarding adds a key too and the parts worth
  // getting right are not the inputs. What stays here is the chrome around it: which provider is
  // selected, whether this is an addition or a rotation, and closing the panel afterwards.
  const form = createCredentialForm(selectedProvider, async () => {
    setRotationId(null)
    setAdding(false)
    await refresh()
  }, rotationId)

  const disconnect = async (id: string) => {
    setBusy(true)
    try {
      await deleteIntegration(id)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const test = async (id: string) => {
    setBusy(true)
    try {
      await testIntegration(id)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  // An empty box means "go back to what the provider calls it", so it clears the name rather than
  // being refused. That is also why the box opens holding the name and not the fallback label: typing
  // over a pre-filled "Linear · Acme" would store the label as a name and freeze it against a later
  // rotate.
  const rename = async (id: string) => {
    setBusy(true)
    try {
      await renameIntegration(id, draftName().trim() || null)
      setRenamingId(null)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const startRename = (connection: { id: string; name?: string }) => {
    setDraftName(connection.name ?? '')
    setRenamingId(connection.id)
  }

  const setDisabled = async (id: string, disabled: boolean) => {
    setBusy(true)
    try {
      await setIntegrationDisabled(id, disabled)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="integrations">
      <div class="integrations-list">
        <For each={integrations()}>
          {(connection) => {
            const provider = () => byId().get(connection.providerId)
            return (
              <div class="integration-entry">
              <div class="integration-card">
                <IntegrationLogo provider={provider()} />
                {/* Name and details on top, the buttons on their own row underneath: five actions on the
                    same line as the name squeezed both, and the name is what the row is about. */}
                <div class="integration-body">
                  <div class="integration-head">
                    <div class="integration-meta">
                      <Show
                        when={renamingId() === connection.id}
                        fallback={<span class="integration-title">{connectionName(connection)}</span>}
                      >
                        <div class="integration-rename-row">
                          {/* Focus on the next microtask, not through `autofocus`: the input is created
                              inside a Show that swaps it in after this row already exists. */}
                          <input
                            class="ui-input"
                            value={draftName()}
                            placeholder={connection.label}
                            maxlength={MAX_CONNECTION_NAME}
                            ref={(el) => queueMicrotask(() => el.focus())}
                            onInput={(event) => setDraftName(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void rename(connection.id)
                              if (event.key === 'Escape') setRenamingId(null)
                            }}
                          />
                          <Button variant="ghost" onPress={() => void rename(connection.id)} disabled={busy()}>Save</Button>
                          <Button variant="ghost" onPress={() => setRenamingId(null)} disabled={busy()}>Cancel</Button>
                        </div>
                      </Show>
                      <span class="integration-sub">
                        {provider()?.label ?? connection.providerId}
                        {connection.account?.label ? ` · ${connection.account.label}` : ''}
                        {connection.status !== 'connected' ? ` · ${connection.status}` : ''}
                      </span>
                    </div>
                  </div>
                  <div class="integration-actions">
                    <Show when={provider()?.connection.disconnectable} fallback={<span class="integration-badge">Connected</span>}>
                      <Button variant="ghost" onPress={() => startRename(connection)} disabled={busy()}>Rename</Button>
                      <Button variant="ghost" onPress={() => void test(connection.id)} disabled={busy()}>Test</Button>
                      {/* Rotation means "submit a new credential for this connection", which a device flow
                          has no shape for — the owner never holds the token. Disconnect and connect again
                          is the honest path, so the button is simply absent. */}
                      <Show when={provider()?.connection.kind !== 'device-flow'}>
                        <Button variant="ghost" onPress={() => { setProviderId(connection.providerId); setRotationId(connection.id); form.reset(); setAdding(true) }} disabled={busy()}>Rotate</Button>
                      </Show>
                      <Button variant="ghost" onPress={() => void setDisabled(connection.id, connection.status !== 'disabled')} disabled={busy()}>
                        {connection.status === 'disabled' ? 'Enable' : 'Disable'}
                      </Button>
                      <Button variant="ghost" tone="danger" onPress={() => void disconnect(connection.id)} disabled={busy()}>Disconnect</Button>
                    </Show>
                  </div>
                </div>
              </div>
              {/* Only a provider that enumerates projects has a map to draw. A disabled connection
                  keeps its map visible and editable: turning it off is a pause, not an unlink. */}
              <Show when={provider()?.supportsProjects}>
                <ConnectionProjectMap connection={connection} />
              </Show>
              </div>
            )
          }}
        </For>
      </div>

      {/* Between the connections and the form that adds one: what is here to generate with reads as a
          summary of the list above, and an installed agent CLI is a row in it that no credential form
          could have produced. */}
      <GenerateSettings />

      <Button onPress={() => setAdding((value) => !value)}>
        <span class="integration-add-icon">+</span> Add or rotate integration
      </Button>

      <div class="integration-add-panel" classList={{ open: adding() }}>
        <div class="integration-add-inner">
          <div class="integration-provider-chips">
            <For each={connectable()}>
              {(provider) => (
                <Chip
                  leading={<span class="integration-logo-mono"><Icon name={provider.glyph} /></span>}
                  onPress={() => { setProviderId(provider.id); setRotationId(null); form.reset() }}
                >
                  {provider.label}
                </Chip>
              )}
            </For>
          </div>
          <Show
            when={selectedProvider()?.connection.kind === 'device-flow'}
            fallback={
              <>
                <For each={form.fields()}>
                  {(field) => (
                    <label class="integration-add-label">
                      {field.label}
                      <div class="integration-key-row">
                        <input
                          class="ui-input"
                          type={field.type}
                          placeholder={field.placeholder}
                          value={form.value(field.id)}
                          onInput={(event) => form.setValue(field.id, event.currentTarget.value)}
                          onKeyDown={(event) => event.key === 'Enter' && void form.submit()}
                        />
                      </div>
                      <Show when={field.hint}><p class="integration-add-hint muted">{field.hint}</p></Show>
                    </label>
                  )}
                </For>
                <Button onPress={() => void form.submit()} disabled={form.busy() || !form.complete()}>
                  {form.busy() ? 'Saving…' : rotationId() ? 'Rotate credentials' : 'Connect new'}
                </Button>
              </>
            }
          >
            <Show
              when={deviceFlow.device()}
              fallback={
                <Button onPress={() => void deviceFlow.start()} disabled={deviceFlow.busy()}>
                  {deviceFlow.busy() ? 'Starting…' : `Connect ${selectedProvider()?.label ?? ''}`}
                </Button>
              }
            >
              {(started) => (
                <div class="integration-device">
                  <p class="integration-add-hint muted">Enter this code at the provider, then leave this page open.</p>
                  <div class="integration-device-code copyable">
                    <code>{started().userCode}</code>
                    <CopyButton text={() => started().userCode} title="Copy the code" />
                  </div>
                  {/* A real link, not a fetch: main's setWindowOpenHandler routes it through
                      isAllowedExternalUrl → shell.openExternal, so it opens in the owner's browser.
                      CSP-safe because it is a navigation, not a frame or a connect-src. */}
                  <a class="ui-btn" href={started().verificationUri} target="_blank" rel="noopener noreferrer">
                    Open {new URL(started().verificationUri).host}
                  </a>
                  <p class="integration-add-hint muted">Waiting for approval…</p>
                  <Button variant="ghost" tone="danger" onPress={deviceFlow.cancel}>Cancel</Button>
                </div>
              )}
            </Show>
          </Show>
          <Show when={form.error() || deviceFlow.error()}>{(message) => <Alert>{message()}</Alert>}</Show>
        </div>
      </div>
    </div>
  )
}

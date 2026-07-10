import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { PublicIntegrationProvider } from '../../shared/integrations'
import { connectIntegration, deleteIntegration, rotateIntegration, testIntegration } from '../../../plugins/github/client/mutations'
import { integrationsKey, integrationsOptions } from '../queries'

function IntegrationLogo(props: { provider: PublicIntegrationProvider | undefined }) {
  return (
    <span class="integration-logo" data-provider={props.provider?.id}>
      <span class="integration-logo-mono">{props.provider?.glyph ?? props.provider?.label[0] ?? '?'}</span>
    </span>
  )
}

export default function IntegrationsSettings() {
  const qc = useQueryClient()
  const status = createQuery(() => integrationsOptions(true))
  const providers = () => status.data?.providers ?? []
  const integrations = () => status.data?.integrations ?? []
  const byId = createMemo(() => new Map(providers().map((provider) => [provider.id, provider])))
  const connectable = () => providers().filter((provider) => provider.connection.connectable)

  const [adding, setAdding] = createSignal(false)
  const [rotationId, setRotationId] = createSignal<string | null>(null)
  const [providerId, setProviderId] = createSignal('')
  const selectedProvider = () => byId().get(providerId()) ?? connectable()[0]
  const [credentials, setCredentials] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const refresh = () => qc.invalidateQueries({ queryKey: integrationsKey })
  const valueFor = (id: string) => credentials()[id] ?? ''
  const setValue = (id: string, value: string) => setCredentials((current) => ({ ...current, [id]: value }))
  const complete = () => selectedProvider()?.connection.fields.every((field) => !field.required || !!valueFor(field.id).trim()) ?? false

  const add = async () => {
    const provider = selectedProvider()
    if (!provider || !complete()) return
    setBusy(true)
    setError('')
    try {
      if (rotationId()) await rotateIntegration(rotationId()!, credentials())
      else await connectIntegration(provider.id, credentials())
      setCredentials({})
      setRotationId(null)
      setAdding(false)
      await refresh()
    } catch (cause) {
      const code = (cause as Error).message
      setError(code === 'provider_needs_auth' ? `Those credentials were rejected by ${provider.label}.` : 'Could not connect this provider.')
    } finally {
      setBusy(false)
    }
  }

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

  return (
    <div class="integrations">
      <div class="integrations-list">
        <For each={integrations()}>
          {(connection) => {
            const provider = () => byId().get(connection.providerId)
            return (
              <div class="integration-card">
                <IntegrationLogo provider={provider()} />
                <div class="integration-meta">
                  <span class="integration-title">{connection.label}</span>
                  <span class="integration-sub">
                    {provider()?.label ?? connection.providerId}
                    {connection.account?.label ? ` · ${connection.account.label}` : ''}
                    {connection.status !== 'connected' ? ` · ${connection.status}` : ''}
                  </span>
                </div>
                <div class="integration-actions">
                  <Show when={provider()?.connection.disconnectable} fallback={<span class="integration-badge">Connected</span>}>
                    <button type="button" class="integration-remove" onClick={() => void test(connection.id)} disabled={busy()}>Test</button>
                    <button type="button" class="integration-remove" onClick={() => { setProviderId(connection.providerId); setRotationId(connection.id); setCredentials({}); setAdding(true) }} disabled={busy()}>Rotate</button>
                    <button type="button" class="integration-remove" onClick={() => void disconnect(connection.id)} disabled={busy()}>Disconnect</button>
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
      </div>

      <button type="button" class="overlay-btn integration-add-btn" classList={{ open: adding() }} onClick={() => setAdding((value) => !value)}>
        <span class="integration-add-icon">+</span> Add or rotate integration
      </button>

      <div class="integration-add-panel" classList={{ open: adding() }}>
        <div class="integration-add-inner">
          <div class="integration-provider-chips">
            <For each={connectable()}>
              {(provider) => (
                <button type="button" class="integration-chip" classList={{ active: selectedProvider()?.id === provider.id }} onClick={() => { setProviderId(provider.id); setRotationId(null); setCredentials({}) }}>
                  <span class="integration-logo-mono">{provider.glyph}</span> {provider.label}
                </button>
              )}
            </For>
          </div>
          <For each={selectedProvider()?.connection.fields ?? []}>
            {(field) => (
              <label class="integration-add-label">
                {field.label}
                <div class="integration-key-row">
                  <input
                    class="integration-key-input"
                    type={field.type}
                    placeholder={field.placeholder}
                    value={valueFor(field.id)}
                    onInput={(event) => setValue(field.id, event.currentTarget.value)}
                    onKeyDown={(event) => event.key === 'Enter' && void add()}
                  />
                </div>
                <Show when={field.hint}><p class="integration-add-hint muted">{field.hint}</p></Show>
              </label>
            )}
          </For>
          <button type="button" class="overlay-btn" onClick={() => void add()} disabled={busy() || !complete()}>
            {busy() ? 'Saving…' : rotationId() ? 'Rotate credentials' : 'Connect new'}
          </button>
          <Show when={error()}><div class="action-error">{error()}</div></Show>
        </div>
      </div>
    </div>
  )
}

import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'
import { githubDevicePollRoute, githubDeviceStartRoute, type GithubDevicePoll, type GithubDeviceStart } from '@acorn/protocol/api.ts'
import { postJson } from '../apiClient'
import CopyButton from '../ui/CopyButton'
import Icon from '../ui/Icon'
import {
  connectIntegration,
  deleteIntegration,
  rotateIntegration,
  setIntegrationDisabled,
  testIntegration,
} from '../integrations/integrationClient'
import { integrationsKey, integrationsOptions } from '../queries'

function IntegrationLogo(props: { provider: PublicIntegrationProvider | undefined }) {
  return (
    <span class="integration-logo" data-provider={props.provider?.id}>
      <span class="integration-logo-mono"><Icon name={props.provider?.glyph ?? props.provider?.label[0] ?? '?'} /></span>
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
  const [rotationId, setRotationId] = createSignal<string | null>(null)
  const [providerId, setProviderId] = createSignal('')
  const selectedProvider = () => byId().get(providerId()) ?? connectable()[0]
  const [credentials, setCredentials] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  // --- Device authorization grant (RFC 8628), for a provider whose descriptor says `kind:
  // 'device-flow'`. Currently only GitHub, and one branch here rather than a page of its own: this
  // component is already descriptor-driven, so "how the credential is obtained" is one more thing the
  // descriptor answers.
  const [device, setDevice] = createSignal<GithubDeviceStart | null>(null)
  let poller: ReturnType<typeof setTimeout> | undefined
  const stopPolling = () => clearTimeout(poller)
  onCleanup(stopPolling)

  const startDeviceFlow = async () => {
    setBusy(true)
    setError('')
    try {
      const started = await postJson<GithubDeviceStart>(githubDeviceStartRoute)
      setDevice(started)
      // The node performs the exchange; the client only paces it. `interval` is GitHub's, honoured
      // exactly — polling faster earns a slow_down and, eventually, nothing.
      poll(started, started.interval * 1000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the connection.')
    } finally {
      setBusy(false)
    }
  }

  const poll = (started: GithubDeviceStart, delay: number, deadline = Date.now() + started.expiresIn * 1000) => {
    stopPolling()
    poller = setTimeout(async () => {
      if (Date.now() > deadline) {
        setDevice(null)
        setError('That code expired. Start again.')
        return
      }
      try {
        const result = await postJson<GithubDevicePoll>(githubDevicePollRoute, { deviceCode: started.deviceCode })
        if (result.status === 'connected') {
          setDevice(null)
          setAdding(false)
          await refresh()
          return
        }
        if (result.status !== 'pending') {
          setDevice(null)
          setError(result.status === 'denied' ? 'That request was declined.' : 'That code expired. Start again.')
          return
        }
        // slow_down is a directive, not an error: GitHub adds 5s to the interval and expects us to keep it.
        poll(started, result.slowDown ? delay + 5_000 : delay, deadline)
      } catch (cause) {
        setDevice(null)
        setError(cause instanceof Error ? cause.message : 'Could not finish connecting.')
      }
    }, delay)
  }

  const cancelDeviceFlow = () => {
    stopPolling()
    setDevice(null)
  }

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
                    {/* Rotation means "submit a new credential for this connection", which a device flow
                        has no shape for — the owner never holds the token. Disconnect and connect again
                        is the honest path, so the button is simply absent. */}
                    <Show when={provider()?.connection.kind !== 'device-flow'}>
                      <button type="button" class="integration-remove" onClick={() => { setProviderId(connection.providerId); setRotationId(connection.id); setCredentials({}); setAdding(true) }} disabled={busy()}>Rotate</button>
                    </Show>
                    <button type="button" class="integration-remove" onClick={() => void setDisabled(connection.id, connection.status !== 'disabled')} disabled={busy()}>
                      {connection.status === 'disabled' ? 'Enable' : 'Disable'}
                    </button>
                    <button type="button" class="integration-remove" onClick={() => void disconnect(connection.id)} disabled={busy()}>Disconnect</button>
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
      </div>

      <button type="button" class="ui-btn integration-add-btn" classList={{ open: adding() }} onClick={() => setAdding((value) => !value)}>
        <span class="integration-add-icon">+</span> Add or rotate integration
      </button>

      <div class="integration-add-panel" classList={{ open: adding() }}>
        <div class="integration-add-inner">
          <div class="integration-provider-chips">
            <For each={connectable()}>
              {(provider) => (
                <button type="button" class="integration-chip" classList={{ active: selectedProvider()?.id === provider.id }} onClick={() => { setProviderId(provider.id); setRotationId(null); setCredentials({}) }}>
                  <span class="integration-logo-mono"><Icon name={provider.glyph} /></span> {provider.label}
                </button>
              )}
            </For>
          </div>
          <Show
            when={selectedProvider()?.connection.kind === 'device-flow'}
            fallback={
              <>
                <For each={selectedProvider()?.connection.fields ?? []}>
                  {(field) => (
                    <label class="integration-add-label">
                      {field.label}
                      <div class="integration-key-row">
                        <input
                          class="ui-input"
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
                <button type="button" class="ui-btn" onClick={() => void add()} disabled={busy() || !complete()}>
                  {busy() ? 'Saving…' : rotationId() ? 'Rotate credentials' : 'Connect new'}
                </button>
              </>
            }
          >
            <Show
              when={device()}
              fallback={
                <button type="button" class="ui-btn" onClick={() => void startDeviceFlow()} disabled={busy()}>
                  {busy() ? 'Starting…' : `Connect ${selectedProvider()?.label ?? ''}`}
                </button>
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
                  <button type="button" class="integration-remove" onClick={cancelDeviceFlow}>Cancel</button>
                </div>
              )}
            </Show>
          </Show>
          <Show when={error()}><div class="action-error">{error()}</div></Show>
        </div>
      </div>
    </div>
  )
}

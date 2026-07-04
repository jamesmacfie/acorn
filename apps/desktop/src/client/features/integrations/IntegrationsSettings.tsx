import { createSignal, For, Match, Show, Switch } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsKey, integrationsOptions } from '../../queries'
import { connectIntegration, deleteIntegration } from '../../mutations'
import type { IntegrationProvider } from '../../../shared/api'

// Settings → Integrations. A card list of every connection (GitHub is the identity root — shown but
// not disconnectable) plus an "Add" button that slides a form down. Built to hold many providers:
// each row carries a branded logo slot, and the add panel picks a provider before entering its
// credential. Multiple connections per provider are allowed (docs/workspaces 04).

const PROVIDER_LABEL: Record<IntegrationProvider, string> = { github: 'GitHub', linear: 'Linear', rollbar: 'Rollbar' }

// Branded logo for the row. Real mark where we have one; monogram fallback otherwise. Colour comes
// from the `data-provider` CSS rule, so adding a provider is: a case here + one CSS line.
function IntegrationLogo(props: { provider: IntegrationProvider }) {
  return (
    <span class="integration-logo" data-provider={props.provider}>
      <Switch fallback={<span class="integration-logo-mono">{(PROVIDER_LABEL[props.provider] ?? '?')[0]}</span>}>
        <Match when={props.provider === 'github'}>
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </Match>
        <Match when={props.provider === 'linear'}>
          <span class="integration-logo-mono">L</span>
        </Match>
      </Switch>
    </span>
  )
}

export default function IntegrationsSettings() {
  const qc = useQueryClient()
  const status = createQuery(() => integrationsOptions(true))
  const integrations = () => status.data?.integrations ?? []

  const [adding, setAdding] = createSignal(false)
  const [key, setKey] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [provider, setProvider] = createSignal<'linear' | 'rollbar'>('linear')

  const refresh = () => qc.invalidateQueries({ queryKey: integrationsKey })

  const add = async () => {
    const k = key().trim()
    if (!k) return
    setBusy(true)
    setError('')
    try {
      await connectIntegration(provider(), k)
      setKey('')
      setAdding(false)
      await refresh()
    } catch (e) {
      setError((e as Error).message === 'invalid_key' ? `That key was rejected by ${PROVIDER_LABEL[provider()]}.` : 'Could not connect.')
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

  return (
    <div class="integrations">
      <div class="integrations-list">
        <For each={integrations()}>
          {(it) => (
            <div class="integration-card">
              <IntegrationLogo provider={it.provider} />
              <div class="integration-meta">
                <span class="integration-title">{it.label}</span>
                <span class="integration-sub">
                  {PROVIDER_LABEL[it.provider] ?? it.provider}
                  {it.workspace ? ` · ${it.workspace}` : ''}
                </span>
              </div>
              <div class="integration-actions">
                <Show when={it.provider !== 'github'} fallback={<span class="integration-badge">Connected</span>}>
                  <button type="button" class="integration-remove" onClick={() => void disconnect(it.id)} disabled={busy()}>
                    Disconnect
                  </button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>

      <button type="button" class="overlay-btn integration-add-btn" classList={{ open: adding() }} onClick={() => setAdding((v) => !v)}>
        <span class="integration-add-icon">+</span> Add integration
      </button>

      <div class="integration-add-panel" classList={{ open: adding() }}>
        <div class="integration-add-inner">
          <div class="integration-provider-chips">
            <button type="button" class="integration-chip" classList={{ active: provider() === 'linear' }} onClick={() => setProvider('linear')}>
              <span class="integration-logo-mono" style={{ color: '#5e6ad2' }}>L</span> Linear
            </button>
            <button type="button" class="integration-chip" classList={{ active: provider() === 'rollbar' }} onClick={() => setProvider('rollbar')}>
              <span class="integration-logo-mono" style={{ color: '#3a6cd4' }}>R</span> Rollbar
            </button>
          </div>
          <label class="integration-add-label" for="integration-key">
            {provider() === 'rollbar' ? 'Project access token (read)' : 'Personal API key'}
          </label>
          <div class="integration-key-row">
            <input
              id="integration-key"
              class="integration-key-input"
              type="password"
              placeholder={provider() === 'rollbar' ? 'read token…' : 'lin_api_…'}
              value={key()}
              onInput={(e) => setKey(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <button type="button" class="overlay-btn" onClick={() => void add()} disabled={busy() || !key().trim()}>
              {busy() ? 'Connecting…' : 'Connect'}
            </button>
          </div>
          <p class="integration-add-hint muted">
            {provider() === 'rollbar'
              ? 'Rollbar → project → Settings → Project Access Tokens (read scope). One connection per project.'
              : 'Linear → Settings → Security & access → Personal API keys. You can connect more than one workspace.'}
          </p>
          <Show when={error()}>
            <div class="action-error">{error()}</div>
          </Show>
        </div>
      </div>
    </div>
  )
}

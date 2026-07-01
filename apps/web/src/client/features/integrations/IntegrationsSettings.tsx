import { createSignal, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsKey, integrationsOptions } from '../../queries'
import { connectLinear, disconnectLinear } from '../../mutations'

// Settings → Integrations. Connect Linear by pasting a personal API key (server validates +
// encrypts it). Rendered inside the Settings pane, so no overlay of its own.
export default function IntegrationsSettings() {
  const qc = useQueryClient()
  const status = createQuery(() => integrationsOptions(true))
  const [key, setKey] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const linear = () => status.data?.linear
  const refresh = () => qc.invalidateQueries({ queryKey: integrationsKey })

  const save = async () => {
    const k = key().trim()
    if (!k) return
    setBusy(true)
    setError('')
    try {
      await connectLinear(k)
      setKey('')
      await refresh()
    } catch (e) {
      setError((e as Error).message === 'invalid_key' ? 'That key was rejected by Linear.' : 'Could not connect.')
    } finally {
      setBusy(false)
    }
  }
  const disconnect = async () => {
    setBusy(true)
    try {
      await disconnectLinear()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="integration-setting">
      <div class="integration-setting-head">
        <span class="integration-setting-name">Linear</span>
        <Show when={linear()?.connected}>
          <span class="muted">Connected{linear()?.workspace ? ` · ${linear()!.workspace}` : ''}</span>
        </Show>
      </div>
      <Show
        when={linear()?.connected}
        fallback={
          <>
            <p class="muted">
              Paste a Linear personal API key (Linear → Settings → Security &amp; access → Personal API keys). Linked tickets in PRs will show
              inline.
            </p>
            <div class="integration-key-row">
              <input
                class="integration-key-input"
                type="password"
                placeholder="lin_api_…"
                value={key()}
                onInput={(e) => setKey(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
              <button type="button" onClick={save} disabled={busy() || !key().trim()}>
                {busy() ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            <Show when={error()}>
              <div class="action-error">{error()}</div>
            </Show>
          </>
        }
      >
        <button type="button" onClick={disconnect} disabled={busy()}>
          {busy() ? 'Disconnecting…' : 'Disconnect'}
        </button>
      </Show>
    </div>
  )
}

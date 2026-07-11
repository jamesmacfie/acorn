import { createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { readJson, writeJson } from '../apiClient'

// Settings → API (docs/public-api.md, implementation-plan.md Phase 9). Manages the
// public automation API: enable/port for the loopback listener and bearer-token issuance/revocation.
// Tokens are cookie-authenticated admin (a bearer can never mint tokens); the raw token is shown once.

type ApiServerSettings = { enabled: boolean; port: number; effectivePort: number; bindAddress: string; portOverridden: boolean; error?: string; rebound?: boolean }
type TokenScopes = ['read'] | ['read', 'write']
type TokenSummary = { id: string; name: string; prefix: string; scopes: TokenScopes; createdAt: number; lastUsedAt: number | null; expiresAt: number | null; revokedAt: number | null }
type CreatedToken = { token: string; metadata: TokenSummary }

const SETTINGS_KEY = ['api-settings']
const TOKENS_KEY = ['api-tokens']
const fmt = (ms: number | null) => (ms == null ? '—' : new Date(ms).toLocaleString())

export default function ApiSettings() {
  const qc = useQueryClient()
  const settings = createQuery(() => ({ queryKey: SETTINGS_KEY, queryFn: () => readJson<ApiServerSettings>('/api/settings/api') }))
  const tokens = createQuery(() => ({ queryKey: TOKENS_KEY, queryFn: () => readJson<TokenSummary[]>('/api/api-tokens') }))

  const [error, setError] = createSignal('')
  const [portDraft, setPortDraft] = createSignal<number | null>(null)
  const port = () => portDraft() ?? settings.data?.port ?? 4318

  const patchSettings = async (patch: Partial<Pick<ApiServerSettings, 'enabled' | 'port'>>) => {
    setError('')
    try {
      await writeJson('/api/settings/api', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
      setPortDraft(null)
      await qc.invalidateQueries({ queryKey: SETTINGS_KEY })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update settings')
    }
  }

  // --- Token create form ---
  const [name, setName] = createSignal('')
  const [canWrite, setCanWrite] = createSignal(false)
  const [expiry, setExpiry] = createSignal('') // yyyy-mm-dd or ''
  const [creating, setCreating] = createSignal(false)
  const [freshToken, setFreshToken] = createSignal<CreatedToken | null>(null)
  const [copied, setCopied] = createSignal(false)

  const create = async () => {
    if (!name().trim()) return
    setCreating(true)
    setError('')
    try {
      const scopes: TokenScopes = canWrite() ? ['read', 'write'] : ['read']
      const expiresAt = expiry() ? new Date(`${expiry()}T23:59:59`).getTime() : null
      const created = await writeJson<CreatedToken>('/api/api-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name().trim(), scopes, expiresAt }),
      })
      setFreshToken(created)
      setName('')
      setCanWrite(false)
      setExpiry('')
      await qc.invalidateQueries({ queryKey: TOKENS_KEY })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create token')
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (id: string) => {
    setError('')
    // DELETE returns 204 (no body) → use fetch directly rather than writeJson (which parses JSON).
    const res = await fetch(`/api/api-tokens/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setError('Failed to revoke token')
      return
    }
    await qc.invalidateQueries({ queryKey: TOKENS_KEY })
  }

  const copyToken = () => {
    const t = freshToken()?.token
    if (!t) return
    void navigator.clipboard.writeText(t).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const curlExample = () => `ACORN_TOKEN=<paste-token> \\\n  curl -H "Authorization: Bearer $ACORN_TOKEN" \\\n  http://${settings.data?.bindAddress ?? '127.0.0.1:4318'}/api/v1/health`

  return (
    <div class="settings-page-api">
      <p class="muted">
        The automation API lets scripts inspect and control Acorn over a loopback HTTP + WebSocket
        interface. It is bound to <code>127.0.0.1</code> only and is off until you enable it and create a token.
      </p>

      <Show when={error()}>
        <p class="settings-error" style={{ color: 'var(--danger, #d33)' }}>{error()}</p>
      </Show>

      {/* --- Listener --- */}
      <h3>API server</h3>
      <Show when={settings.data} fallback={<p class="muted">Loading…</p>}>
        {(s) => (
          <>
            <label class="settings-field-row">
              <input type="checkbox" checked={s().enabled} onChange={(e) => patchSettings({ enabled: e.currentTarget.checked })} />
              <span class="settings-label">Enable the automation API</span>
            </label>
            <div class="settings-field">
              <span class="settings-label">Port</span>
              <div class="settings-field-row">
                <input
                  type="number"
                  min="1024"
                  max="65535"
                  value={port()}
                  disabled={s().portOverridden}
                  onInput={(e) => setPortDraft(Number(e.currentTarget.value))}
                />
                <button type="button" disabled={s().portOverridden || port() === s().port} onClick={() => patchSettings({ port: port() })}>
                  Save port
                </button>
              </div>
              <p class="muted" style={{ 'margin-top': '0' }}>
                Effective address: <code>{s().bindAddress}</code>.
                <Show when={s().portOverridden}> Overridden by the <code>ACORN_API_PORT</code> environment variable (read-only until restart).</Show>
                {' '}Port <code>4317</code> is reserved for the app itself.
              </p>
              <Show when={s().error}><p class="muted" style={{ color: 'var(--danger, #d33)' }}>{s().error}</p></Show>
            </div>
          </>
        )}
      </Show>

      {/* --- Tokens --- */}
      <h3 style={{ 'margin-top': '1.5rem' }}>Tokens</h3>
      <p class="muted">
        <strong>A write token can run arbitrary commands as your local user.</strong> Keep it secret; a leaked token is
        revocable here and takes effect immediately.
      </p>

      <Show when={freshToken()}>
        {(t) => (
          <div class="settings-field" style={{ border: '1px solid var(--accent, #57f)', padding: '0.75rem', 'border-radius': '6px' }}>
            <span class="settings-label">New token — copy it now, it is shown only once</span>
            <div class="settings-field-row">
              <code style={{ 'user-select': 'all', 'word-break': 'break-all', flex: '1' }}>{t().token}</code>
              <button type="button" onClick={copyToken}>{copied() ? 'Copied' : 'Copy'}</button>
              <button type="button" onClick={() => setFreshToken(null)}>Dismiss</button>
            </div>
          </div>
        )}
      </Show>

      <div class="settings-field">
        <span class="settings-label">Create a token</span>
        <div class="settings-field-row">
          <input type="text" placeholder="Name (e.g. ci)" maxLength={80} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          <input type="date" value={expiry()} onInput={(e) => setExpiry(e.currentTarget.value)} title="Optional expiry" />
        </div>
        <label class="settings-field-row">
          <input type="checkbox" checked={canWrite()} onChange={(e) => setCanWrite(e.currentTarget.checked)} />
          <span class="settings-label">Grant write scope (create/run/mutate — not just read)</span>
        </label>
        <div class="settings-field-row">
          <button type="button" disabled={creating() || !name().trim()} onClick={create}>{creating() ? 'Creating…' : 'Create token'}</button>
        </div>
      </div>

      <Show when={(tokens.data?.length ?? 0) > 0} fallback={<p class="muted">No tokens yet.</p>}>
        <table class="settings-token-table" style={{ width: '100%', 'border-collapse': 'collapse' }}>
          <thead>
            <tr style={{ 'text-align': 'left' }}>
              <th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Expires</th><th></th>
            </tr>
          </thead>
          <tbody>
            <For each={tokens.data}>
              {(tok) => (
                <tr style={{ opacity: tok.revokedAt ? '0.5' : '1' }}>
                  <td>{tok.name}</td>
                  <td><code>{tok.prefix}</code></td>
                  <td>{tok.scopes.join(' + ')}</td>
                  <td class="muted">{fmt(tok.lastUsedAt)}</td>
                  <td class="muted">{fmt(tok.expiresAt)}</td>
                  <td>
                    <Show when={!tok.revokedAt} fallback={<span class="muted">revoked</span>}>
                      <button type="button" onClick={() => revoke(tok.id)}>Revoke</button>
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>

      <div class="settings-field" style={{ 'margin-top': '1rem' }}>
        <span class="settings-label">Example request</span>
        <pre class="muted" style={{ 'white-space': 'pre-wrap', 'word-break': 'break-all' }}><code>{curlExample()}</code></pre>
      </div>
    </div>
  )
}

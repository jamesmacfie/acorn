// The Acme Cloud connection. Declaring it puts an Acme Cloud row under Settings › Connections, with a
// form built from `fields`. acorn stores the key encrypted, and this plugin never stores or reads it
// on its own: it borrows it for one call at a time with `withConnections`.

export const API = 'https://api.acme.example'

/** A failure acorn understands: the code says what went wrong, and the status what to do about it. */
const failure = (code, status, message) => Object.assign(new Error(message), { code, status })

// #region provider
export const acmeCloud = {
  id: 'acme-cloud',
  label: 'Acme Cloud',
  glyph: 'cloud',
  kind: 'generic',
  connection: {
    authKind: 'api-key',
    fields: [{ id: 'apiKey', label: 'API key', type: 'password', required: true, hint: 'From Acme Cloud › Settings › API keys.' }],
    connectable: true,
    disconnectable: true,
    // Runs once when the person saves the form. What it returns reaches `normalize`.
    async validate(credentials) {
      const key = String(credentials.apiKey ?? '').trim()
      const response = await fetch(`${API}/v1/me`, { headers: { authorization: `Bearer ${key}` } })
      if (!response.ok) throw failure('provider_needs_auth', 401, 'Acme Cloud refused that API key.')
      return { key, account: await response.json() }
    },
    // What acorn stores: the secret, sealed, and a label and account the person can see.
    normalize(_credentials, { key, account }) {
      return {
        secret: key,
        label: `Acme Cloud (${account.name})`,
        account: { id: account.id, label: account.name },
        scopes: [],
        config: {},
        capabilities: {},
      }
    },
    // Runs when acorn checks the connection again later.
    async test(key) {
      const response = await fetch(`${API}/v1/me`, { headers: { authorization: `Bearer ${key}` } })
      return response.ok ? { ok: true } : { ok: false, error: 'provider_needs_auth' }
    },
  },
  capabilities: {},
  budgets: { maxConcurrentRequests: 4, maxConcurrentRequestsPerConnection: 2 },
  // What every client may see about the provider. The host checks it holds exactly these fields, so a
  // secret can't leak through it.
  toPublic() {
    const { authKind, fields, connectable, disconnectable } = this.connection
    return {
      id: this.id,
      label: this.label,
      kind: this.kind,
      glyph: this.glyph,
      connection: { authKind, fields, connectable, disconnectable },
      capabilities: this.capabilities,
    }
  },
}
// #endregion

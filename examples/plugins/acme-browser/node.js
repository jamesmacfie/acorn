// One file, no imports. The browser extension's native host calls these routes with a device
// credential. The host strips `/v1/p/acme-browser`, so `/v1/p/acme-browser/browser/issue` arrives
// as `/browser/issue`.

const API = 'https://api.acme.example'
const refuse = (status, message) => Response.json({ error: { code: 'refused', message } }, { status })

// #region provider
// The Acme Issues connection, under Settings › Connections. A handoff answers with the connection that
// found the item, so the plugin needs one of its own.
const acmeIssues = {
  id: 'acme-issues',
  label: 'Acme Issues',
  glyph: 'list-todo',
  kind: 'issue-tracker',
  connection: {
    authKind: 'api-key',
    fields: [{ id: 'apiKey', label: 'API key', type: 'password', required: true }],
    connectable: true,
    disconnectable: true,
    async validate(credentials) {
      return String(credentials.apiKey ?? '').trim()
    },
    normalize(_credentials, key) {
      return { secret: key, label: 'Acme Issues', account: null, scopes: [], config: {}, capabilities: {} }
    },
    async test() {
      return { ok: true }
    },
  },
  capabilities: {},
  budgets: { maxConcurrentRequests: 4, maxConcurrentRequestsPerConnection: 2 },
  toPublic() {
    const { authKind, fields, connectable, disconnectable } = this.connection
    return { id: this.id, label: this.label, kind: this.kind, glyph: this.glyph, connection: { authKind, fields, connectable, disconnectable }, capabilities: this.capabilities }
  },
}
// #endregion

// The Acme app each task runs, by task id, while its `web` run target is up.
/** @type {Map<string, string>} */
const apps = new Map()

export default {
  name: 'acme-browser',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    ctx.providers.connection(acmeIssues)

    // #region run-target
    // The app comes up and goes down with the task's `web` run target. List an address only while it
    // answers, and tell the extension to read the list again.
    ctx.events.on('run:changed', (frame) => {
      if (frame.targetId !== 'web' || typeof frame.taskId !== 'string') return
      if (frame.running) apps.set(frame.taskId, `https://acme-${frame.taskId.slice(0, 8)}.localhost:5173`)
      else apps.delete(frame.taskId)
      ctx.events.status()
    })
    // #endregion

    ctx.routes.fetch(async (request, context) => {
      const url = new URL(request.url)
      // A credential bound to one task never reads another task's pages or apps.
      if (context.principal.scope === 'task') return refuse(403, 'These routes are for the browser extension.')
      switch (`${request.method} ${url.pathname}`) {
        // #region resolve
        // The extension matched the page against `match`. `captures` is the only identity it supplies.
        case 'POST /browser/issue': {
          const { captures } = await request.json()
          const key = String(captures?.key ?? '').toUpperCase()
          if (!/^ACME-\d+$/.test(key)) return Response.json({ items: [] })
          // Ask every connection: two accounts that can both see the issue are two items.
          const items = await context.providers.withConnections('acme-issues', async (connection, apiKey) => {
            const response = await fetch(`${API}/v1/issues/${key}`, { headers: { authorization: `Bearer ${apiKey}` } })
            if (!response.ok) return undefined
            const issue = await response.json()
            const address = `https://example.com/issues/${key}`
            return {
              identifier: key,
              url: address,
              title: issue.title,
              connection: { id: connection.id, label: connection.label },
              projects: [],
              // The task acorn creates. A link with the item's own address is how a page finds its task.
              seed: {
                origin: 'acme-browser',
                title: `${key}: ${issue.title}`,
                branch: key.toLowerCase(),
                links: [{ connectionId: connection.id, identifier: key, ref: { url: address } }],
              },
              context: { label: key, content: issue.description || issue.title },
            }
          })
          if (!items.length && !(await context.providers.connections('acme-issues')).length)
            return refuse(403, 'Connect Acme Issues in Settings › Connections, then try again.')
          return Response.json({ items: items.filter(Boolean).slice(0, 8) })
        }
        // #endregion

        // #region addresses
        // Read whenever the extension reads the Node's task pages.
        case 'GET /task-addresses':
          return Response.json({
            addresses: [...apps].map(([taskId, origin]) => ({
              taskId, origin, label: 'Acme app', state: 'running', severity: 'info',
            })),
          })
        // #endregion

        // #region panel
        // The sidebar's panel for one task. A 404 means this task has none, and the nav item hides.
        case 'GET /browser-panel': {
          const origin = apps.get(url.searchParams.get('taskId') ?? '')
          if (!origin) return new Response('no panel for this task', { status: 404 })
          return Response.json({
            blocks: [
              { kind: 'status', label: 'Acme app', state: 'running', severity: 'info' },
              { kind: 'links', title: 'Open', links: [{ label: 'App', url: origin }, { label: 'Health', url: `${origin}/health` }] },
            ],
          })
        }
        // #endregion
        default:
          return new Response('not found', { status: 404 })
      }
    })
  },
}

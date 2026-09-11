# Installing a hand-written package

[Back to plugin authoring](../plugin-authoring.md)

## Installing a hand-written package

The install route is unchanged and deliberately unreachable from plugin code:
`POST /v2/core/plugins/install`, owner or device principal, `Idempotency-Key` header required,
audited. For a hand-written directory the source form is a local path:

```json
{ "source": { "path": "/absolute/path/to/my-plugin" } }
```

`linkLocal` (`server/plugins/installer.ts`) **symlinks** the directory rather than copying it, which is what
makes the loop worth having: you edit in place and the next boot runs what you edited. This works on
every build, packaged included — Settings → Plugins → *Local folder* has a **Choose…** button when the
target node is this machine. The path must be absolute. Uninstall unlinks rather than following the
symlink into your working tree.

The trade is that a folder is the one source acorn cannot pin: the lockfile records no archive hash and
no entrypoint digests, because the bytes keep changing by design.
[security.md § Installing from a folder](../security.md) has the reasoning for allowing it anywhere and
what it deliberately does not claim.

Installing writes a lockfile and reports `installed-restart-required`. A loaded plugin's routes,
tables and jobs wire at init, so a package is not live until the node re-runs it: restart the node,
and under the desktop use Settings → Plugins → Restart, which also reloads the renderer because frame
contributions resolve once per session.

If the package has a client file, each device asks its own owner before running those bytes, keyed by
`(pluginId, hash)`. Rewriting `client.js` changes the hash and re-prompts. A package with no `client`
key has nothing to trust and registers its descriptors directly.

**If an agent is writing the package**, it should call the `plugin_authoring` agent tool first: it answers
with this contract plus the connected node's *current* manifest vocabulary, action verbs and bridge
messages read off that node's own schemas, which is the only way to be sure an answer is not from memory
([agent-tools.md](../agent-tools.md)). It cannot call the install route — no task-scoped token reaches it. It
asks instead, with the `plugin_request` agent tool, and the owner approves in the shell; the device then
installs. Asking with `dev: true` also puts the plugin into development mode on the approving device, which
auto-trusts its later bundles and turns the loop into edit → reload rather than edit → prompt → restart.
[plugins.md § Approval-mediated install](../plugins.md) and
[security.md § The dev grant](../security.md) are the full story, including how the owner ends it.

When something does not load, the roster row says why: the manifest reason names the offending field
paths (up to three, then "and N more"), and `stage` distinguishes `'load'` — a package that never ran
— from `'init'` and `'ready'`.


## A complete example

A plugin with a node half in two files and one vanilla pane. It takes the frame path, because a
frame makes the browser bridge visible in a small example. For a tree without a bundler, use the
default scaffold, which inlines the tree protocol.

### `acorn-plugin.json`

```json
{
  "id": "hello-acorn",
  "name": "Hello Acorn",
  "version": "0.1.0",
  "apiVersion": "11",
  "node": "./node/index.js",
  "client": "./client.js",
  "permissions": {
    "api": [],
    "events": [],
    "node": { "core": ["tasks"], "capabilities": [], "secrets": false, "exec": false, "net": [] }
  },
  "contributions": {
    "frames": [
      {
        "target": "pane", "id": "hello-acorn", "label": "Hello", "glyph": "hand", "order": 800,
        "layout": "single", "regions": { "body": "frame" }
      }
    ]
  }
}
```

`api: []` is correct and not an omission: the frame calls only this plugin's own namespace, which
needs no scope. `core: ["tasks"]` is there because the route below resolves a task. `layout: "single"`
over a `"frame"` region is how a pane says "the host draws the box, I draw the inside": every `pane`,
`refPanel` and `settings` surface has to say which of the three it is, and omitting the layout is no
longer a way to mean "all of it is my iframe".

### `node/index.js`

```js
import { handle } from '../server/routes.js'

// Relative imports and `node:` builtins only — this directory has no node_modules.
export default {
  name: 'hello-acorn',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    // The portable carrier. The mount is stripped, so `/v2/p/hello-acorn/greeting`
    // arrives here as `/greeting`.
    ctx.routes.fetch((request, context) => handle(request, context, ctx.core))
  },
}
```

### `server/routes.js`

```js
/**
 * @param {Request} request
 * @param {import('acorn-plugin-types').PluginRequestContext} context
 * @param {import('acorn-plugin-types').CoreServices} core
 */
export async function handle(request, context, core) {
  const { pathname, searchParams } = new URL(request.url)

  if (request.method === 'GET' && pathname === '/greeting') {
    const taskId = searchParams.get('taskId')
    // core.tasks answers with a TaskRef projection — id, title, projectId, branch,
    // worktreePath, pullNumber — never the row.
    const task = taskId ? await core.tasks.load(taskId) : null
    return Response.json({
      text: task ? `Hello from ${task.title}` : 'Hello from the node',
      who: context.userId,
    })
  }

  return new Response('not found', { status: 404 })
}
```

### `client.js`

```js
// The bridge handshake, inlined. @acorn/plugin-api/ui/sdk is what a bundled frame imports;
// a single-file frame has no way to resolve a bare specifier, so it sends the same messages
// by hand. packages/client-core/src/host/frames/sdk.ts is the reference for the semantics.

const pending = new Map()
let port = null
let seq = 0

const connected = new Promise((resolve) => {
  addEventListener('message', (event) => {
    if (!event.data || event.data.acornBridge !== 1) return   // PLUGIN_BRIDGE_VERSION
    port = event.ports[0]
    port.onmessage = (e) => {
      const message = e.data
      if (!message) return
      if (typeof message.id === 'number') {
        const waiting = pending.get(message.id)
        pending.delete(message.id)
        waiting?.(message)
        return
      }
      if (message.kind === 'ready') {
        // The ack. Without it the host's 10s deadline swaps this frame for a placeholder.
        port.postMessage({ kind: 'connected' })
        resolve(message.context)
      }
      if (message.kind === 'appearance') applyAppearance(message)
    }
    port.start?.()
  })
})

function applyAppearance({ theme, style, tokens }) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.style = style
  // Without this the host's /ui.css classes and every var(--…) in your own CSS fall back.
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value)
}

const send = (message) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, (reply) => {
    if (reply.ok) resolve(reply.body)
    else reject(new Error(`${reply.error.code}: ${reply.error.message}`))
  })
  port.postMessage({ ...message, id })
})

const get = (path) => send({ kind: 'api', method: 'GET', path })
const toast = (title) => send({ kind: 'ui', op: 'toast', title })

// The document already exists and already links /ui.css — a module script runs after it parses.
const root = document.createElement('div')
root.style.padding = '16px'
document.body.append(root)

connected.then(async (context) => {
  const query = context.taskId ? `?taskId=${encodeURIComponent(context.taskId)}` : ''
  const { text } = await get(`/v2/p/hello-acorn/greeting${query}`)

  const heading = document.createElement('h1')
  heading.textContent = text

  const button = document.createElement('button')
  button.className = 'ui-btn'             // from the host's /ui.css
  button.textContent = 'Say hello back'
  button.addEventListener('click', () => void toast('Hello from the frame'))

  root.append(heading, button)
}).catch((error) => {
  root.className = 'ui-alert'
  root.dataset.variant = 'banner'
  root.dataset.tone = 'danger'
  root.textContent = String(error)
})
```

Install it with the local-path source above, restart the node, accept the bundle when the device asks,
and the pane is in the task pane switcher.

## Appendix: the frame path

Everything in this section is the older of the two ways to draw. Reach for it when your surface owns
its own pixels; reach for a tree otherwise.

A frame is a **host-generated iframe document**, not a component in the shell's tree. The shell
serves it from a content-addressed cache on `app-plugin://<bundle-hash>/`, and the handler answers
exactly four paths (`apps/desktop/src-tauri/src/plugin_scheme.rs`):

- `/` and `/index.html` — the generated document. The plugin owns what runs; it does not own the
  document, the CSP or the bootstrap, which is what keeps the policy un-overridable by markup.
- `/ui.css` — the host's shared presentation stylesheet, identical at every plugin origin.
- `/client.js` — your file.

Everything else is a 404. **That is the single-file rule**: there is no plugin-controlled asset tree,
so a second module, a stylesheet, an image or a font cannot be fetched. Inline them — the CSP allows
`img-src 'self' data:` for exactly this. And `connect-src 'none'` means a frame has no network at all:
not a restricted one, none. `fetch`, XHR, WebSocket, `sendBeacon` and EventSource all fail. Its only
I/O is the `MessagePort` the host transfers in.

Because the document is the host's and it loads your file as a module script, there is also no
framework requirement. Vanilla DOM is the natural fit, and the bridge is the whole surface a frame
has anyway.

Two browser affordances that are absent and surprise people: `window.confirm` and `alert` are
suppressed (the iframe is deliberately not `allow-modals`, so `confirm()` returns `false` and a
guarded action silently does nothing), and `navigator.clipboard` refuses to write because the frame's
document is not the focused one. Use the bridge's `ui.copy`, and draw your own confirmation.

The complete example uses a frame. The default scaffold provides a tree with its protocol inlined.

## Updating a plugin, and the data underneath it

Keep the plugin ID stable and append schema migrations. Do not edit or reorder a migration that
has shipped. Before applying anything new, the loader hashes the current SQL and compares the applied
prefix, journal order, and timestamps with the database's migration ledger. Restore the original chain
and append a new migration if that check fails.

The installer rejects a lower version unless the caller explicitly requests a downgrade. That override
does not reverse migrations. To recover a failed update, restore a compatible database backup or
reinstall with `purgeData` if discarding the plugin's data is acceptable. Uninstall keeps data by default.

Development reload can roll back registrations after failed initialization. It cannot undo a migration
that already ran. Reload starts a fresh worker realm and re-evaluates the complete node dependency
graph. For details, see [The dev loop](../plugins/activation.md#the-dev-loop).

Agent install and update requests go through `plugin_request` and device approval. A development grant
changes the client trust loop; it does not make schema rollback available.

## What this profile refuses, and why

- **No bundler in the node.** Size, supply chain and a compile step inside the trusted process, paid
  permanently. If the profile proves too tight — a plugin genuinely needs a dependency or JSX — the
  escape hatches in order of preference are: shell out to a dev checkout's `build:plugin`, which
  already exists and already has Vite; and only then consider shipping a bundler. Real friction should
  justify the dependency, not the anticipation of it.
- **No multi-file plugin origins.** Serving an asset tree at `app-plugin://<hash>/` would mean the
  hash claim covers a directory rather than a file, which is strictly harder to audit for exactly
  nothing an inlined `data:` URI cannot do.
- Use remote trees for shared components and descriptors for host-owned data views. Use a frame
  for browser-specific rendering. Document regions expose text through host-owned editors without
  granting access to editor internals.
- **The profile is a contract, not a code path.** It is versioned with the plugin API major and
  nothing enforces it beyond what the loader and the scheme already do. When the loader's tolerance
  changes, this file is the thing to update deliberately — an implicit property of what the loader
  happens to accept is not a contract anyone can write against.

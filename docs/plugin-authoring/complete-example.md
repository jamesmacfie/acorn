# A complete example

This page is a complete hand-written plugin: a node half in two files and one frame pane, with no
build step. It's part of [plugin authoring](../plugin-authoring.md). It uses a frame so the browser
bridge is visible. For a tree without a bundler, start from the default scaffold instead
([start from the scaffold](./start-from-the-scaffold.md)).

## `acorn-plugin.json`

```json
{
  "id": "hello-acorn",
  "name": "Hello Acorn",
  "version": "1.0.0",
  "baseline": "acorn-1",
  "apiVersion": "3",
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

`api: []` is correct: the frame calls only this plugin's own namespace, which needs no scope.
`core: ["tasks"]` is there because the route reads a task. `layout: "single"` over a `"frame"` region
says the host draws the box and the plugin draws the inside.

## `node/index.js`

```js
import { handle } from '../server/routes.js'

// Relative imports and `node:` builtins only. This folder has no node_modules.
export default {
  name: 'hello-acorn',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    // The mount is stripped, so `/v1/p/hello-acorn/greeting` arrives here as `/greeting`.
    ctx.routes.fetch((request, context) => handle(request, context, ctx.core))
  },
}
```

## `server/routes.js`

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
    // core.tasks answers with a TaskRef: id, title, projectId, branch, worktreePath, and pullNumber.
    const task = taskId ? await core.tasks.load(taskId) : null
    return Response.json({
      text: task ? `Hello from ${task.title}` : 'Hello from the node',
      who: context.userId,
    })
  }

  return new Response('not found', { status: 404 })
}
```

## `client.js`

```js
// The bridge handshake, inlined. A single-file frame can't resolve a bare import, so it sends the
// messages by hand. packages/client-core/src/host/frames/sdk/connection.ts defines the handshake, and
// packages/client-core/src/host/frames/sdk/bridgePort.ts defines request behavior.

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
        // The acknowledgement. Without it, the host's 10-second deadline replaces this frame.
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
  // Without this, the host's /ui.css classes and every var(--…) in your own CSS fall back.
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

// The document already exists and links /ui.css. A module script runs after it parses.
const root = document.createElement('div')
root.style.padding = '16px'
document.body.append(root)

connected.then(async (context) => {
  const query = context.taskId ? `?taskId=${encodeURIComponent(context.taskId)}` : ''
  const { text } = await get(`/v1/p/hello-acorn/greeting${query}`)

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

## Run it

1. Install the folder with the local-path source
   ([install a hand-written package](./installing-a-hand-written-package.md)).
2. Restart the Node.
3. Accept the bundle when the device asks.
4. Open a task. **Hello** is in the task's pane switcher.

`packages/create-acorn-plugin/index.test.ts` type-checks this example outside the workspace against the
packed `acorn-plugin-types`.

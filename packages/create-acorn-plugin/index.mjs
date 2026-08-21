#!/usr/bin/env node
// `npm create acorn-plugin`: the front door for an author with no checkout of this repository. See
// docs/plugin-authoring.md § Start from the scaffold for the no-bundler profile, and for why the
// emitted bridge is a copy rather than a dependency.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The plugin API major this scaffold writes into `apiVersion`. Hardcoded because this package is
 * published standalone and can't import the constant; see docs/plugin-authoring.md § Start from the
 * scaffold for how index.test.ts keeps the copy honest.
 */
export const API_VERSION = '2'

/** Manifest ids: `/^[a-z][a-z0-9-]{1,31}$/`. See docs/plugin-authoring.md § The manifest for the
 * dot-ban rule. Returns null when nothing usable survives. */
export function toPluginId(input) {
  const id = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '')
  return /^[a-z][a-z0-9-]{1,31}$/.test(id) ? id : null
}

/** A display name from an id: `my-widget` → `My widget`. */
export function toDisplayName(id) {
  const words = id.split('-')
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ' ' + words.slice(1).join(' ') : '')
}

/** The whole package, as a path → contents map. Exported so the repository's own suite can parse the
 * manifest with the host's parser instead of trusting this file. */
export function scaffoldFiles(id, name = toDisplayName(id)) {
  return {
    'acorn-plugin.json': manifest(id, name),
    'node/index.js': nodeIndex(id),
    'node/routes.js': nodeRoutes(),
    'client.js': client(id, name),
    'README.md': readme(id, name),
  }
}

function manifest(id, name) {
  return (
    JSON.stringify(
      {
        id,
        name,
        version: '0.1.0',
        apiVersion: API_VERSION,
        node: './node/index.js',
        client: './client.js',
        // `api: []` is correct, not an omission: a frame's own `/v2/p/<id>/` namespace needs no scope.
        // Add one of the six grantable scopes only when you call a core route. `core: ['tasks']` is
        // here because node/routes.js resolves a task.
        permissions: {
          api: [],
          events: [],
          node: { core: ['tasks'], capabilities: [], secrets: false, exec: false, net: [] },
        },
        contributions: {
          frames: [{ target: 'pane', id, label: name, glyph: 'puzzle', order: 800 }],
        },
      },
      null,
      2,
    ) + '\n'
  )
}

function nodeIndex(id) {
  return `import { handle } from './routes.js'

// Relative paths and \`node:\` builtins only. An installed plugin is a bare directory with no
// node_modules beside it. A bare specifier that resolves in a dev checkout (Node walks ancestor
// directories) fails on every machine that installs this, so "it worked in dev" proves nothing.
export default {
  // Must equal the manifest id. The host binds every namespace from the manifest, so a mismatch is a
  // package that disagrees with itself and the load fails.
  name: '${id}',

  init(ctx) {
    // The portable carrier. A Hono instance cannot cross a process boundary; a
    // (Request, PluginRequestContext) => Response function can. The host strips the mount, so
    // /v2/p/${id}/greeting arrives here as /greeting.
    ctx.routes.fetch((request, context) => handle(request, context, ctx.core))
  },

  // Optional. \`ready\` runs after every plugin's init; \`dispose\` runs on unload.
  // ready(ctx) {},
  // dispose() {},
}
`
}

function nodeRoutes() {
  return `export async function handle(request, context, core) {
  const { pathname, searchParams } = new URL(request.url)

  if (request.method === 'GET' && pathname === '/greeting') {
    const taskId = searchParams.get('taskId')
    // core.tasks answers with a TaskRef projection: id, title, projectId, branch, worktreePath,
    // pullNumber, never the database row. A column rename in acorn cannot silently break you.
    const task = taskId ? await core.tasks.load(taskId) : null
    return Response.json({
      text: task ? \`Hello from \${task.title}\` : 'Hello from the node',
      who: context.userId,
    })
  }

  return new Response('not found', { status: 404 })
}
`
}

function client(id, name) {
  return `// The client half: one file, plain JavaScript, no imports.
//
// A plugin origin serves exactly four paths: /, /index.html, /ui.css and /client.js, so a second
// module, a stylesheet, an image or a font cannot be fetched. Inline them; the CSP allows
// \`img-src 'self' data:\` for exactly that. The frame also has no network at all (\`connect-src 'none'\`):
// fetch, XHR, WebSocket and EventSource all fail. Its only I/O is the MessagePort below.
//
// ── The bridge ────────────────────────────────────────────────────────────────────────────────────
// A copy of what @acorn/plugin-api/ui/sdk does for a bundled frame, which a single-file frame cannot
// import. It is yours: extend it, delete what you do not use.

const PLUGIN_BRIDGE_VERSION = 1

const pending = new Map()
const selectListeners = new Set()
let port = null
let seq = 0

const connected = new Promise((resolve, reject) => {
  addEventListener('message', (event) => {
    // No origin check to get wrong: a message with no transferred port is not the handshake, and the
    // port is unforgeable.
    if (!event.data || typeof event.data !== 'object') return
    if (event.data.acornBridge !== PLUGIN_BRIDGE_VERSION) {
      if ('acornBridge' in event.data) reject(new Error(\`acorn: unsupported bridge version \${event.data.acornBridge}\`))
      return
    }
    port = event.ports[0]
    if (!port) return
    port.onmessage = (message) => onMessage(message.data, resolve)
    port.start?.()
  })
})

function onMessage(message, resolve) {
  if (!message || typeof message !== 'object') return
  // Replies carry the id of the request they answer; everything else is a host push.
  if (typeof message.id === 'number') {
    const waiting = pending.get(message.id)
    pending.delete(message.id)
    waiting?.(message)
    return
  }
  switch (message.kind) {
    case 'ready':
      // You must post something back. The host arms a 10-second deadline when it transfers the port
      // and swaps this frame for a labelled "UI failed to start" placeholder if nothing arrives, which
      // is what a bundle that throws at module scope looks like from outside.
      port.postMessage({ kind: 'connected' })
      resolve(message.context)
      return
    case 'appearance':
      applyAppearance(message)
      return
    case 'select':
      // Every rail selection after the one that opened this pane. The first is context.item.
      for (const listener of selectListeners) listener(message.item)
      return
  }
}

// Apply it or the frame renders unthemed: the host's /ui.css classes and every var(--…) in your own
// CSS resolve against these.
function applyAppearance({ theme, style, tokens }) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.style = style
  for (const [token, value] of Object.entries(tokens)) root.style.setProperty(token, value)
}

function send(message) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (reply) => {
      // The failure arm is the same envelope every acorn HTTP route returns, so one error shape covers
      // both a call the bridge denied and one your node half refused.
      if (reply.ok) resolve(reply.body)
      else reject(new Error(\`\${reply.error.code}: \${reply.error.message}\`))
    })
    port.postMessage({ ...message, id })
  })
}

// Two budgets apply to the port, and tripping either kills it: 100 requests in flight, and 1000
// messages per 10 seconds.
const api = {
  get: (path) => send({ kind: 'api', method: 'GET', path }),
  post: (path, body) => send({ kind: 'api', method: 'POST', path, body }),
}
const ui = {
  toast: (title, detail) => send({ kind: 'ui', op: 'toast', title, detail }),
  // window.confirm and alert are suppressed and navigator.clipboard refuses to write, because this
  // document is not the focused one. Use these.
  copy: (text) => send({ kind: 'ui', op: 'copy', text }),
  openUrl: (url) => send({ kind: 'ui', op: 'openUrl', url }),
}
// Durable, host-keyed by (pluginId, key), 1 MiB per value. This, not localStorage, which is keyed by
// bundle hash and rotates on every update, is the supported channel to your node half's prefs.
const state = {
  get: (key) => send({ kind: 'state.get', key }),
  set: (key, value) => send({ kind: 'state.set', key, value }),
}

// ── Your pane ─────────────────────────────────────────────────────────────────────────────────────
// The document already exists and already links /ui.css: a module script runs after it parses. Vanilla
// DOM is the natural fit. Inside your own frame you may bundle any framework you like, but the bridge
// is the whole surface a frame has anyway.

const root = document.createElement('div')
root.style.padding = '16px'
document.body.append(root)

connected
  .then(async (context) => {
    const query = context.taskId ? \`?taskId=\${encodeURIComponent(context.taskId)}\` : ''
    const { text } = await api.get(\`/v2/p/${id}/greeting\${query}\`)

    const heading = document.createElement('h1')
    heading.textContent = text

    const button = document.createElement('button')
    button.className = 'ui-btn' // from the host's /ui.css, your frame looks native for free
    button.textContent = 'Say hello back'
    button.addEventListener('click', () => void ui.toast('${name}', 'Hello from the frame'))

    root.append(heading, button)
  })
  .catch((error) => {
    root.className = 'ui-alert'
    root.dataset.variant = 'banner'
    root.dataset.tone = 'danger'
    root.textContent = String(error)
  })
`
}

function readme(id, name) {
  return `# ${name}

An acorn plugin. No build step: these files are what runs.

\`\`\`text
acorn-plugin.json   the manifest — the only file the loader trusts about this directory
node/index.js       default-exports the NodePlugin
node/routes.js      imported with a relative specifier
client.js           one file, plain JS, no imports
\`\`\`

## Install it

**Settings → Plugins → Install**, source kind *path*, with this directory's absolute path.

A local path is **symlinked**, not copied, so you edit in place and the next boot runs what you
edited. It is allowed on development builds only — a packaged app refuses one outright. Installing
reports \`installed-restart-required\`: a plugin's routes, tables and jobs wire at init, so restart the
node (Settings → Plugins → Restart) before it is live. Then accept the bundle when the device asks —
each device asks its own owner before running client bytes, keyed by \`(pluginId, hash)\`, so rewriting
\`client.js\` re-prompts.

If an **agent** is writing this plugin, it never reaches the install route: it asks with the
\`plugin_request\` tool and you approve in the shell. Approving with \`dev: true\` turns the loop into
edit → reload instead of edit → prompt → restart. Note that a reload re-evaluates **only the entry
module**, so a change in \`node/routes.js\` still needs a restart — a plugin being iterated on hard
wants its node half in one file.

## Change it

- **A pane is one entry in \`contributions.frames\`.** Everything smaller than a rectangle — a chip, a
  badge, a menu row, a palette entry — is a descriptor you declare and the host draws, and it stays
  live when no frame of yours is mounted. Descriptors for chrome, frames for rectangles.
- **Your routes are confined to \`/v2/p/${id}/\`**, at parse time and again at runtime.
- **The id is permanent.** It is the route namespace, the renderer route prefix, the persisted layout
  key and the SQLite filename. Renaming is "new plugin, plus a data migration, plus a tombstone".
- **\`apiVersion\` must match the loading node exactly.** A mismatch is a \`failed\` roster row that says so.

The full contract is \`docs/plugin-authoring.md\` in the acorn repository. An agent should call the
\`plugin_authoring\` tool first — it answers with that guide plus the connected node's *current*
manifest vocabulary read off its own schemas, which is the only way to be sure the answer is not from
memory.
`
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

async function main(argv) {
  let requested = argv[0]
  if (!requested) {
    const { createInterface } = await import('node:readline/promises')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    requested = (await rl.question('Plugin name: ')).trim() || 'my-acorn-plugin'
    rl.close()
  }

  const id = toPluginId(requested)
  if (!id) {
    console.error(`create-acorn-plugin: "${requested}" has no usable id in it.`)
    console.error('An id is 2–32 characters of lowercase letters, digits and hyphens, starting with a letter.')
    process.exitCode = 1
    return
  }

  const dir = resolve(process.cwd(), id)
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    console.error(`create-acorn-plugin: ${dir} already exists and is not empty.`)
    process.exitCode = 1
    return
  }

  const files = scaffoldFiles(id)
  for (const [path, contents] of Object.entries(files)) {
    const target = join(dir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }

  console.log(`Created ${id}/`)
  for (const path of Object.keys(files)) console.log(`  ${path}`)
  console.log(`\nNext: cd ${id} && read README.md — it has the install steps.`)
}

// Importable from a test without running.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2))

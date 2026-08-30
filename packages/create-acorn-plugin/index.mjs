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
export const API_VERSION = '8'

/**
 * Where the manifest JSON Schema is published. Same reason as the constant above: this package is
 * published standalone. index.test.ts holds the copy against the generated artifact.
 */
export const SCHEMA_URL = 'https://acorn.sh/schemas/acorn-plugin.schema.json'

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
export function scaffoldFiles(id, name = toDisplayName(id), options = {}) {
  // A tree unless the author asked for pixels. The default is what most plugins want and the one that
  // gets the shell's keyboard handling, focus, ARIA and style pack for free; a rectangle is the
  // deliberate choice you make when the surface owns its own pixels.
  const rectangle = options.rectangle === true
  return {
    'acorn-plugin.json': manifest(id, name, rectangle),
    'node/index.js': nodeIndex(id),
    'server/routes.js': nodeRoutes(),
    'client.js': rectangle ? client(id, name) : remoteClient(id, name),
    'README.md': readme(id, name),
  }
}

function manifest(id, name, rectangle = false) {
  return (
    JSON.stringify(
      {
        // Editor completion and inline errors for every field below, from the schema generated out of
        // the host's own Zod contract (packages/protocol/src/pluginSchema.test.ts). Nothing reads it at
        // load time; it is there so a typo is a red squiggle rather than a failed boot.
        $schema: SCHEMA_URL,
        id,
        name,
        version: '0.1.0',
        apiVersion: API_VERSION,
        node: './node/index.js',
        client: './client.js',
        // `api: []` is correct, not an omission: a frame's own `/v2/p/<id>/` namespace needs no scope.
        // Add one of the six grantable scopes only when you call a core route. `core: ['tasks']` is
        // here because server/routes.js resolves a task.
        permissions: {
          api: [],
          events: [],
          node: { core: ['tasks'], capabilities: [], secrets: false, exec: false, net: [] },
        },
        contributions: rectangle
          ? {
            // A rectangle: an iframe whose pixels are yours. `single` with a `frame` region is how a
            // surface says "the host draws the box, I draw the inside".
            frames: [{
              target: 'pane', id, label: name, glyph: 'puzzle', order: 800,
              layout: 'single', regions: { body: 'frame' },
            }],
          }
          : {
            // Two of the five extension kinds, so the scaffold shows both halves of the cooperative
            // seam working (docs/plugins.md § Cooperative extension points).
            //
            // A `remote` contribution draws: your worker emits a tree of acorn's own components into a
            // slot the agents plugin opened, and `remote` is the key you registered with `mountTree`.
            // An `annotation` contribution says something true about a row somebody else drew: no UI,
            // a route the host batches keys to. Both name the owner out loud, which is the disclosure.
            extensions: [
              {
                id: `${id}.tool-card`,
                point: 'agents:tool-card',
                label: `${name} tool calls`,
                remote: 'toolCard',
                matches: ['execute'],
              },
              {
                id: `${id}.diff-note`,
                point: 'changes:diff-line',
                label: `${name} notes`,
                items: `/v2/p/${id}/marks`,
              },
            ],
          },
      },
      null,
      2,
    ) + '\n'
  )
}

function nodeIndex(id) {
  return `import { handle } from '../server/routes.js'

// Relative paths and \`node:\` builtins only. An installed plugin is a bare directory with no
// node_modules beside it. A bare specifier that resolves in a dev checkout (Node walks ancestor
// directories) fails on every machine that installs this, so "it worked in dev" proves nothing.
export default {
  // Must equal the manifest id. The host binds every namespace from the manifest, so a mismatch is a
  // package that disagrees with itself and the load fails.
  name: '${id}',

  /**
   * Typed \`ctx\` with no build step: \`npm i -D acorn-plugin-types\` and your editor reads this
   * annotation. The package is declarations only, so nothing is added to what you ship.
   *
   * @param {import('acorn-plugin-types').NodePluginContext} ctx
   */
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
  return `/**
 * One route handler. The three annotations are what carry the types across the file boundary from
 * index.js, so the whole node half checks with \`checkJs\` and nothing here has to be TypeScript.
 *
 * @param {Request} request
 * @param {import('acorn-plugin-types').PluginRequestContext} context
 * @param {import('acorn-plugin-types').CoreServices} core
 */
export async function handle(request, context, core) {
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

  // The annotation half of the scaffold's manifest: what this plugin has to say about lines of the
  // changes pane's diff. The host POSTs the keys on screen — a batch, not one call per row — and
  // wants a mark back for the ones you know something about, keyed the way the owner declared.
  // Silence is a real answer: return no items and nothing is drawn.
  if (request.method === 'POST' && pathname === '/marks') {
    const body = /** @type {{ keys?: { file: string; line: number; side: string }[] }} */ (await request.json())
    return Response.json({
      items: (body.keys ?? [])
        .filter((key) => key.line % 10 === 0)
        .map((key) => ({ key, severity: 'info', text: 'Every tenth line, from the scaffold.' })),
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
server/routes.js    imported with a relative specifier
client.js           one file, plain JS, no imports
\`\`\`

## Two ways to draw

This scaffold's \`client.js\` is a **tree**, which is the default and what most plugins want. Your code
runs in a Web Worker with no DOM at all and names acorn's own components, which the host mounts. You
give up drawing your own pixels and you get the shell's keyboard handling, focus, ARIA and the
reader's chosen style pack, for free and forever.

\`npm create acorn-plugin ${id} -- --rectangle\` emits the other one: a **frame**, a sandboxed iframe
whose pixels are yours. You write the markup and the CSS, and you get a rectangle.

Pick the rectangle when the surface owns its pixels — a chart, an image editor, a canvas. Pick the
tree for everything else.

## Types, if you want them

\`\`\`sh
npm i -D acorn-plugin-types
\`\`\`

Declarations only, no runtime, nothing to bundle. \`node/index.js\` already carries the JSDoc
annotation that picks it up, so \`ctx\` and everything under it is typed in your editor the moment the
package is installed. There is no build step either way: these files are still what runs.

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
module**, so a change in \`server/routes.js\` still needs a restart — a plugin being iterated on hard
wants its node half in one file.

## Change it

- **Descriptors for facts, trees for UI, rectangles for pixels.** A chip, a badge, a menu row or a
  palette entry is a descriptor you declare and the host draws, and it stays live when nothing of
  yours is mounted. A pane, a panel body or a settings page is a tree. A frame is for pixels the host
  cannot draw.
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

function remoteClient(id, name) {
  return `// The client half, drawing a tree instead of pixels.
//
// This bundle runs in a Web Worker: no DOM, no network, no \`importScripts\` after boot. Its only I/O
// is the two MessagePorts the host transfers on the first message — the bridge on the first, the tree
// on the second.
//
// What you build below is a description, not markup. You name one of acorn's own components and the
// host mounts that component, so what the reader gets has the shell's keyboard handling, focus rings,
// ARIA and whichever style pack they chose. Nothing here can spell a class, a colour or a pixel, and
// that is the deal: you get the shell's UI for free and you give up drawing your own.
//
// Hand-written for the same reason the frame scaffold's bridge is: a single-file plugin has nothing to
// import from. With a bundler, \`acorn-plugin-sdk\` and \`acorn-plugin-sdk/remote\` do all of this in
// fifteen lines of JSX.

const PLUGIN_BRIDGE_VERSION = 1

let treePort = null
let nodeSeq = 0
const slots = new Map()

addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return
  if (event.data.acornBridge !== PLUGIN_BRIDGE_VERSION) return
  // The bridge is ports[0] — api, state, events, toasts. Take it when you need it; this template draws
  // from its props alone. The tree channel is ports[1].
  const bridge = event.ports[0]
  if (bridge) {
    bridge.onmessage = (message) => {
      // The host arms a 10-second deadline on the bridge and shows a placeholder if nothing answers,
      // which is what a bundle that throws at module scope looks like from outside.
      if (message.data && message.data.kind === 'ready') bridge.postMessage({ kind: 'connected' })
    }
    bridge.start?.()
  }
  treePort = event.ports[1]
  if (!treePort) return
  treePort.onmessage = (message) => onTreeMessage(message.data)
  treePort.start?.()
  treePort.postMessage({ kind: 'tree:ready', version: 1, entries: ['toolCard'] })
})

function onTreeMessage(message) {
  if (!message || typeof message !== 'object') return
  switch (message.kind) {
    // A second mount for the same slot is a props update, not a new tree.
    case 'tree:mount':
      return mount(message.slot, message.props)
    case 'tree:unmount':
      slots.delete(message.slot)
      return
    case 'tree:event': {
      const slot = slots.get(message.slot)
      if (slot) {
        const handler = slot.handlers.get(message.handler)
        if (handler) handler(message.payload)
      }
      return
    }
    // Miss two of these and the host terminates this worker and shows a placeholder in every tree it
    // was serving.
    case 'tree:ping':
      treePort.postMessage({ kind: 'tree:pong' })
      return
  }
}

/** A node: the name of one of acorn's components, its props, and its children. */
function el(type, props, children) {
  return { id: 'n' + ++nodeSeq, type: type, props: props || {}, children: children || [] }
}

/** A run of text. Text is a node, never a prop. */
function text(value) {
  return el('#text', { value: String(value) })
}

function mount(slot, props) {
  const handlers = new Map()
  let handlerSeq = 0
  // A function cannot cross a port, so it crosses as an id and the host quotes the id back. Only the
  // kit's own event names carry one: onPress, onChange, onSelect and the rest. A raw key or pointer
  // handler has no name here, by design.
  const on = (fn) => {
    const id = ++handlerSeq
    handlers.set(id, fn)
    return { $handler: id }
  }

  const tool = (props && props.tool) || {}
  const tree = el('Card', {}, [
    el('Stack', { gap: 'row' }, [
      el('Badge', { tone: tool.status === 'failed' ? 'danger' : 'ok' }, [text(tool.status || 'running')]),
      el('CodeBlock', { maxHeight: 'block' }, [text(tool.output || '')]),
      el('Button', { variant: 'bare', onPress: on(() => console.log('${id}: pressed')) }, [text('${name}')]),
    ]),
  ])

  slots.set(slot, { handlers: handlers })
  // One batch, applied by the host atomically or not at all. Redrawing means sending patch, text,
  // insert, move and remove for what changed, rather than the whole tree again.
  treePort.postMessage({ kind: 'tree:batch', slot: slot, ops: [{ op: 'insert', parent: null, index: 0, node: tree }] })
}
`
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

async function main(argv) {
  // One flag, and it picks the render path. A tree by default; see docs/plugin-authoring.md § Two ways
  // to draw for when a rectangle is the right answer.
  const rectangle = argv.includes('--rectangle')
  let requested = argv.find((arg) => !arg.startsWith('--'))
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

  const files = scaffoldFiles(id, toDisplayName(id), { rectangle })
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

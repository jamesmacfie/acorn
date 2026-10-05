#!/usr/bin/env node
// `npm create acorn-plugin`: the front door for an author with no checkout of this repository. See
// docs/plugin-authoring/start-from-the-scaffold.md for the no-bundler profile, and for why the
// emitted bridge is a copy rather than a dependency.
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The plugin API major this scaffold writes into `apiVersion`. Hardcoded because this package is
 * published standalone and can't import the constant. The scaffold tests compare it with the host.
 */
export const API_VERSION = '3'
export const BASELINE = 'acorn-1'

/**
 * Where the manifest JSON Schema is published. Same reason as the constant above: this package is
 * published standalone. index.test.ts holds the copy against the generated artifact.
 */
export const SCHEMA_URL = 'https://acorn.sh/schemas/acorn-plugin.schema.json'

/** Manifest ids: `/^[a-z][a-z0-9-]{1,31}$/`. See docs/plugin-authoring/the-manifest.md § The manifest for the
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
  if (options.dataSource) return dataSourceFiles(id, name, options.dataSource)
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
        version: '1.0.0',
        baseline: BASELINE,
        apiVersion: API_VERSION,
        node: './node/index.js',
        client: './client.js',
        // `api: []` is correct, not an omission: a frame's own `/v1/p/<id>/` namespace needs no scope.
        // Add a grantable scope only when you call a core route. The starter's route resolves a task.
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
            commands: [{
              id: 'open', kind: 'action', title: `Open ${name}`, category: 'pane',
              action: { verb: 'openPane', pane: id },
            }],
          }
          : {
            // The starter owns a pane, so its UI can be opened without another plugin's context.
            frames: [{
              target: 'pane', id, label: name, glyph: 'puzzle', order: 800,
              layout: 'single', regions: { body: { kind: 'remote', entry: 'pane' } },
            }],
            commands: [{
              id: 'open', kind: 'action', title: `Open ${name}`, category: 'pane',
              action: { verb: 'openPane', pane: id },
            }],
          },
      },
      null,
      2,
    ) + '\n'
  )
}

function nodeIndex(id) {
  return `import { handle } from '../server/routes.js'

// Development reload starts a fresh worker and re-evaluates imported modules too.
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
    // A stderr line with your plugin id on it, and a telemetry log record when the owner has
    // collection on. Prefer it to \`console\`: the id is bound by the host, the message is scrubbed,
    // and a sink can see it. \`ctx.telemetry\` beside it carries events, counts, gauges and spans.
    ctx.log.info('starting')

    // The portable carrier. A Hono instance cannot cross a process boundary; a
    // (Request, PluginRequestContext) => Response function can. The host strips the mount, so
    // /v1/p/${id}/greeting arrives here as /greeting.
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
 * @param {Request} request
 * @param {import('acorn-plugin-types').PluginRequestContext} context
 * @param {import('acorn-plugin-types').CoreServices} core
 */
export async function handle(request, context, core) {
  const { pathname, searchParams } = new URL(request.url)
  if (request.method !== 'GET' || pathname !== '/greeting') {
    return new Response('not found', { status: 404 })
  }

  // Core returns a TaskRef projection, not a database row.
  const taskId = searchParams.get('taskId')
  const task = taskId ? await core.tasks.load(taskId) : null
  return Response.json({
    text: task ? \`Hello from \${task.title}\` : 'Hello from the node',
    who: context.userId,
  })
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
    const { text } = await api.get(\`/v1/p/${id}/greeting\${query}\`)

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
server/routes.js    owns the starter route
client.js           one file, plain JS, no imports
\`\`\`

## Two ways to draw

This scaffold's \`client.js\` is a **tree**, which is the default and what most plugins want. Your code
runs in a Web Worker with no DOM at all and names acorn's own components, which the host mounts. You
give up drawing your own pixels and you get the shell's keyboard handling, focus, ARIA and the
reader's chosen style pack, for free and forever.

Open a task, then run **Open ${name}** from the command palette to show the starter pane. Its button
calls \`/v1/p/${id}/greeting\` through the bridge and updates the tree with the Node's answer.

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
edited. Installing reports \`installed-restart-required\`: a plugin's routes, tables and jobs wire at
init, so restart the node (Settings → Plugins → Restart) before it is live. Then accept the bundle when the device asks —
each device asks its own owner before running client bytes, keyed by \`(pluginId, hash)\`, so rewriting
\`client.js\` re-prompts.

If an **agent** is writing this plugin, it never reaches the install route: it asks with the
\`plugin_request\` tool and you approve in the shell. Approving with \`dev: true\` turns the loop into
edit → reload instead of edit → prompt → restart. Reload starts a fresh Node worker, so edits to
\`node/index.js\` or \`server/routes.js\` take effect together.

## Change it

- **Descriptors for facts, trees for UI, rectangles for pixels.** A chip, a badge, a menu row or a
  palette entry is a descriptor you declare and the host draws, and it stays live when nothing of
  yours is mounted. A pane, a panel body or a settings page is a tree. A frame is for pixels the host
  cannot draw.
- **Your routes are confined to \`/v1/p/${id}/\`**, at parse time and again at runtime.
- **The id is permanent.** It is the route namespace, the renderer route prefix, the persisted layout
  key and the SQLite filename. Renaming is "new plugin, plus a data migration, plus a tombstone".
- **\`apiVersion\` must cover the loading node's major.** \`"3"\` covers major 3; a tested plugin can
  declare a range such as \`"2 || 3"\`. A range that excludes the host is a \`failed\` roster row.

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
  const bootstrap = event.ports[0]
  if (bootstrap) {
    // This port only acknowledges worker startup. Each mounted pane gets its own scoped bridge below.
    bootstrap.onmessage = (message) => {
      if (message.data?.kind === 'ready') bootstrap.postMessage({ kind: 'connected' })
    }
    bootstrap.start?.()
  }
  treePort = event.ports[1]
  if (!treePort) return
  treePort.onmessage = (message) => onTreeMessage(message.data)
  treePort.start?.()
  treePort.postMessage({ kind: 'tree:ready', version: 1, entries: ['pane'], scopedBridge: true })
})

function connectBridge(port) {
  let requestSeq = 0
  let closed = false
  const pending = new Map()
  port.onmessage = (event) => {
    if (closed) return
    const message = event.data
    if (!message || typeof message !== 'object') return
    if (message.kind === 'ready') port.postMessage({ kind: 'connected' })
    if (typeof message.id === 'number') {
      const waiting = pending.get(message.id)
      pending.delete(message.id)
      if (waiting) {
        if (message.ok) waiting.resolve(message.body)
        else waiting.reject(new Error(\`\${message.error.code}: \${message.error.message}\`))
      }
    }
  }
  port.start?.()
  const cancelPending = () => {
    for (const waiting of pending.values()) waiting.reject(new Error('Bridge disconnected'))
    pending.clear()
  }
  return {
    get: (path) => new Promise((resolve, reject) => {
      if (closed) return reject(new Error('Bridge disconnected'))
      const id = ++requestSeq
      pending.set(id, { resolve, reject })
      port.postMessage({ kind: 'api', method: 'GET', path, id })
    }),
    cancelPending,
    close: () => {
      if (closed) return
      closed = true
      cancelPending()
      port.onmessage = null
      port.close()
    },
  }
}

function onTreeMessage(message) {
  if (!message || typeof message !== 'object') return
  switch (message.kind) {
    // A second mount for the same slot is a props update, not a new tree.
    case 'tree:mount':
      return mount(message.slot, message.props, message.context, message.bridgePort)
    case 'tree:unmount': {
      const mounted = slots.get(message.slot)
      if (mounted) {
        mounted.active = false
        mounted.bridge.close()
      }
      slots.delete(message.slot)
      return
    }
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

function mount(slot, props, context, bridgePort) {
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

  const previous = slots.get(slot)
  if (previous) {
    previous.active = false
    if (bridgePort) previous.bridge.close()
    else previous.bridge.cancelPending()
  }
  const bridge = bridgePort ? connectBridge(bridgePort) : previous?.bridge
  const mountedContext = context ?? previous?.context
  if (!bridge) {
    treePort.postMessage({ kind: 'tree:failed', slot, message: 'Pane has no scoped bridge' })
    return
  }
  const mounted = { active: true, handlers, rootId: '', bridge, context: mountedContext }

  const greeting = text('Ask the Node for a greeting')
  const showGreeting = (value) => {
    if (!mounted.active || slots.get(slot) !== mounted) return
    treePort.postMessage({ kind: 'tree:batch', slot, ops: [{ op: 'text', id: greeting.id, value }] })
  }
  const tree = el('Card', {}, [
    el('Stack', { gap: 'row' }, [
      el('Heading', {}, [text('${name}')]),
      greeting,
      el('Button', { variant: 'solid', onPress: on(() => {
        const query = mountedContext?.taskId ? \`?taskId=\${encodeURIComponent(mountedContext.taskId)}\` : ''
        void bridge.get(\`/v1/p/${id}/greeting\${query}\`)
          .then((body) => showGreeting(body.text))
          .catch((error) => showGreeting(String(error)))
      }) }, [text('Say hello')]),
    ]),
  ])

  mounted.rootId = tree.id
  slots.set(slot, mounted)
  // The host applies a batch atomically. Replace the root if the same slot mounts with new props.
  treePort.postMessage({
    kind: 'tree:batch', slot,
    ops: [
      ...(previous ? [{ op: 'remove', id: previous.rootId }] : []),
      { op: 'insert', parent: null, index: 0, node: tree },
    ],
  })
}
`
}

// ── The data source template ─────────────────────────────────────────────────────────────────────
// `--data-source` writes a derived source: a plugin whose node half builds records from sources acorn
// already reads. See docs/plugin-authoring/derived-sources.md.

/**
 * The SDK release that has `acorn-plugin-sdk/data` and `/testing`. Hardcoded for the same reason as
 * API_VERSION; index.test.ts compares it with the SDK's own version.
 */
export const SDK_VERSION = '1.1.0'

/**
 * The built-in and first-party sources a derived source can read, with the field that names a record.
 * A copy, because this package has no dependencies. index.test.ts holds it to the SDK's field lists.
 */
export const KNOWN_SOURCES = [
  { source: 'agents:sessions', name: 'Managed agent sessions', title: 'title' },
  { source: 'agents:usage-records', name: 'Agent usage records' },
  { source: 'core:local-branches', name: 'Local branches', title: 'name' },
  { source: 'core:local-worktrees', name: 'Local worktrees', title: 'path' },
  { source: 'core:tasks', name: 'Workspace tasks', title: 'title' },
  { source: 'github:actions-jobs', name: 'GitHub Actions jobs', title: 'job' },
  { source: 'github:local-branches', name: 'Local branches with pull requests', title: 'name' },
  { source: 'github:pull-requests', name: 'GitHub pull requests', title: 'title' },
  { source: 'linear:issues', name: 'Linear issues', title: 'title' },
  { source: 'rollbar:error-groups', name: 'Rollbar error groups', title: 'title' },
]

/** An input name from a source id: `github:pull-requests` → `pullRequests`. */
export function toInputName(source, taken = new Set()) {
  const words = source.slice(source.indexOf(':') + 1).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  let base = words.map((word, index) => (index ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join('').slice(0, 28)
  if (!/^[a-z]/.test(base)) base = `input${base}`
  let name = base
  for (let count = 2; taken.has(name); count++) name = `${base}${count}`
  taken.add(name)
  return name
}

/** `<pluginId>:<sourceId>`, with nothing that could break out of a string in the generated code. */
export const SOURCE_REF = /^[a-z][a-z0-9-]{1,31}:[A-Za-z0-9._:-]{1,200}$/

const plural = (word) => /(s|x|ch|sh)$/i.test(word) ? `${word}es` : /[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`
const literal = (text) => `'${text.replace(/[\\']/g, '\\$&')}'`
const read = (key) => /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${literal(key)}]`

/**
 * `row` is what one record represents, such as "Issue". `inputs` lists `{ source, optional? }`, the
 * first of them required: the starter returns one row per record of it.
 */
export function dataSourceFiles(id, name, { row, inputs }) {
  if (!inputs.length || inputs[0].optional) throw new Error('A derived source reads at least one source, and the first is required')
  const bad = inputs.find((input) => !SOURCE_REF.test(input.source))
  if (bad) throw new Error(`"${bad.source}" isn't a source id. Write it as <pluginId>:<sourceId>.`)
  const taken = new Set()
  const named = inputs.map((input) => {
    const known = KNOWN_SOURCES.find((candidate) => candidate.source === input.source)
    return { ...input, name: toInputName(input.source, taken), label: known?.name ?? input.source, known }
  })
  const definition = {
    sourceId: id, name, singular: row, plural: plural(row), identityScope: 'Built from its inputs', handler: `/v1/p/${id}/source`,
    titlePointer: '/title',
    inputs: Object.fromEntries(named.map((input) => [input.name, { source: input.source, label: input.label, ...(input.optional ? { optional: true } : {}) }])),
  }
  return {
    'acorn-plugin.json': JSON.stringify({
      $schema: SCHEMA_URL, id, name, version: '1.0.0', baseline: BASELINE, apiVersion: API_VERSION,
      node: './dist/node.js',
      permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } },
      // `npm run build` rewrites this entry from src/source.ts, so the two can't disagree.
      contributions: { dataSources: [definition] },
    }, null, 2) + '\n',
    'package.json': JSON.stringify({
      name: id, version: '1.0.0', private: true, type: 'module',
      scripts: { build: 'vite build && node scripts/manifest.mjs', test: 'vitest run' },
      devDependencies: { 'acorn-plugin-sdk': `^${SDK_VERSION}`, 'acorn-plugin-types': '^1.0.0', vite: '^8.0.16', vitest: '^4.1.11' },
    }, null, 2) + '\n',
    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2023', 'DOM'], strict: true, noEmit: true, skipLibCheck: true },
      include: ['src'],
    }, null, 2) + '\n',
    'vite.config.ts': dataSourceViteConfig(),
    'scripts/manifest.mjs': dataSourceManifestScript(),
    'src/index.ts': dataSourceIndex(id),
    'src/source.ts': dataSourceModule(definition, named),
    'src/source.test.ts': dataSourceTest(row, named),
    'README.md': dataSourceReadme(id, name, row, named),
  }
}

function dataSourceViteConfig() {
  return `import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

// The node half, as one ESM file with every dependency inlined. An installed plugin is a bare
// directory with no node_modules beside it, so a bare import left in the bundle fails on every
// machine but this one.
export default defineConfig({
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: 'src/index.ts',
      external: (id) => builtinModules.includes(id.replace(/^node:/, '')),
      output: { format: 'es', entryFileNames: 'node.js', codeSplitting: false },
    },
  },
})
`
}

function dataSourceManifestScript() {
  return `// The build's last step: rewrite the manifest's data source entry from the built source, so the
// inputs acorn asks the person to approve are the ones the code reads.
import { readFileSync, writeFileSync } from 'node:fs'
import { derivedSourceManifest } from 'acorn-plugin-sdk/data'
import { source } from '../dist/node.js'

const manifest = JSON.parse(readFileSync('acorn-plugin.json', 'utf8'))
manifest.contributions = { ...manifest.contributions, dataSources: [derivedSourceManifest(source)] }
writeFileSync('acorn-plugin.json', JSON.stringify(manifest, null, 2) + '\\n')
`
}

function dataSourceIndex(id) {
  return `import type { NodePlugin } from 'acorn-plugin-types'
import { source } from './source'

// scripts/manifest.mjs reads the source from the build to write the manifest entry.
export { source }

export default {
  // Must equal the manifest id.
  name: '${id}',
  init(ctx) {
    // The source owns the whole /v1/p/${id}/ namespace, which is where the manifest's handler points.
    ctx.routes.fetch(source.fetch)
  },
} satisfies NodePlugin
`
}

function dataSourceModule(definition, inputs) {
  const [first, ...rest] = inputs
  const title = first.known?.title
  const inputLines = inputs.map((input) =>
    `    ${input.name}: { source: ${literal(input.source)}, label: ${literal(input.label)}${input.optional ? ', optional: true' : ''} },`)
  const reads = rest.map((input) => input.optional
    ? `    // Optional, so it's undefined when the person skipped it.\n    const ${input.name} = await inputs.${input.name}?.all()\n`
    : `    const ${input.name} = await inputs.${input.name}.all()\n`)
  return `import { defineDerivedSource, field } from 'acorn-plugin-sdk/data'

export const source = defineDerivedSource({
  id: ${literal(definition.sourceId)},
  name: ${literal(definition.name)},
  singular: ${literal(definition.singular)},
  plural: ${literal(definition.plural)},
  handler: ${literal(definition.handler)},
  // Acorn reads these for you, with the accounts the person picks for each panel.
  inputs: {
${inputLines.join('\n')}
  },
  // What one row carries. Add a field here, then set it in every record below.
  fields: {
    title: field.text({ label: ${literal(definition.singular)}, role: 'title' }),
  },
  // One row per record of ${first.label}. Replace this with your own rules.
  async query({ inputs }) {
    const { records } = await inputs.${first.name}.all()
${reads.join('')}    return records.map((record) => ({
      id: record.ref.recordId,
      // Pressing the row opens the record it came from.
      opens: record.ref,
      data: { title: String(${title ? `record.data${read(title)} ?? ` : ''}record.ref.recordId) },
    }))
  },
})
`
}

function dataSourceTest(row, inputs) {
  // A known source's records come from its real field list. Another plugin's source has no list in
  // the SDK, so its records are written out.
  const records = (input, count) => {
    const values = Array.from({ length: count }, (_, index) => `${input.label} ${index + 1}`)
    if (!input.known) {
      const [pluginId] = input.source.split(':')
      const sourceId = input.source.slice(pluginId.length + 1)
      return `[${values.map((value, index) => `{ ref: { pluginId: ${literal(pluginId)}, sourceId: ${literal(sourceId)}, recordId: '${index + 1}' }, data: { title: ${literal(value)} } }`).join(', ')}]`
    }
    const key = input.known.title
    const prop = key && (/^[A-Za-z_$][\w$]*$/.test(key) ? key : literal(key))
    return `fixtures(${literal(input.source)}, [${values.map((value) => (prop ? `{ ${prop}: ${literal(value)} }` : '{}')).join(', ')}])`
  }
  const [first, ...rest] = inputs
  return `import { expect, it } from 'vitest'
import { fixtures, testDerivedSource } from 'acorn-plugin-sdk/testing'
import { source } from './source'

// \`fixtures\` builds records from each source's real fields, so a typo in a field name fails here
// the way it would in the app.
it(${literal(`returns one ${row.toLowerCase()} per record of ${first.label}`)}, async () => {
  const result = await testDerivedSource(source, {
${[`    ${first.name}: ${records(first, 2)},`, ...rest.map((input) => `    ${input.name}: ${records(input, 1)},`)].join('\n')}
  })
  expect(result.rows).toHaveLength(2)
  expect(result.dropped).toEqual([])
})
`
}

function dataSourceReadme(id, name, row, inputs) {
  return `# ${name}

An acorn plugin with one derived source: rows built by your own logic from data acorn already reads.
Each row is one ${row.toLowerCase()}.

\`\`\`text
acorn-plugin.json      the manifest, with the data source and the inputs it reads
src/source.ts          the source: its inputs, its fields, and the logic that builds each row
src/source.test.ts     a test of that logic against realistic records
src/index.ts           the node entry, which serves the source
scripts/manifest.mjs   rewrites the manifest's source entry from src/source.ts on each build
\`\`\`

It reads:

${inputs.map((input) => `- \`${input.name}\`: ${input.label} (\`${input.source}\`)${input.optional ? ', optional' : ''}`).join('\n')}

## Build and test

\`\`\`sh
npm install
npm test
npm run build
\`\`\`

## Install it

**Settings › Plugins › Install… › Local folder**, with this directory. Acorn asks you to approve what
the plugin reads before it reads anything. Then pick it as a source in a panel, and choose an account
for each input.

The full guide is \`docs/plugin-authoring/derived-sources.md\` in the acorn repository.
`
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

async function main(argv) {
  // `--rectangle` picks the render path. A tree by default; see docs/plugin-authoring/the-client-half.md § Two ways
  // to draw for when a rectangle is the right answer. `--data-source` writes a derived source instead.
  const rectangle = argv.includes('--rectangle')
  const wantsDataSource = argv.includes('--data-source')
  // Opened only when there's something to ask. Answers come off the line iterator rather than
  // `question`, so answers piped in ahead of the prompts aren't dropped.
  let rl
  let lines
  const ask = async (prompt) => {
    if (!rl) {
      const { createInterface } = await import('node:readline')
      rl = createInterface({ input: process.stdin, output: process.stdout })
      lines = rl[Symbol.asyncIterator]()
    }
    process.stdout.write(prompt)
    const { value, done } = await lines.next()
    return done ? '' : String(value).trim()
  }
  let requested = argv.find((arg) => !arg.startsWith('--'))
  let dataSource
  try {
    if (!requested) requested = (await ask('Plugin name: ')) || 'my-acorn-plugin'
    if (wantsDataSource) dataSource = await askDataSource(ask)
  } finally {
    rl?.close()
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

  const files = scaffoldFiles(id, toDisplayName(id), { rectangle, dataSource })
  for (const [path, contents] of Object.entries(files)) {
    const target = join(dir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }

  console.log(`Created ${id}/`)
  for (const path of Object.keys(files)) console.log(`  ${path}`)
  console.log(`\nNext: cd ${id} && read README.md — it has the install steps.`)
}

/** The three questions behind `--data-source`. A source can be picked by number or typed as an id. */
async function askDataSource(ask) {
  const row = (await ask('What does one row represent? (for example, Issue): ')) || 'Row'
  console.log('\nSources acorn reads:')
  KNOWN_SOURCES.forEach((known, index) => console.log(`  ${index + 1}. ${known.name} (${known.source})`))
  const pick = (answer) => answer.split(',').map((part) => part.trim()).filter(Boolean)
    .map((part) => KNOWN_SOURCES[Number(part) - 1]?.source ?? part)
  const reads = pick(await ask('Which does it read? Numbers or <pluginId>:<sourceId>, separated by commas. The first is required: '))
  if (!reads.length || reads.some((source) => !SOURCE_REF.test(source))) throw new Error('Name at least one source, as a number from the list or as <pluginId>:<sourceId>.')
  const optional = new Set(reads.length > 1 ? pick(await ask('Which of the others are optional? (none): ')) : [])
  return { row, inputs: reads.map((source, index) => ({ source, ...(index && optional.has(source) ? { optional: true } : {}) })) }
}

// Importable from a test without running.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main(process.argv.slice(2))

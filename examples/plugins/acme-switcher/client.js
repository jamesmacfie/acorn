// ── Plumbing ─────────────────────────────────────────────────────────────────────────────────────
// The handshake, the bridge, and the tree channel, the same code `npm create acorn-plugin` writes,
// with two additions: a table of entries, so one bundle draws several trees, and `draw`, which draws a
// slot again from scratch when its data changes. The trees this plugin draws start at `ENTRIES` below.
//
// This bundle runs in a Web Worker: no DOM, no network, no `importScripts` after boot. Its only I/O is
// the ports the host transfers: a bootstrap bridge and the tree channel on the first message, then a
// bridge per mounted tree, scoped to that tree's task or project.

const PLUGIN_BRIDGE_VERSION = 1

let treePort = null
let nodeSeq = 0
const slots = new Map()

addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return
  if (event.data.acornBridge !== PLUGIN_BRIDGE_VERSION) return
  const bootstrap = event.ports[0]
  if (bootstrap) {
    bootstrap.onmessage = (message) => {
      if (message.data?.kind === 'ready') bootstrap.postMessage({ kind: 'connected' })
    }
    bootstrap.start?.()
  }
  treePort = event.ports[1]
  if (!treePort) return
  treePort.onmessage = (message) => onTreeMessage(message.data)
  treePort.start?.()
  treePort.postMessage({ kind: 'tree:ready', version: 1, entries: Object.keys(ENTRIES), scopedBridge: true })
})

/** One mounted tree's bridge: `get`, `post`, and `put` reach your own routes, and `ui` asks the host for
 *  one of its effects, such as `{ op: 'toast', title }`. Each returns a promise of the answer. */
function connectBridge(port) {
  let requestSeq = 0
  let closed = false
  const pending = new Map()
  port.onmessage = (event) => {
    const message = event.data
    if (closed || !message || typeof message !== 'object') return
    if (message.kind === 'ready') port.postMessage({ kind: 'connected' })
    const waiting = typeof message.id === 'number' ? pending.get(message.id) : undefined
    if (!waiting) return
    pending.delete(message.id)
    if (message.ok) waiting.resolve(message.body)
    else waiting.reject(new Error(`${message.error.code}: ${message.error.message}`))
  }
  port.start?.()
  const send = (request) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new Error('Bridge disconnected'))
      const id = ++requestSeq
      pending.set(id, { resolve, reject })
      port.postMessage({ ...request, id })
    })
  const api = (method) => (path, body) => send({ kind: 'api', method, path, ...(body === undefined ? {} : { body }) })
  return {
    get: api('GET'),
    post: api('POST'),
    put: api('PUT'),
    ui: (effect) => send({ kind: 'ui', ...effect }),
    close: () => {
      if (closed) return
      closed = true
      for (const waiting of pending.values()) waiting.reject(new Error('Bridge disconnected'))
      pending.clear()
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
      return mount(message.slot, message.entry, message.props, message.context, message.bridgePort)
    case 'tree:unmount':
      slots.get(message.slot)?.bridge.close()
      slots.delete(message.slot)
      return
    case 'tree:event':
      slots.get(message.slot)?.handlers.get(message.handler)?.(message.payload)
      return
    // Miss two of these and the host ends this worker and shows a placeholder in every tree it served.
    case 'tree:ping':
      treePort.postMessage({ kind: 'tree:pong' })
      return
  }
}

/** A node: the name of one of acorn's components, its props, and its children. A prop that's
 *  `undefined` is left out, because the host refuses a whole batch that holds one. */
function el(type, props, children) {
  const defined = Object.entries(props || {}).filter(([, value]) => value !== undefined)
  return { id: 'n' + ++nodeSeq, type, props: Object.fromEntries(defined), children: children || [] }
}

/** A run of text. Text is a node, never a prop. */
function text(value) {
  return el('#text', { value: String(value) })
}

function mount(slot, entry, props, context, bridgePort) {
  const previous = slots.get(slot)
  if (previous && bridgePort) previous.bridge.close()
  const bridge = bridgePort ? connectBridge(bridgePort) : previous?.bridge
  if (!bridge || !ENTRIES[entry]) {
    treePort.postMessage({ kind: 'tree:failed', slot, message: bridge ? `No entry named ${entry}` : 'No scoped bridge' })
    return
  }
  const mounted = previous ?? { entry, rootId: null, handlers: new Map(), handlerSeq: 0, requestSeq: 0 }
  Object.assign(mounted, { props: props || {}, context: context || previous?.context || {}, bridge })
  slots.set(slot, mounted)
  draw(slot)
}

/** Draws a slot's entry again and replaces what it drew before, in one batch the host applies whole. */
function draw(slot) {
  const mounted = slots.get(slot)
  if (!mounted) return
  // A function can't cross a port, so it crosses as an id the host quotes back. Only the kit's own
  // event names carry one: onPress, onChange, onSelect, and the rest.
  mounted.handlers.clear()
  const on = (handler) => {
    const id = ++mounted.handlerSeq
    mounted.handlers.set(id, handler)
    return { $handler: id }
  }
  // Asks the tree's owner to run one of the actions its extension point declares, such as `show`.
  const invoke = (name, payload) => {
    const id = ++mounted.requestSeq
    treePort.postMessage({ kind: 'tree:host-request', slot, id, op: 'owner.invoke', name, payload })
  }
  const { props, context, bridge } = mounted
  const tree = ENTRIES[mounted.entry]({ props, context, bridge, on, invoke, redraw: () => draw(slot) })
  const ops = mounted.rootId ? [{ op: 'remove', id: mounted.rootId }] : []
  treePort.postMessage({ kind: 'tree:batch', slot, ops: [...ops, { op: 'insert', parent: null, index: 0, node: tree }] })
  mounted.rootId = tree.id
}
// ── End of plumbing ──────────────────────────────────────────────────────────────────────────────

// ── The tree ───────────────────────────────────────────────────────────────────────────────────────

// A marker's tone, as the tone of the dot that draws it.
const DOT_TONES = { neutral: 'muted', accent: 'accent', warn: 'warn', danger: 'danger' }

const ENTRIES = {
  // #region switcher
  // The task's panes as a list of labeled rows, in place of acorn's column of icons. The props are
  // the host's data: `panes`, `task`, and `maximized`. Changing anything goes through a named host
  // action, so this tree never touches the layout itself.
  switcher({ props, on, invoke }) {
    const panes = props.panes ?? []
    return el('ListColumn', { label: props.task?.title ?? 'Panes' }, [
      ...panes.map((pane) =>
        el(
          'Row',
          {
            density: 'compact',
            selected: pane.shown,
            meta: pane.shortcut,
            // `show` brings a pane into the row, or focuses it when it's already there.
            onPress: on(() => invoke('show', pane.id)),
          },
          [
            text(pane.label),
            // Status marks other plugins put on the pane, through `core:pane`.
            ...pane.markers.map((marker) => el('StatusDot', { tone: DOT_TONES[marker.tone] ?? 'muted', label: marker.label })),
          ],
        ),
      ),
      el('Button', { size: 'sm', onPress: on(() => invoke('equalize')) }, [text('Equal widths')]),
    ])
  },
  // #endregion
}

// The client half, drawing a tree instead of pixels.
//
// This bundle runs in a Web Worker: no DOM, no network, no `importScripts` after boot. Its only I/O
// is the two MessagePorts the host transfers on the first message — the bridge on the first, the tree
// on the second.
//
// What you build below is a description, not markup. You name one of acorn's own components and the
// host mounts that component, so what the reader gets has the shell's keyboard handling, focus rings,
// ARIA and whichever style pack they chose. Nothing here can spell a class, a colour or a pixel, and
// that is the deal: you get the shell's UI for free and you give up drawing your own.
//
// Hand-written for the same reason the frame scaffold's bridge is: a single-file plugin has nothing to
// import from. With a bundler, `acorn-plugin-sdk` and `acorn-plugin-sdk/remote` do all of this in
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
        else waiting.reject(new Error(`${message.error.code}: ${message.error.message}`))
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

/** A node: the name of one of acorn's components, its props, and its children. A prop that's
 *  `undefined` is left out, because the host refuses a whole batch that holds one. */
function el(type, props, children) {
  const defined = Object.entries(props || {}).filter(([, value]) => value !== undefined)
  return { id: 'n' + ++nodeSeq, type: type, props: Object.fromEntries(defined), children: children || [] }
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

  // #region tree
  const greeting = text('Ask the Node for a greeting')
  const showGreeting = (value) => {
    if (!mounted.active || slots.get(slot) !== mounted) return
    treePort.postMessage({ kind: 'tree:batch', slot, ops: [{ op: 'text', id: greeting.id, value }] })
  }
  // Calls one of this plugin's own routes and shows the `text` it answers.
  const ask = (route) => {
    const query = mountedContext?.taskId ? `?taskId=${encodeURIComponent(mountedContext.taskId)}` : ''
    void bridge.get(`/v1/p/hello-pane/${route}${query}`)
      .then((body) => showGreeting(body.text))
      .catch((error) => showGreeting(String(error)))
  }
  const tree = el('Card', {}, [
    el('Stack', { gap: 'row' }, [
      el('Heading', {}, [text('Hello pane')]),
      el('Text', { emphasis: 'muted' }, [text('A tree of acorn components, drawn by the host.')]),
      el('Text', {}, [greeting]),
      el('Inline', { gap: 'inline' }, [
        el('Button', { variant: 'solid', onPress: on(() => ask('greeting')) }, [text('Say hello')]),
        el('Button', { onPress: on(() => ask('branch')) }, [text('Which branch?')]),
      ]),
    ]),
  ])
  // #endregion

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

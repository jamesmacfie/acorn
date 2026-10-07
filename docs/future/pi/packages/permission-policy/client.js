// The policy's note inside a pending request card (`agents:request-card`), drawn as a tree of acorn's
// own components.
//
// Hand-written, from the advisor's tree client, because this package has no build step. It runs in a
// Web Worker. The card gives it the request's identity, it asks its node half whether the rules warned
// about that request, and it draws the warning or nothing. The card's buttons stay the host's.

const PLUGIN_BRIDGE_VERSION = 1
const ROUTE = '/v1/p/acorn-permission-policy/warning'

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
  treePort.postMessage({ kind: 'tree:ready', version: 1, entries: ['warning'], scopedBridge: true })
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
        else waiting.reject(new Error(message.error?.message ?? 'Request failed'))
      }
    }
  }
  port.start?.()
  return {
    get: (path) => new Promise((resolve, reject) => {
      if (closed) return reject(new Error('Bridge disconnected'))
      const id = ++requestSeq
      pending.set(id, { resolve, reject })
      port.postMessage({ kind: 'api', method: 'GET', path, id })
    }),
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
    case 'tree:mount':
      return mount(message.slot, message.bridgePort, message.props)
    case 'tree:unmount': {
      slots.get(message.slot)?.bridge.close()
      slots.delete(message.slot)
      return
    }
    case 'tree:ping':
      treePort.postMessage({ kind: 'tree:pong' })
  }
}

const el = (type, props, children) => ({ id: 'n' + ++nodeSeq, type, props: props || {}, children: children || [] })

function mount(slot, bridgePort, props) {
  const previous = slots.get(slot)
  if (previous && bridgePort) previous.bridge.close()
  const bridge = bridgePort ? connectBridge(bridgePort) : previous?.bridge
  if (!bridge) {
    treePort.postMessage({ kind: 'tree:failed', slot, message: 'The warning has no scoped bridge' })
    return
  }
  const key = `${props?.sessionId}:${props?.requestId}`
  // A props update for the same request changes nothing this note reads.
  if (previous?.key === key && !bridgePort) return
  const mounted = { bridge, key, rootId: previous?.rootId ?? '' }
  slots.set(slot, mounted)
  const query = `?sessionId=${encodeURIComponent(props?.sessionId ?? '')}&requestId=${encodeURIComponent(props?.requestId ?? '')}`
  void bridge.get(ROUTE + query).then(({ warning }) => {
    if (slots.get(slot) !== mounted) return
    const ops = mounted.rootId ? [{ op: 'remove', id: mounted.rootId }] : []
    mounted.rootId = ''
    if (warning) {
      const node = el('Alert', { tone: 'warn', title: 'Permission policy' }, [el('#text', { value: String(warning) })])
      mounted.rootId = node.id
      ops.push({ op: 'insert', parent: null, index: 0, node })
    }
    if (ops.length) treePort.postMessage({ kind: 'tree:batch', slot, ops })
  }, () => undefined)
}

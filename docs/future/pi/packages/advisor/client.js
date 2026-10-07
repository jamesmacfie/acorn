// The advisor's settings page, drawn as a tree of acorn's own components.
//
// Hand-written, from the scaffold's tree client (`npm create acorn-plugin`), because this package has
// no build step. It runs in a Web Worker and talks only over the two ports the host hands it: the
// bridge, for this plugin's own routes, and the tree. The page re-draws whole on every change; it's a
// handful of rows.

const PLUGIN_BRIDGE_VERSION = 1
const ROUTE = '/v1/p/acorn-advisor/settings'

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
  treePort.postMessage({ kind: 'tree:ready', version: 1, entries: ['settings'], scopedBridge: true })
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
        else waiting.reject(new Error(message.error.message))
      }
    }
  }
  port.start?.()
  const call = (method, path, body) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('Bridge disconnected'))
    const id = ++requestSeq
    pending.set(id, { resolve, reject })
    port.postMessage({ kind: 'api', method, path, id, ...(body === undefined ? {} : { body }) })
  })
  return {
    get: (path) => call('GET', path),
    put: (path, body) => call('PUT', path, body),
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
      return mount(message.slot, message.bridgePort)
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
      const handler = slots.get(message.slot)?.handlers.get(message.handler)
      if (handler) handler(message.payload)
      return
    }
    case 'tree:ping':
      treePort.postMessage({ kind: 'tree:pong' })
  }
}

function el(type, props, children) {
  return { id: 'n' + ++nodeSeq, type, props: props || {}, children: children || [] }
}

function text(value) {
  return el('#text', { value: String(value) })
}

const OUTCOMES = {
  delivered: 'Sent to the agent',
  recorded: 'Recorded only',
  suppressed: 'Dropped as a repeat',
}

function mount(slot, bridgePort) {
  const previous = slots.get(slot)
  if (previous) {
    previous.active = false
    if (bridgePort) previous.bridge.close()
  }
  const bridge = bridgePort ? connectBridge(bridgePort) : previous?.bridge
  if (!bridge) {
    treePort.postMessage({ kind: 'tree:failed', slot, message: 'Settings page has no scoped bridge' })
    return
  }
  const mounted = { active: true, handlers: new Map(), rootId: previous?.rootId ?? '', bridge }
  slots.set(slot, mounted)
  let handlerSeq = 0
  const on = (fn) => {
    const id = ++handlerSeq
    mounted.handlers.set(id, fn)
    return { $handler: id }
  }

  const draw = (state, error) => {
    if (!mounted.active || slots.get(slot) !== mounted) return
    mounted.handlers.clear()
    const notes = state?.notes ?? []
    const tree = el('Stack', { gap: 'section' }, [
      el('SettingsSection', { id: 'reviews', label: 'Reviews', description: 'A second model reads each finished turn and the task\'s changes, and sends the agent a note when it sees a real problem.' }, [
        ...(error ? [el('Alert', { tone: 'danger' }, [text(error)])] : []),
        ...(state?.problem ? [el('Alert', { tone: 'warn' }, [text(`The last review failed: ${state.problem}`)])] : []),
        el('SettingRow', { label: 'Review sessions', description: 'Off by default. Workflow and delegated sessions are never reviewed in this version. Choose the model and daily allowance in Settings › Plugins › Advisor.' }, [
          el('Select', {
            label: 'Review sessions',
            value: state?.mode ?? 'off',
            options: [{ value: 'off', label: 'Off' }, { value: 'interactive', label: 'Interactive sessions' }],
            onChange: on((mode) => void bridge.put(ROUTE, { mode }).then((next) => draw(next)).catch((failure) => draw(state, String(failure.message ?? failure)))),
          }),
        ]),
        el('Text', { tone: 'muted' }, [text(`${state?.reviewsToday ?? 0} ${state?.reviewsToday === 1 ? 'review' : 'reviews'} finished today.`)]),
      ]),
      el('SettingsSection', { id: 'notes', label: 'Recent notes', description: 'The last 20. A blocker, or a concern while the agent was mid-work, is sent. Everything else is kept here.' },
        notes.length
          ? notes.map((note) => el('SettingRow', {
              label: `${note.severity} · ${OUTCOMES[note.outcome] ?? note.outcome}${note.reason ? ` (${note.reason})` : ''}`,
              description: new Date(note.createdAt).toLocaleString(),
            }, [el('Text', {}, [text(note.note)])]))
          : [el('Text', { tone: 'muted' }, [text('No notes yet.')])]),
    ])
    const ops = [...(mounted.rootId ? [{ op: 'remove', id: mounted.rootId }] : []), { op: 'insert', parent: null, index: 0, node: tree }]
    mounted.rootId = tree.id
    treePort.postMessage({ kind: 'tree:batch', slot, ops })
  }

  draw(null)
  void bridge.get(ROUTE).then((state) => draw(state)).catch((failure) => draw(null, String(failure.message ?? failure)))
}

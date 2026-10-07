// The meter pane, drawn as a tree of acorn's own components.
//
// Hand-written, from the advisor's tree client, because this package has no build step. It runs in a
// Web Worker and talks only over the two ports the host hands it. On mount it reads the rebuilt state
// from its node half, then applies each `plugin:agents:activity` frame for its task as it arrives.

const PLUGIN_BRIDGE_VERSION = 1
const ROUTE = '/v1/p/acorn-session-meter'
const SHOWN_TOOLS = 8

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
  treePort.postMessage({ kind: 'tree:ready', version: 1, entries: ['meter'], scopedBridge: true })
})

// The slot's own bridge: requests to this plugin's routes, a subscription, and the host's pushes.
function connectBridge(port, { onEvent, onSurfaceAction }) {
  let requestSeq = 0
  let closed = false
  const pending = new Map()
  port.onmessage = (event) => {
    if (closed) return
    const message = event.data
    if (!message || typeof message !== 'object') return
    if (message.kind === 'ready') port.postMessage({ kind: 'connected' })
    if (message.kind === 'event') onEvent(message.channel, message.payload)
    if (message.kind === 'surfaceAction') onSurfaceAction(message.command)
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
  const send = (message) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('Bridge disconnected'))
    const id = ++requestSeq
    pending.set(id, { resolve, reject })
    port.postMessage({ ...message, id })
  })
  return {
    get: (path) => send({ kind: 'api', method: 'GET', path }),
    post: (path, body) => send({ kind: 'api', method: 'POST', path, body }),
    subscribe: (channel) => send({ kind: 'subscribe', channel }),
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
      return mount(message.slot, message.bridgePort, message.context?.taskId)
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

/** One frame applied to a session's activity: the item replaces its old state by id and moves to the
 *  end, so the newest change draws last. */
function applyActivity(state, frame) {
  if (frame.kind === 'usage') return { ...state, usage: frame.usage }
  if (frame.kind === 'tool') {
    return { ...state, tools: [...state.tools.filter((tool) => tool.toolCallId !== frame.tool.toolCallId), frame.tool].slice(-50) }
  }
  if (frame.kind === 'subagent') {
    return { ...state, subagents: [...state.subagents.filter((item) => item.subagentId !== frame.subagent.subagentId), frame.subagent].slice(-50) }
  }
  return state
}

const STATUS_TONE = { pending: 'neutral', running: 'accent', idle: 'neutral', completed: 'ok', failed: 'danger' }
const toolLine = (tool) => el('Inline', {}, [
  el('Badge', { tone: STATUS_TONE[tool.status] ?? 'neutral', size: 'xs' }, [text(tool.status)]),
  el('Text', { emphasis: 'muted' }, [text(tool.kind ?? 'tool')]),
  el('Text', {}, [text(tool.title)]),
])

function sessionView(session, on, cycle) {
  const { activity } = session
  const { contextUsed, contextSize } = activity?.usage ?? {}
  const fill = contextUsed != null && contextSize ? contextUsed / contextSize : null
  const ownTools = (activity?.tools ?? []).filter((tool) => !tool.subagentId).slice(-SHOWN_TOOLS)
  return el('Stack', { gap: 'row' }, [
    el('Heading', { level: 3, eyebrow: session.providerId }, [text(session.title)]),
    fill == null
      ? el('Text', { emphasis: 'muted' }, [text('No context report yet.')])
      : el('Meter', { value: fill, tone: 'auto', label: `Context ${contextUsed.toLocaleString()} of ${contextSize.toLocaleString()} tokens` }),
    el('Inline', {}, [
      el('Text', { emphasis: 'muted' }, [text(session.effort ? `${session.effort.label}: ${session.effort.valueLabel}` : 'No reasoning effort option')]),
      ...(session.effort ? [el('Button', { size: 'sm', onPress: on(() => cycle(session)) }, [text('Cycle effort')])] : []),
    ]),
    ...(ownTools.length ? ownTools.map(toolLine) : [el('Text', { emphasis: 'muted' }, [text('No tool calls yet.')])]),
    ...(activity?.subagents ?? []).map((subagent) => el('Stack', { gap: 'row' }, [
      el('Inline', {}, [
        el('Badge', { tone: STATUS_TONE[subagent.status] ?? 'neutral', size: 'xs' }, [text(subagent.status)]),
        el('Text', {}, [text(`Subagent: ${subagent.title}`)]),
      ]),
      ...(activity.tools ?? []).filter((tool) => tool.subagentId === subagent.subagentId).slice(-SHOWN_TOOLS).map(toolLine),
    ])),
  ])
}

function mount(slot, bridgePort, taskId) {
  const previous = slots.get(slot)
  // A props update with no new port changes nothing this pane reads: its task is its scope.
  if (previous && !bridgePort) return
  if (previous) {
    previous.active = false
    previous.bridge.close()
  }
  let state = { sessions: [] }
  let error = null
  const handlers = new Map()
  const mounted = { active: true, handlers, rootId: previous?.rootId ?? '', bridge: null }
  let handlerSeq = 0
  const on = (fn) => {
    const id = ++handlerSeq
    handlers.set(id, fn)
    return { $handler: id }
  }

  const draw = () => {
    if (!mounted.active || slots.get(slot) !== mounted) return
    handlers.clear()
    const tree = el('Stack', { gap: 'section' }, [
      ...(error ? [el('Alert', { tone: 'danger' }, [text(error)])] : []),
      ...(state.sessions.length
        ? state.sessions.map((session) => sessionView(session, on, cycle))
        : [el('EmptyState', { title: 'No agent sessions in this task' }, [])]),
    ])
    const ops = [...(mounted.rootId ? [{ op: 'remove', id: mounted.rootId }] : []), { op: 'insert', parent: null, index: 0, node: tree }]
    mounted.rootId = tree.id
    treePort.postMessage({ kind: 'tree:batch', slot, ops })
  }
  const failed = (failure) => {
    error = String(failure?.message ?? failure)
    draw()
  }
  const refresh = () => mounted.bridge.get(`${ROUTE}/activity?taskId=${encodeURIComponent(taskId)}`)
    .then((next) => { state = next; error = null; draw() }, failed)
  const cycle = (session) => mounted.bridge.post(`${ROUTE}/cycle-effort`, { taskId, sessionId: session.sessionId })
    .then(refresh, failed)

  const bridge = bridgePort ? connectBridge(bridgePort, {
    onEvent: (channel, frame) => {
      if (channel !== 'plugin:agents:activity' || frame?.taskId !== taskId) return
      const session = state.sessions.find((item) => item.sessionId === frame.sessionId)
      // A session this pane hasn't read yet is read whole.
      if (!session?.activity) return void refresh()
      session.activity = applyActivity(session.activity, frame)
      draw()
    },
    // The palette command acts on the newest session.
    onSurfaceAction: (command) => {
      if (command.endsWith('cycle-effort') && state.sessions[0]) void cycle(state.sessions[0])
    },
  }) : null
  if (!bridge || !taskId) {
    treePort.postMessage({ kind: 'tree:failed', slot, message: 'The meter needs a task and a scoped bridge' })
    return
  }
  mounted.bridge = bridge
  slots.set(slot, mounted)
  draw()
  void bridge.subscribe('plugin:agents:activity').catch(failed)
  void refresh()
}

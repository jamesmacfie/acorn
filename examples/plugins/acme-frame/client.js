// The client half: one file, plain JavaScript, no imports.
//
// A plugin origin serves exactly four paths: /, /index.html, /ui.css and /client.js, so a second
// module, a stylesheet, an image or a font cannot be fetched. Inline them; the CSP allows
// `img-src 'self' data:` for exactly that. The frame also has no network at all (`connect-src 'none'`):
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

// #region handshake
const connected = new Promise((resolve, reject) => {
  addEventListener('message', (event) => {
    // No origin check to get wrong: a message with no transferred port is not the handshake, and the
    // port is unforgeable.
    if (!event.data || typeof event.data !== 'object') return
    if (event.data.acornBridge !== PLUGIN_BRIDGE_VERSION) {
      if ('acornBridge' in event.data) reject(new Error(`acorn: unsupported bridge version ${event.data.acornBridge}`))
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

// #endregion

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
      else reject(new Error(`${reply.error.code}: ${reply.error.message}`))
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

// ── Your pane ─────────────────────────────────────────────────────────────────────────────────────
// The document already exists and already links /ui.css: a module script runs after it parses.

// #region draw
// A canvas is the reason this pane is a frame: no kit node draws a line chart.
const canvas = document.createElement('canvas')
canvas.width = 480
canvas.height = 160
canvas.setAttribute('role', 'img')
document.body.append(canvas)

function draw({ label, points }) {
  canvas.setAttribute('aria-label', `${label}: ${points.join(', ')}`)
  const context = canvas.getContext('2d')
  // The theme's own colors, which the host pushed as custom properties in `appearance`.
  const styles = getComputedStyle(document.documentElement)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = styles.getPropertyValue('--accent') || 'currentColor'
  context.lineWidth = 2
  const top = Math.max(...points)
  context.beginPath()
  points.forEach((value, index) => {
    const x = (index / (points.length - 1)) * (canvas.width - 16) + 8
    const y = canvas.height - 8 - (value / top) * (canvas.height - 16)
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.stroke()
}

const load = () => api.get('/v1/p/acme-frame/series').then(draw)
// #endregion

// #region keys
// The manifest claims meta+shift+r, so that chord reaches this frame instead of the shell's shortcuts.
// Every chord the frame doesn't claim goes to the shell, even while the frame has focus.
addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'r' && (event.metaKey || event.ctrlKey) && event.shiftKey) {
    event.preventDefault()
    void load()
  }
})
// #endregion

connected.then(load).catch((error) => {
  const alert = document.createElement('div')
  alert.className = 'ui-alert'
  alert.dataset.variant = 'banner'
  alert.dataset.tone = 'danger'
  alert.textContent = String(error)
  document.body.append(alert)
})

// Host-owned code at app-plugin://<hash>/worker.html. The plugin bundle never runs in this window.
// It runs only in a Worker created here, under this same isolated origin.
const nonce = location.hash.slice(1)
const hostOrigin = location.origin.startsWith('app-plugin://') ? 'app://acorn'
  : location.origin.startsWith('http://app-plugin.') ? 'http://app.localhost'
  : location.origin.startsWith('https://app-plugin.') ? 'https://app.localhost'
  : null
let started = false

window.addEventListener('message', (event) => {
  if (started || event.source !== window.parent || !hostOrigin || event.origin !== hostOrigin) return
  const message = event.data
  if (message?.kind !== 'acorn:tree-relay-start' || message.nonce !== nonce ||
      message.hello?.acornBridge !== 1 || event.ports.length !== 2) return
  started = true
  try {
    const worker = new Worker('/client.js', { type: 'module' })
    const fail = () => window.parent.postMessage({ kind: 'acorn:tree-relay-error', nonce }, hostOrigin)
    worker.onerror = fail
    worker.onmessageerror = fail
    worker.postMessage(message.hello, event.ports)
  } catch {
    window.parent.postMessage({ kind: 'acorn:tree-relay-error', nonce }, hostOrigin)
  }
})

// This readiness signal carries no port or authority. The parent checks source, origin and nonce.
window.parent.postMessage({ kind: 'acorn:tree-relay-ready', nonce }, '*')

// Host-owned code at https://<label>.<sandbox domain>/worker-host.js. The plugin bundle never runs in this
// window. It runs only in a Worker created here, from bytes this page has checked against its own name
// (bundle-check.js).
const nonce = location.hash.slice(1)
let started = false

// What these messages carry is the nonce the parent chose, so '*' reveals nothing. The page can't name its
// parent's origin: any phone app may frame it, and none of them gets anything the bytes' hash doesn't allow.
const tell = (kind) => window.parent.postMessage({ kind, nonce }, '*')

window.addEventListener('message', async (event) => {
  const message = event.data
  if (started || event.source !== window.parent) return
  if (message?.kind !== 'acorn:tree-relay-start' || message.nonce !== nonce || message.hello?.acornBridge !== 1) return
  if (event.ports.length !== 2 || !(message.bundle instanceof ArrayBuffer)) return
  started = true
  const ports = [...event.ports]
  try {
    // Never revoked: a module Worker fetches its script after construction, and this page lives only as long
    // as the Worker it exists for.
    const worker = new Worker(await checkedBundleUrl(message.bundle), { type: 'module' })
    worker.onerror = () => tell('acorn:tree-relay-error')
    worker.onmessageerror = () => tell('acorn:tree-relay-error')
    worker.postMessage(message.hello, ports)
  } catch {
    tell('acorn:tree-relay-error')
  }
})

// This readiness signal carries no port or authority. The parent checks source, origin and nonce.
tell('acorn:tree-relay-ready')

// Host-owned code at https://<label>.<sandbox domain>/worker-host.js. The plugin bundle never runs in this
// window. It runs only in a Worker created here, from bytes this page has checked against its own name.
const nonce = location.hash.slice(1)
// The bundle's SHA-256 as base32, which packages/client-core/src/host/tree/bundleLabel.ts writes the same way.
const label = location.hostname.split('.')[0]
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
let started = false

const base32 = (bytes) => {
  let text = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    for (; bits >= 5; bits -= 5) text += ALPHABET[(buffer >> (bits - 5)) & 31]
    buffer &= (1 << bits) - 1
  }
  return bits ? text + ALPHABET[(buffer << (5 - bits)) & 31] : text
}

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
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', message.bundle))
    if (base32(digest) !== label) throw new Error('the bundle does not match this page')
    // Never revoked: a module Worker fetches its script after construction, and this page lives only as long
    // as the Worker it exists for.
    const url = URL.createObjectURL(new Blob([message.bundle], { type: 'text/javascript' }))
    const worker = new Worker(url, { type: 'module' })
    worker.onerror = () => tell('acorn:tree-relay-error')
    worker.onmessageerror = () => tell('acorn:tree-relay-error')
    worker.postMessage(message.hello, ports)
  } catch {
    tell('acorn:tree-relay-error')
  }
})

// This readiness signal carries no port or authority. The parent checks source, origin and nonce.
tell('acorn:tree-relay-ready')

// The terminal's sandbox, from the inside: what runs before a stranger's bundle does.
//
// A terminal has no iframe, so rung 0 of docs/security/node-plugin-security.md § The containment ladder is a
// `node:worker_threads` worker started under `--permission` with read access to two files and nothing
// else — this one and the bundle. The permission model covers the filesystem, child processes, native
// addons and workers. Node 22 and 24 do not cover the network, so the builtin policy and deleted
// globals apply before bundle evaluation. A bundle reaches the host through its scoped ports,
// which is the same choke point the DOM worker has under `connect-src 'none'`.
//
// Plain JavaScript, not TypeScript, and no imports from the rest of this app: it is loaded by path
// from a worker with almost no filesystem, so it has to be one file the runtime can read on its own.
import { builtinModules, registerHooks, syncBuiltinESMExports } from 'node:module'
import { parentPort, workerData } from 'node:worker_threads'

// The trusted factory derives this set from protocol's shared builtin family policy. Unknown,
// internal and privileged builtins are absent; the client receives no sockets or exec permission.
// Keeping the policy input in workerData lets this bootstrap remain one readable file.
const allowedBuiltins = new Set(workerData.builtins)
const knownBuiltins = new Set(builtinModules)
const builtinAllowed = (specifier) => allowedBuiltins.has(specifier.replace(/^node:/, ''))
registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith('node:') || knownBuiltins.has(specifier)) && !builtinAllowed(specifier)) {
      throw new Error(`acorn: a plugin worker may not import '${specifier}'`)
    }
    const resolved = next(specifier, context)
    if (resolved.url.startsWith('node:') && !builtinAllowed(resolved.url)) {
      throw new Error(`acorn: a plugin worker may not import '${specifier}'`)
    }
    return resolved
  },
})

// This synchronous accessor bypasses module resolution hooks. Capture it privately and apply the
// same policy before plugin evaluation, including bare names and builtin subpaths.
const getBuiltinModule = process.getBuiltinModule.bind(process)
process.getBuiltinModule = (specifier) => {
  if (!builtinAllowed(specifier)) throw new Error(`acorn: a plugin worker may not load builtin '${specifier}'`)
  return getBuiltinModule(specifier)
}
// Update named exports even if trusted bootstrap code loaded node:process before the replacement.
syncBuiltinESMExports()

// The network, as globals. Deleted rather than left to fail later, so a bundle that probes for them
// takes the branch it would take in a frame under `connect-src 'none'`.
for (const name of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'navigator']) delete globalThis[name]

// The Web Worker surface the bridge expects (client-core/host/frames/sdk.ts § handshake): one
// `message` listener, and an event carrying `data` and `ports`.
//
// Node transfers a port by reachability rather than by a separate `ports` field, so the host's factory
// puts them under `__ports` in the message body and this puts them back where the bridge looks for
// them. That translation is the whole difference between the two sandboxes.
const listeners = new Map()
let pendingHello = null
let helloDeadline = null
let restoreBridgePost = null
let helloSeen = false
const claimHello = () => {
  pendingHello = null
  if (helloDeadline) clearTimeout(helloDeadline)
  helloDeadline = null
  restoreBridgePost?.()
  restoreBridgePost = null
}
globalThis.addEventListener = (type, listener) => {
  const set = listeners.get(type) ?? new Set()
  set.add(listener)
  listeners.set(type, set)
  // An unrelated listener may register before connect(). Keep the one hello until its actual bridge
  // is used, rather than guessing which callback is the SDK from registration order.
  if (type === 'message' && pendingHello) queueMicrotask(() => {
    if (pendingHello && set.has(listener)) listener(pendingHello)
  })
}
globalThis.removeEventListener = (type, listener) => listeners.get(type)?.delete(listener)
globalThis.postMessage = (message) => parentPort.postMessage(message)
globalThis.self = globalThis

parentPort.on('message', (raw) => {
  const { __ports: ports, ...data } = raw ?? {}
  const event = { data, ports: ports ?? [] }
  // Importing the bundle yields before connect() installs its listener. Own one initial hello,
  // with a deadline; ordinary traffic is never queued. A duplicate cannot replace transferred ports.
  if (data.acornBridge && event.ports.length) {
    if (helloSeen) { for (const port of event.ports) port.close(); return }
    helloSeen = true
    pendingHello = event
    const restores = event.ports.map((port, index) => {
      const post = port.postMessage
      port.postMessage = function (message, ...transfer) {
        const bridgeClaim = index === 0 && (message?.kind === 'connected' || Number.isInteger(message?.id))
        // A framework-free legacy client may use the tree protocol directly without calling the
        // frame SDK. Its first real response proves that it adopted the transferred channel too.
        const treeClaim = index === 1 && ['tree:ready', 'tree:batch', 'tree:failed', 'tree:pong', 'tree:host-request'].includes(message?.kind)
        if (bridgeClaim || treeClaim) claimHello()
        return post.call(this, message, ...transfer)
      }
      return () => { port.postMessage = post }
    })
    restoreBridgePost = () => { for (const restore of restores) restore() }
    helloDeadline = setTimeout(() => {
      const unclaimed = pendingHello
      claimHello()
      for (const port of unclaimed?.ports ?? []) port.close()
      // WorkerHost receives this as a worker error and fails every admitted slot visibly.
      throw new Error('acorn: the plugin did not claim its initial bridge within 10 seconds')
    }, 10_000)
    helloDeadline.unref()
  }
  for (const listener of [...(listeners.get('message') ?? [])]) listener(event)
})

// Last, and by path: everything above has to be true before a stranger's module scope runs.
try {
  await import(workerData.bundle)
} catch (error) {
  const unclaimed = pendingHello
  claimHello()
  for (const port of unclaimed?.ports ?? []) port.close()
  throw error
}

// The terminal's sandbox, from the inside: what runs before a stranger's bundle does.
//
// A terminal has no iframe, so rung 0 of docs/security.md § The containment ladder is a
// `node:worker_threads` worker started under `--permission` with read access to two files and nothing
// else — this one and the bundle. The permission model covers the filesystem, child processes, native
// addons and workers; it does not cover the network, so the two lines that matter here are the module
// hook and the deleted globals. Between them a bundle reaches the host over its port or not at all,
// which is the same choke point the DOM worker has under `connect-src 'none'`.
//
// Plain JavaScript, not TypeScript, and no imports from the rest of this app: it is loaded by path
// from a worker with almost no filesystem, so it has to be one file the runtime can read on its own.
import { registerHooks } from 'node:module'
import { parentPort, workerData } from 'node:worker_threads'

// Everything a bundle could reach the network, the filesystem or another process with that
// `--permission` does not already refuse. `node:module` is on the list so a bundle cannot register a
// hook of its own and undo this one; `node:worker_threads` so it cannot start a second worker to run
// outside the deny list it inherited nothing of.
const DENIED = new Set([
  'net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'quic',
  'child_process', 'worker_threads', 'cluster', 'module', 'vm', 'inspector', 'repl',
])
registerHooks({
  resolve(specifier, context, next) {
    if (DENIED.has(specifier.replace(/^node:/, ''))) throw new Error(`acorn: a plugin worker may not import '${specifier}'`)
    return next(specifier, context)
  },
})

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
globalThis.addEventListener = (type, listener) => {
  const set = listeners.get(type) ?? new Set()
  set.add(listener)
  listeners.set(type, set)
}
globalThis.removeEventListener = (type, listener) => listeners.get(type)?.delete(listener)
globalThis.postMessage = (message) => parentPort.postMessage(message)
globalThis.self = globalThis

parentPort.on('message', (raw) => {
  const { __ports: ports, ...data } = raw ?? {}
  const event = { data, ports: ports ?? [] }
  for (const listener of [...(listeners.get('message') ?? [])]) listener(event)
})

// Last, and by path: everything above has to be true before a stranger's module scope runs.
await import(workerData.bundle)

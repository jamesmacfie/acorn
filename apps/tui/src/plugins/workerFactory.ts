import { existsSync, realpathSync } from 'node:fs'
import { Worker as NodeWorker } from 'node:worker_threads'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import { _setWorkerFactory } from '@acorn/client-core/host/tree/workerHost.ts'
import { assertSupportedNodeRuntime } from '@acorn/protocol/nodeRuntime.ts'
import { pluginBuiltinAllowed } from '@acorn/protocol/plugin/nodeBuiltins.ts'
import { bundlePath } from './custody'
import { createLogger } from '@acorn/client-core/infra/telemetry'

// Modern loaded SDK bundles share one `node:worker_threads` worker per plugin/hash. Legacy bundles use
// one immutable mounted slot per worker; each worker runs under `--permission` with read access to two files
// (docs/tui.md). Same-hash retirement owns the native exit before a replacement thread is built.
//
// `workerHost.ts` above this is shared with the desktop whole — the handshake, the slot bookkeeping,
// the 30-second grace, the heartbeat, the fail-fanout. What it exposes is `_setWorkerFactory`, and
// this is the terminal's factory. The sandbox and deferred native lifetime are owned by this
// factory and in ./pluginWorker.js.
//
// The measurement 06-isolation.md asked for, made on Node 24 and 26: a worker thread's `execArgv`
// **does** take `--permission`, and the grants are the worker's own rather than the parent's. So the
// design's fallback — a child process per plugin with the two ports over IPC — is not needed, and the
// TUI process itself runs with no permission flags at all. Recorded in docs/security/plugin-client-sandbox.md § Three containers.

/**
 * The bootstrap, as a path rather than a specifier: a worker is pointed at a file, and the worker this
 * one starts has read access to that file and one other.
 *
 * Two candidates because the two layouts differ by a directory. In the source tree it sits beside this
 * module; in the bundle it is its own entry next to `main.js` while this module lands in a chunk under
 * `chunks/`. Built with `fileURLToPath` rather than `new URL(...)` because a bundler rewrites the
 * second into an asset reference and this has to survive as a plain path.
 */
const bootstrapPath = (): string => {
  const here = dirname(fileURLToPath(import.meta.url))
  const found = [join(here, 'pluginWorker.js'), join(here, '..', 'pluginWorker.js')].find((candidate) => existsSync(candidate))
  if (!found) throw new Error('the plugin sandbox bootstrap is missing from this build')
  return found
}

/** Just enough of a DOM `Worker` for `workerHost.ts`, which is all it uses. */
type WorkerLike = {
  postMessage(message: unknown, transfer?: unknown[]): void
  terminate(): Promise<void>
  ready: Promise<void>
  onerror: ((event: unknown) => void) | null
}

const retiring = new Map<string, Set<Promise<void>>>()
const pending = new Map<string, Set<() => void>>()
const log = createLogger('plugins')

function spawn(url: string): WorkerLike {
  assertSupportedNodeRuntime(process.versions.node)
  // The host addresses a bundle by hash and never by path, on every host (docs/security/plugin-bundles.md §
  // Third-party plugin bundles). Here the path is looked up from the hash rather than passed in.
  const hash = url.slice(url.lastIndexOf('/') + 1).replace(/\.js$/, '')
  const claimed = bundlePath(hash)
  if (!claimed) throw new Error(`no cached bundle for ${hash.slice(0, 12)}`)
  const bundle = realpathSync(claimed)
  const bootstrap = realpathSync(bootstrapPath())
  let worker: NodeWorker | null = null
  let hello: { message: unknown; ports: unknown[] } | null = null
  let terminated = false
  let termination: Promise<void> | null = null
  let pendingConstruct: (() => void) | null = null
  let readyResolve = () => {}
  let readyReject = (_error: unknown) => {}
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  // The host consumes readiness; retain a rejection observer even if setup fails before returning.
  void ready.catch(() => {})
  const deliver = (message: unknown, transfer: unknown[]): void => {
    worker!.postMessage(transfer.length ? { ...(message as object), __ports: transfer } : message, transfer as never)
  }
  const adapter: WorkerLike = {
    ready,
    postMessage(message, transfer = []) {
      if (terminated) throw new Error('this plugin worker was retired')
      if (worker) return deliver(message, transfer)
      if (hello || !(message as { acornBridge?: number })?.acornBridge) throw new Error('a deferred plugin worker owns only its initial hello')
      hello = { message, ports: transfer }
    },
    terminate() {
      if (terminated) return termination ?? Promise.resolve()
      terminated = true
      adapter.onerror = null
      if (pendingConstruct) {
        const waiting = pending.get(hash)
        waiting?.delete(pendingConstruct)
        if (waiting && !waiting.size) pending.delete(hash)
        pendingConstruct = null
      }
      readyReject(new Error('this plugin worker was retired before construction'))
      for (const port of hello?.ports ?? []) { try { (port as MessagePort).close() } catch { /* close every owned endpoint */ } }
      hello = null
      if (!worker) { termination = Promise.resolve(); return termination }
      const retiringWorker = worker
      const set = retiring.get(hash) ?? new Set<Promise<void>>()
      retiring.set(hash, set)
      let ending: Promise<number>
      try { ending = retiringWorker.terminate() } catch (error) { ending = Promise.reject(error) }
      termination = ending.then(() => {}, async (error: unknown) => {
        try { log.warn('plugin worker termination failed', error, { 'plugin.hash': hash }) } catch { /* retain the exit owner */ }
        // A rejected termination is not proof of death. Continue owning/draining the thread and
        // block replacements until its actual exit; their host startup deadline remains in force.
        if (retiringWorker.threadId !== -1) await new Promise<void>((resolve) => retiringWorker.once('exit', () => resolve()))
      }).then(() => {
        set.delete(termination!)
        if (!set.size && retiring.get(hash) === set) {
          retiring.delete(hash)
          const waiting = pending.get(hash)
          pending.delete(hash)
          for (const construct of waiting ?? []) construct()
        }
      })
      set.add(termination)
      return termination
    },
    onerror: null,
  }
  const construct = (): void => {
    if (terminated) return
    worker = new NodeWorker(bootstrap, {
      workerData: { bundle, builtins: builtinModules.filter((name) => pluginBuiltinAllowed(name, { sockets: false, exec: false })).map((name) => name.replace(/^node:/, '')) },
      env: {},
      execArgv: ['--permission', `--allow-fs-read=${bootstrap}`, `--allow-fs-read=${bundle}`],
      stdout: true,
      stderr: true,
    })
    worker.stdout?.resume()
    worker.stderr?.resume()
    worker.unref()
    worker.on('error', (error: Error) => adapter.onerror?.({ message: error.message }))
    if (hello) { const initial = hello; deliver(initial.message, initial.ports); hello = null }
    readyResolve()
  }
  const deferredConstruct = (): void => {
    if (terminated) return
    if (retiring.get(hash)?.size) {
      const waiting = pending.get(hash) ?? new Set<() => void>()
      pending.set(hash, waiting)
      pendingConstruct = deferredConstruct
      waiting.add(deferredConstruct)
      return
    }
    pendingConstruct = null
    try { construct() }
    catch (error) { readyReject(error); const failed = adapter.onerror; void adapter.terminate(); failed?.({ message: error instanceof Error ? error.message : String(error) }) }
  }
  if (retiring.get(hash)?.size) deferredConstruct()
  else {
    try { construct() } catch (error) { readyReject(error); void adapter.terminate(); throw error }
  }
  return adapter
}

/** Install the factory. Called once by the composition root, before anything mounts a tree. */
export function installPluginWorkers(): void {
  _setWorkerFactory(spawn as unknown as (url: string) => Worker)
}

import { existsSync, realpathSync } from 'node:fs'
import { Worker as NodeWorker } from 'node:worker_threads'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _setWorkerFactory } from '@acorn/client-core/host/tree/workerHost.ts'
import { bundlePath } from './custody'

// How a loaded plugin runs here: one `node:worker_threads` worker per bundle, under `--permission`
// with read access to two files (docs/future/terminal/06-isolation.md).
//
// `workerHost.ts` above this is shared with the desktop whole — the handshake, the slot bookkeeping,
// the 30-second grace, the heartbeat, the fail-fanout. What it exposes is `_setWorkerFactory`, and
// this is the terminal's factory. Everything different about a terminal sandbox is in these forty
// lines and in ./pluginWorker.js.
//
// The measurement 06-isolation.md asked for, made on Node 24 and 26: a worker thread's `execArgv`
// **does** take `--permission`, and the grants are the worker's own rather than the parent's. So the
// design's fallback — a child process per plugin with the two ports over IPC — is not needed, and the
// TUI process itself runs with no permission flags at all. Recorded in docs/security.md § Rung 0.

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
  terminate(): void
  onerror: ((event: unknown) => void) | null
}

function spawn(url: string): WorkerLike {
  // The host addresses a bundle by hash and never by path, on every host (docs/security.md §
  // Third-party plugin bundles). Here the path is looked up from the hash rather than passed in.
  const hash = url.slice(url.lastIndexOf('/') + 1).replace(/\.js$/, '')
  const claimed = bundlePath(hash)
  if (!claimed) throw new Error(`no cached bundle for ${hash.slice(0, 12)}`)
  // Resolved, both of them. Node's permission model compares real paths, so a grant naming a path
  // that goes through a symlink matches nothing and the worker cannot read the file it was started
  // for — which on macOS is every path under `TMPDIR`, and is a confusing half hour.
  const bundle = realpathSync(claimed)
  const bootstrap = realpathSync(bootstrapPath())

  const worker = new NodeWorker(bootstrap, {
    workerData: { bundle },
    // No filesystem beyond these two files, no child processes, no native addons, no nested workers.
    // The flags are the worker's own: Node applies `execArgv` to the thread, so the parent's lack of
    // a permission model is not inherited in the other direction.
    execArgv: ['--permission', `--allow-fs-read=${bootstrap}`, `--allow-fs-read=${bundle}`],
    // stdout and stderr stay the worker's own streams rather than being piped into ours: the renderer
    // owns the screen, and a plugin writing to it would draw over the frame.
    stdout: true,
    stderr: true,
  })
  // Nothing a plugin does should hold `acorn` open. A worker that outlives its trees is stopped by the
  // grace timer above; one that outlives the process is a terminal that will not exit.
  worker.unref()

  const adapter: WorkerLike = {
    // Node transfers a port by reachability, so a port named only in the transfer list arrives
    // nowhere. The bootstrap reads them back out of `__ports` (./pluginWorker.js).
    postMessage: (message, transfer) => {
      const ports = transfer ?? []
      worker.postMessage(ports.length ? { ...(message as object), __ports: ports } : message, ports as never)
    },
    terminate: () => void worker.terminate(),
    onerror: null,
  }
  worker.on('error', (error: Error) => adapter.onerror?.({ message: error.message }))
  return adapter
}

/** Install the factory. Called once by the composition root, before anything mounts a tree. */
export function installPluginWorkers(): void {
  _setWorkerFactory(spawn as unknown as (url: string) => Worker)
}

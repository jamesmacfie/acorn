// Which of a loaded plugin's functions the host may call synchronously.
//
// A worker-hosted plugin's descriptor crosses the RPC seam as proxies, and an async proxy answers
// with a promise. A host caller that consumes the answer synchronously reads that promise as a plain
// object, so its fields are all `undefined` and the caller fails somewhere else entirely. Getting a
// classification wrong here is therefore silent at the seam and loud a long way from it, which is
// why the rules live in their own module with a test rather than inside the worker bootstrap.
//
// Lives here rather than in nodePluginWorker.ts because that module reads `workerData` and loads the
// package entrypoint at import time, so nothing can import it to ask a question.

// Methods whose callers consume a value synchronously, wherever they sit on a contribution.
const SYNC_METHODS = ['normalize', 'toPublic', 'key', 'encode', 'decode', 'enabled']

// The two synchronous contracts that are objects of methods rather than methods
// (integrations/types.ts § ExternalIdContract, ReferenceResolver). A path ends at the method, so
// naming the container classified nothing: `provider.externalIds.parse` crossed as a promise, and
// `externalRefForConnection` refused every link it stamped with `provider_bad_config`.
const SYNC_CONTRACTS = /\.(externalIds|refs)\.[A-Za-z0-9_$]+$/

const leafOf = (path: string): string =>
  path.match(/\.([A-Za-z0-9_$]+)(?:\]|$)/g)?.at(-1)?.replace(/[.\]]/g, '') ?? ''

/** How a plugin-side function at `path` crosses to the host. Everything unnamed crosses as a promise,
 *  including route handlers, schedules, hooks and capability implementations. */
export const pluginFunctionMode = (path: string, fn: (...args: never[]) => unknown): 'sync' | 'async' => {
  if (path === 'plugin.init' || path === 'plugin.ready' || path === 'plugin.dispose') return 'async'
  if (fn.constructor.name === 'AsyncFunction') return 'async'
  return SYNC_CONTRACTS.test(path) || SYNC_METHODS.includes(leafOf(path)) ? 'sync' : 'async'
}

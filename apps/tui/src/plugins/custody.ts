import { join } from 'node:path'
import { PluginCache, type BundleFetcher } from '@acorn/custody/plugins'
import { PluginTrustStore } from '@acorn/custody/plugins'
import { installSchema, pluginDecisions, removeSchema, type RulesLog } from '@acorn/custody/plugins'
import type { PluginCustody } from '@acorn/client-core/infra/platform'
import { configDir } from '../node/paths'
import { createLogger } from '@acorn/client-core/infra/telemetry'

const log = createLogger('plugins')
// The custody rules log a message and its attributes. This logger takes a detail between the two.
const rulesLog: RulesLog = {
  warn: (message, attributes) => log.warn(message, undefined, attributes),
  error: (message, attributes) => log.error(message, undefined, attributes),
}

// Custody of third-party plugin bundles, from a terminal (docs/tui/plugins.md § Custody).
//
// The desktop's helper holds these in a process the renderer cannot reach. There is no second process
// here, so the boundary is this module: the cache and the trust store are built once, in the composition
// root, and nothing outside `client-core/host/plugins/host.ts` ever calls `pluginCustody()`. The stores
// themselves are `@acorn/custody`'s own, unchanged — one file discipline, one schema, one place a
// hash-mismatch is refused. A second implementation would be a second set of security decisions.
//
// Under the TUI's config directory rather than the node's data root, because a decision to run code is
// this device's and not that node's (docs/tui/process.md § Where the TUI keeps things).

const pluginsDir = (): string => join(configDir(), 'plugins')

let cache: PluginCache | null = null
let trust: PluginTrustStore | null = null

/** Where a bundle this device holds lives on disk. The one path-shaped answer anything outside this
 *  module gets, and its one caller is the worker factory, which needs a file to point a thread at. */
export const bundlePath = (hash: string): string | null => cache?.path(hash) ?? null
export const forgetNodePluginProvenance = (nodeId: string): void => {
  cache?.forgetNode(nodeId)
}

/** Build the members of the `plugins` seam group. Called once, by the composition root. */
export function createPluginCustody(broker: BundleFetcher): PluginCustody {
  cache = new PluginCache(pluginsDir(), broker)
  trust = new PluginTrustStore(pluginsDir())
  const store = trust
  const bundles = cache
  // Bundles nothing indexes, and index rows no node has offered in a month. The desktop sweeps on the
  // helper's boot; this is the same boot.
  bundles.sweep()

  return {
    // What a node's bundle is worth and how consent is recorded is `@acorn/custody`'s own, shared with
    // the desktop and the phone. What is left here is what a terminal can do for itself.
    ...pluginDecisions(bundles, store, rulesLog),
    install: async (raw) => {
      const { source, expectedPluginId } = installSchema.parse(raw)
      const result = await bundles.putFromSource(source, 'terminal', expectedPluginId)
      if ('hash' in result)
        store.recordDevAccept({
          pluginId: result.pluginId,
          nodeId: '',
          source: { kind: 'device' },
          hash: result.hash,
          version: result.version,
        })
      return result
    },
    remove: async (raw) => {
      const { pluginId } = removeSchema.parse(raw)
      bundles.removeDevice(pluginId)
      store.forgetDevGrant(pluginId, { kind: 'device' })
    },
  }
}

/** Test seam. The two stores are module state so `bundlePath` has one answer per process. */
export function _resetPluginCustody(): void {
  cache = null
  trust = null
}

import { join } from 'node:path'
import { z } from 'zod'
import { PluginCache, type BundleFetcher } from '@acorn/custody/plugins'
import { PluginTrustStore } from '@acorn/custody/plugins'
import {
  decisionSchema, devGrantSchema, disclosureSchema, NO_DISCLOSURE, putSchema, installSchema, removeSchema,
} from '@acorn/custody/plugins'
import type { PluginCustody } from '@acorn/client-core/infra/platform'
import { configDir } from '../node/paths'
import { createLogger } from '@acorn/client-core/infra/telemetry'

const log = createLogger('plugins')

// Custody of third-party plugin bundles, from a terminal (docs/tui/plugins.md § Custody).
//
// The desktop's helper holds these in a process the renderer cannot reach. There is no second process
// here, so the boundary is this module: the cache and the trust store are built once, in the composition
// root, and nothing outside `client-core/host/plugins/host.ts` ever calls `pluginCustody()`. The stores
// themselves are `@acorn/custody`'s own, unchanged — one file discipline, one schema, one place a
// hash-mismatch is refused. A second implementation would be a second set of security decisions.
//
// Under the TUI's config directory rather than the node's data root, because a decision to run code is
// this device's and not that node's (03-process-model.md § Where the TUI keeps things).

const pluginsDir = (): string => join(configDir(), 'plugins')

let cache: PluginCache | null = null
let trust: PluginTrustStore | null = null

/** Where a bundle this device holds lives on disk. The one path-shaped answer anything outside this
 *  module gets, and its one caller is the worker factory, which needs a file to point a thread at. */
export const bundlePath = (hash: string): string | null => cache?.path(hash) ?? null
export const forgetNodePluginProvenance = (nodeId: string): void => { cache?.forgetNode(nodeId) }

/** Build the four members of the `plugins` seam group. Called once, by the composition root. */
export function createPluginCustody(broker: BundleFetcher): PluginCustody {
  cache = new PluginCache(pluginsDir(), broker)
  trust = new PluginTrustStore(pluginsDir())
  const store = trust
  const bundles = cache
  // Bundles nothing indexes, and index rows no node has offered in a month. The desktop sweeps on the
  // helper's boot; this is the same boot.
  bundles.sweep()

  return {
    // Projected rather than passed through, exactly as the helper projects it: `nodeIds` and the
    // eviction timestamps are bookkeeping, and a field added to a cache entry must not reach the
    // renderer by default.
    state: async () => ({
      cached: Object.fromEntries(
        Object.entries(bundles.list()).map(([hash, entry]) => [hash, { pluginId: entry.pluginId, version: entry.version, bytes: entry.bytes, source: entry.source ?? (entry.nodeIds[0] ? { kind: 'node' as const, nodeId: entry.nodeIds[0] } : undefined), nodeIds: entry.nodeIds, installSource: entry.installSource, sourceLabel: entry.sourceLabel, manifest: entry.manifest }]),
      ),
      acks: store.list(),
      devGrants: store.listDevGrants(),
    }),
    cachePut: async (raw) => {
      const { nodeId, pluginId, hash, version } = putSchema.parse(raw)
      const result = await bundles.putFromNode(nodeId, pluginId, { hash, version })
      if ('hash' in result) store.recordDevAccept({ pluginId, nodeId, hash: result.hash, version })
      return result
    },
    install: async (raw) => {
      const { source, expectedPluginId } = installSchema.parse(raw)
      const result = await bundles.putFromSource(source, expectedPluginId)
      if ('hash' in result) store.recordDevAccept({ pluginId: result.pluginId, nodeId: '', source: { kind: 'device' }, hash: result.hash, version: result.version })
      return result
    },
    remove: async (raw) => {
      const { pluginId } = removeSchema.parse(raw)
      bundles.removeDevice(pluginId)
      store.forgetDevGrant(pluginId, { kind: 'device' })
    },
    trustRecord: async (raw) => {
      const decision = decisionSchema.parse(raw)
      if (!bundles.has(decision.hash)) throw new Error(`No cached bundle for ${decision.pluginId}@${decision.hash.slice(0, 12)}`)
      const disclosure = disclosureSchema.safeParse(raw)
      if (disclosure.success) return store.record({ ...decision, ...disclosure.data, decidedAt: Date.now() })
      // A node running a newer manifest schema than this build. The decision is exact and the snapshot
      // is not, so it is recorded `partial` and never becomes the baseline of a later "what changed"
      // diff (docs/security/plugin-install.md § The dev grant).
      log.warn(`the disclosure recorded with ${decision.decision} for ${decision.pluginId} could not be parsed; storing a partial record`, undefined, { 'plugin.id': decision.pluginId })
      store.record({ ...decision, ...NO_DISCLOSURE, partial: true, decidedAt: Date.now() })
    },
    trustForget: async (raw) => {
      const { pluginId, hash } = z.object({
        pluginId: z.string().min(1),
        hash: z.string().regex(/^[0-9a-f]{64}$/),
      }).parse(raw)
      store.forgetDecision(pluginId, hash)
    },
    devGrant: async (raw) => {
      const { pluginId, nodeId, source, path, grant } = devGrantSchema.parse(raw)
      if (!grant) return store.revokeDev(pluginId, source ?? nodeId)
      // `{ path }` is a device-provenance install: a person at a terminal installing a plugin is
      // installing it here (docs/tui/plugins.md § Custody).
      store.grantDev({ pluginId, nodeId, source: source ?? { kind: 'node', nodeId }, ...(path ? { path } : {}), grantedAt: Date.now() })
      if (source?.kind === 'device') {
        for (const [hash, entry] of Object.entries(bundles.list())) {
          if (entry.pluginId === pluginId && entry.source?.kind === 'device') {
            store.recordDevAccept({ pluginId, nodeId: '', source, hash, version: entry.version })
          }
        }
      }
    },
  }
}

/** Test seam. The two stores are module state so `bundlePath` has one answer per process. */
export function _resetPluginCustody(): void {
  cache = null
  trust = null
}

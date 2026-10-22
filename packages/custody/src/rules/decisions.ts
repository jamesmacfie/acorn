import { z } from 'zod'
import type { PutResult, BundleCache } from './bundleCache'
import {
  decisionSchema,
  devGrantSchema,
  disclosureSchema,
  NO_DISCLOSURE,
  putSchema,
  type PluginsState,
} from './requests'
import type { RulesLog } from './storage'
import type { TrustStore } from './trustStore'

const forgetSchema = z.object({
  pluginId: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
})

/**
 * What a host answers when its renderer asks about plugin bundles and consent, over the cache and the
 * trust record it holds. Each request is parsed here, so every host refuses the same malformed ones and
 * records the same decisions. A host adds what only it can do, which is installing a plugin from a
 * source and removing one.
 *
 * `state` projects each cache entry rather than passing it through: `nodeIds` and the eviction
 * timestamps are the host's bookkeeping, and a field added to a cache entry must not reach the renderer
 * by default.
 */
export function pluginDecisions(cache: BundleCache, trust: TrustStore, log: RulesLog) {
  return {
    state: async (): Promise<PluginsState> => ({
      cached: Object.fromEntries(
        Object.entries(cache.list()).map(([hash, entry]) => [
          hash,
          {
            pluginId: entry.pluginId,
            version: entry.version,
            bytes: entry.bytes,
            source:
              entry.source ?? (entry.nodeIds[0] ? { kind: 'node' as const, nodeId: entry.nodeIds[0] } : undefined),
            nodeIds: entry.nodeIds,
            installSource: entry.installSource,
            sourceLabel: entry.sourceLabel,
            manifest: entry.manifest,
          },
        ]),
      ),
      acks: trust.list(),
      devGrants: trust.listDevGrants(),
    }),

    cachePut: async (raw: unknown): Promise<PutResult> => {
      const { nodeId, pluginId, hash, version } = putSchema.parse(raw)
      const result = await cache.putFromNode(nodeId, pluginId, { hash, version })
      if ('hash' in result) trust.recordDevAccept({ pluginId, nodeId, hash: result.hash, version })
      return result
    },

    trustRecord: async (raw: unknown): Promise<void> => {
      const decision = decisionSchema.parse(raw)
      if (!cache.has(decision.hash))
        throw new Error(`No cached bundle for ${decision.pluginId}@${decision.hash.slice(0, 12)}`)
      const disclosure = disclosureSchema.safeParse(raw)
      if (disclosure.success) return trust.record({ ...decision, ...disclosure.data, decidedAt: Date.now() })
      // A node running a newer manifest schema than this build. The decision is exact and the snapshot
      // is not, so it is recorded `partial` and never becomes the baseline of a later "what changed"
      // diff (docs/security/plugin-install.md § The dev grant).
      log.warn(
        `the disclosure recorded with ${decision.decision} for ${decision.pluginId} could not be parsed; storing a partial record: ${disclosure.error.message}`,
        { 'plugin.id': decision.pluginId },
      )
      trust.record({ ...decision, ...NO_DISCLOSURE, partial: true, decidedAt: Date.now() })
    },

    trustForget: async (raw: unknown): Promise<void> => {
      const { pluginId, hash } = forgetSchema.parse(raw)
      trust.forgetDecision(pluginId, hash)
    },

    devGrant: async (raw: unknown): Promise<void> => {
      const { pluginId, nodeId, source, path, grant } = devGrantSchema.parse(raw)
      if (!grant) return trust.revokeDev(pluginId, source ?? nodeId)
      trust.grantDev({
        pluginId,
        nodeId,
        source: source ?? { kind: 'node', nodeId },
        ...(path ? { path } : {}),
        grantedAt: Date.now(),
      })
      if (source?.kind === 'device') {
        for (const [hash, entry] of Object.entries(cache.list())) {
          if (entry.pluginId === pluginId && entry.source?.kind === 'device') {
            trust.recordDevAccept({ pluginId, nodeId: '', source, hash, version: entry.version })
          }
        }
      }
    },
  }
}

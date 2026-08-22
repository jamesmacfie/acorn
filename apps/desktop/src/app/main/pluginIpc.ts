import { ipcMain } from 'electron'
import type { PluginCache, PutResult } from '@acorn/desktop-helper/main/pluginCache.ts'
import type { PluginTrustStore } from '@acorn/desktop-helper/main/pluginTrustStore.ts'
import {
  decisionSchema,
  devGrantSchema,
  disclosureSchema,
  NO_DISCLOSURE,
  putSchema,
  type PluginsState,
} from '@acorn/desktop-helper/main/pluginRequests.ts'

// The renderer's projection of the bundle cache and the trust store. Thin like nodeBrokerIpc.ts:
// every decision lives in pluginCache.ts / pluginTrustStore.ts, which are Electron-free and therefore
// testable, and this file only validates and forwards.
//
// What deliberately does NOT cross here: bundle bytes and filesystem paths. The renderer asks main to
// fetch a plugin from a node and gets back a hash; the bytes go node → main → disk and are never
// marshalled through the renderer, which is what keeps the "renderer stays inert" invariant true for
// third-party code as well as for API traffic.
//
// The renderer supplies `claim` (the hash and version a node advertised) and `display` (the version
// and permissions to record with a decision). Both are untrusted and both are re-checked or
// display-only: `claim.hash` is asserted against the bytes main hashed, and `display` is only ever
// rendered back to the owner in a later permission diff. Nothing here grants anything.

export const PLUGINS_STATE = 'acorn:plugins-state'
export const PLUGINS_CACHE_PUT = 'acorn:plugins-cache-put'
export const PLUGINS_TRUST_RECORD = 'acorn:plugins-trust-record'
export const PLUGINS_DEV_GRANT = 'acorn:plugins-dev-grant'

export function registerPluginIpc(cache: PluginCache, trust: PluginTrustStore): () => void {
  ipcMain.handle(PLUGINS_STATE, async (): Promise<PluginsState> => ({
    // Projected rather than passed through: `nodeIds` and the eviction timestamps are main's
    // bookkeeping, and a field added to the cache entry must not reach the renderer by default.
    cached: Object.fromEntries(
      Object.entries(cache.list()).map(([hash, entry]) => [hash, { pluginId: entry.pluginId, version: entry.version, bytes: entry.bytes }]),
    ),
    acks: trust.list(),
    // Read by Settings → Plugins to badge a plugin in development and to offer the control that ends it.
    // The badge is not decoration: a dev-mode plugin whose behaviour is indistinguishable from a normal
    // install is a trust story that has rotted (docs/security.md § The dev grant).
    devGrants: trust.listDevGrants(),
  }))

  ipcMain.handle(PLUGINS_CACHE_PUT, async (_event, raw: unknown): Promise<PutResult> => {
    const { nodeId, pluginId, hash, version } = putSchema.parse(raw)
    const result = await cache.putFromNode(nodeId, pluginId, { hash, version })
    // The dev grant's whole effect lives here rather than in the renderer, for the same reason the
    // hash does: the acknowledgement is written beside the bytes main verified, by the process that
    // holds the grant. `recordDevAccept` is a no-op without one, so a renderer that asked for a bundle
    // main has no grant for gets exactly the prompt it would have got anyway.
    if ('hash' in result) trust.recordDevAccept({ pluginId, nodeId, hash: result.hash, version })
    return result
  })

  ipcMain.handle(PLUGINS_DEV_GRANT, async (_event, raw: unknown): Promise<void> => {
    const { pluginId, nodeId, path, grant } = devGrantSchema.parse(raw)
    if (!grant) return trust.revokeDev(pluginId, nodeId)
    trust.grantDev({ pluginId, nodeId, ...(path ? { path } : {}), grantedAt: Date.now() })
  })

  ipcMain.handle(PLUGINS_TRUST_RECORD, async (_event, raw: unknown): Promise<void> => {
    const decision = decisionSchema.parse(raw)
    // Recording a decision about a bundle this device does not hold would leave an acknowledgement
    // pointing at nothing, and on the accept path would be an approval granted before the bytes were
    // ever seen. The hash has to be one main computed itself.
    if (!cache.has(decision.hash)) throw new Error(`No cached bundle for ${decision.pluginId}@${decision.hash.slice(0, 12)}`)

    const disclosure = disclosureSchema.safeParse(raw)
    if (disclosure.success) {
      trust.record({ ...decision, ...disclosure.data, decidedAt: Date.now() })
      return
    }
    // The decision stands either way; what is lost is the snapshot behind it. Stored as `partial` so
    // it can never become the baseline of a later "what changed" diff, which would otherwise report
    // grants as newly requested that the owner had already seen (@acorn/desktop-helper/main/pluginTrustStore.ts).
    //
    // Recording rather than refusing, on both arms. A rejection needs no snapshot at all; nothing ever
    // diffs against one. An acceptance is still informed: the lines the owner read were rendered by
    // the renderer from the roster row, which already classifies anything this shell does not
    // recognise into its own "requests this version of acorn does not recognise" line rather than
    // echoing it. Refusing here would leave the owner unable to answer the prompt at all.
    console.warn(
      `[plugins] the disclosure recorded with ${decision.decision} for ${decision.pluginId} could not be parsed; storing a partial record:`,
      disclosure.error.message,
    )
    trust.record({ ...decision, ...NO_DISCLOSURE, partial: true, decidedAt: Date.now() })
  })

  return () => {
    for (const channel of [PLUGINS_STATE, PLUGINS_CACHE_PUT, PLUGINS_TRUST_RECORD, PLUGINS_DEV_GRANT]) ipcMain.removeHandler(channel)
  }
}

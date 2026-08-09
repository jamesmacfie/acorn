import { ipcMain } from 'electron'
import { z } from 'zod'
import type { NodePluginPermissions, PluginWebviewGrant } from '@acorn/protocol/api.ts'
import type { PluginCache, PutResult } from './pluginCache'
import type { PluginAck, PluginTrustStore } from './pluginTrustStore'

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

const putSchema = z.strictObject({
  nodeId: z.string().min(1),
  pluginId: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  version: z.string().min(1),
})

const recordSchema = z.strictObject({
  pluginId: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  nodeId: z.string().min(1),
  version: z.string().min(1),
  permissions: z.custom<NodePluginPermissions>(),
  webviews: z.array(z.strictObject({
    surface: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    hosts: z.array(z.string().min(1).max(253)).min(1).max(32),
  })).max(32) as z.ZodType<PluginWebviewGrant[]>,
  decision: z.enum(['accepted', 'rejected']),
})

export type PluginsState = {
  // hash → what we hold. The renderer diffs a node's listing against this to decide what to fetch.
  cached: Record<string, { pluginId: string; version: string; bytes: number }>
  acks: PluginAck[]
}

export function registerPluginIpc(cache: PluginCache, trust: PluginTrustStore): () => void {
  ipcMain.handle(PLUGINS_STATE, async (): Promise<PluginsState> => ({
    // Projected rather than passed through: `nodeIds` and the eviction timestamps are main's
    // bookkeeping, and a field added to the cache entry must not reach the renderer by default.
    cached: Object.fromEntries(
      Object.entries(cache.list()).map(([hash, entry]) => [hash, { pluginId: entry.pluginId, version: entry.version, bytes: entry.bytes }]),
    ),
    acks: trust.list(),
  }))

  ipcMain.handle(PLUGINS_CACHE_PUT, async (_event, raw: unknown): Promise<PutResult> => {
    const { nodeId, pluginId, hash, version } = putSchema.parse(raw)
    return cache.putFromNode(nodeId, pluginId, { hash, version })
  })

  ipcMain.handle(PLUGINS_TRUST_RECORD, async (_event, raw: unknown): Promise<void> => {
    const parsed = recordSchema.parse(raw)
    // Recording a decision about a bundle this device does not hold would leave an acknowledgement
    // pointing at nothing — and, on the accept path, would be an approval granted before the bytes
    // were ever seen. The hash has to be one main computed itself.
    if (!cache.has(parsed.hash)) throw new Error(`No cached bundle for ${parsed.pluginId}@${parsed.hash.slice(0, 12)}`)
    trust.record({ ...parsed, decidedAt: Date.now() })
  })

  return () => {
    for (const channel of [PLUGINS_STATE, PLUGINS_CACHE_PUT, PLUGINS_TRUST_RECORD]) ipcMain.removeHandler(channel)
  }
}

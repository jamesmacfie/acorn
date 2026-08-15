import { ipcMain } from 'electron'
import { z } from 'zod'
import type { PluginExtensionGrant, PluginKeyClaimGrant, PluginWebviewGrant } from '@acorn/protocol/api.ts'
import { pluginPermissionsSchema } from '@acorn/protocol/pluginContract.ts'
import type { PluginCache, PutResult } from './pluginCache'
import type { PluginAck, PluginDevGrant, PluginTrustStore } from './pluginTrustStore'

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

// Enter or leave development mode for one plugin on one node (main/pluginTrustStore.ts). One channel for
// both directions because they are one switch, and because the revoke half must never be harder to reach
// than the grant half.
const devGrantSchema = z.strictObject({
  pluginId: z.string().min(1),
  nodeId: z.string().min(1),
  path: z.string().min(1).max(1024).optional(),
  grant: z.boolean(),
})

const putSchema = z.strictObject({
  nodeId: z.string().min(1),
  pluginId: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  version: z.string().min(1),
})

// The DECISION, split from the disclosure that came with it, because the two have different failure
// budgets. This half identifies the bytes and says yes or no; it is entirely this app's own vocabulary,
// so nothing a node does can make it unparseable, and it must always be recordable.
//
// A plain object rather than a strict one, because both halves are parsed out of the SAME payload and
// each would otherwise reject the other's keys. Nothing is read from the raw payload after this — the
// stored record is built from parsed fields only — so stripping an unknown key is exactly as safe as
// refusing it, and it is what lets a newer renderer add a field without wedging an older main.
const decisionSchema = z.object({
  pluginId: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  nodeId: z.string().min(1),
  version: z.string().min(1),
  decision: z.enum(['accepted', 'rejected']),
})

// The SNAPSHOT, kept only so a later update can show what changed. Parsed, not cast — it is the
// disclosure the owner consents to, so it has to be provably the shape the node parsed off disk
// (@acorn/protocol/pluginContract.ts) — but parsed SEPARATELY, because a node running a newer manifest
// schema than this shell can produce a grant this schema refuses. When that happened with one combined
// schema the whole handler threw, so neither accept NOR reject could be recorded and the prompt
// re-queued on every boot: a plugin the owner had explicitly turned away asked again forever.
const disclosureSchema = z.object({
  permissions: pluginPermissionsSchema,
  webviews: z.array(z.strictObject({
    surface: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    hosts: z.array(z.string().min(1).max(253)).min(1).max(32),
  })).max(32) as z.ZodType<PluginWebviewGrant[]>,
  keyClaims: z.array(z.strictObject({
    surface: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    chords: z.array(z.string().min(1).max(64)).min(1).max(32),
  })).max(32) as z.ZodType<PluginKeyClaimGrant[]>,
  // Defaulted, not required: a node running a manifest schema that predates the cooperative seam sends
  // a disclosure with no such field, and refusing it would put us back in the loop this schema was split
  // up to escape — a decision that cannot be recorded is a prompt that re-queues forever.
  extensions: z.array(z.strictObject({
    kind: z.enum(['hosts', 'extends', 'replaces']),
    target: z.string().min(1).max(130),
    label: z.string().min(1).max(80),
  })).max(32).default([]) as z.ZodType<PluginExtensionGrant[]>,
})

// Nothing recognisable to record, which is still a real acknowledgement of a real decision.
const NO_DISCLOSURE = {
  permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } },
  webviews: [],
  keyClaims: [],
  extensions: [],
} satisfies z.infer<typeof disclosureSchema>

export type PluginsState = {
  // hash → what we hold. The renderer diffs a node's listing against this to decide what to fetch.
  cached: Record<string, { pluginId: string; version: string; bytes: number }>
  acks: PluginAck[]
  devGrants: PluginDevGrant[]
}

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
    // The dev grant's whole effect, and it lives HERE rather than in the renderer for the same reason
    // the hash does: the acknowledgement is written beside the bytes main verified, by the process that
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
    // pointing at nothing — and, on the accept path, would be an approval granted before the bytes
    // were ever seen. The hash has to be one main computed itself.
    if (!cache.has(decision.hash)) throw new Error(`No cached bundle for ${decision.pluginId}@${decision.hash.slice(0, 12)}`)

    const disclosure = disclosureSchema.safeParse(raw)
    if (disclosure.success) {
      trust.record({ ...decision, ...disclosure.data, decidedAt: Date.now() })
      return
    }
    // The decision stands either way; what is lost is the snapshot behind it. Stored as `partial` so
    // it can never become the baseline of a later "what changed" diff, which would otherwise report
    // grants as newly requested that the owner had already seen (main/pluginTrustStore.ts).
    //
    // Recording rather than refusing, on BOTH arms. A rejection needs no snapshot at all — nothing
    // ever diffs against one. And an acceptance is still informed: the lines the owner read were
    // rendered by the renderer from the roster row, which already classifies anything this shell does
    // not recognise into its own "requests this version of acorn does not recognise" line rather than
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

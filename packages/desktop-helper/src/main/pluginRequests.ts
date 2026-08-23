import { z } from 'zod'
import type { PluginExtensionGrant, PluginKeyClaimGrant, PluginScheduleGrant, PluginTaskCheckGrant, PluginWebviewGrant } from '@acorn/protocol/api.ts'
import { pluginPermissionsSchema } from '@acorn/protocol/pluginContract.ts'
import { cadenceSchema } from '@acorn/protocol/schedules.ts'
import type { PluginAck, PluginDevGrant } from './pluginTrustStore'

// What the renderer may say about a third-party plugin bundle, and what it gets back. Two shells parse
// these: the helper's `helperServer.ts` and, before it, Electron's `pluginIpc.ts`. They live beside the
// stores they guard rather than in either shell, because a schema that drifted between the two would
// mean one host recording an acknowledgement the other cannot read.
//
// The renderer supplies `claim` (the hash and version a node advertised) and `display` (the version and
// permissions to record with a decision). Both are untrusted and both are re-checked or display-only:
// `claim.hash` is asserted against the bytes the host hashed, and `display` is only ever rendered back
// to the owner in a later permission diff. Nothing here grants anything.

// Enter or leave development mode for one plugin on one node (./pluginTrustStore.ts). One channel for
// both directions because they are one switch, and because the revoke half must never be harder to reach
// than the grant half.
export const devGrantSchema = z.strictObject({
  pluginId: z.string().min(1),
  nodeId: z.string().min(1),
  path: z.string().min(1).max(1024).optional(),
  grant: z.boolean(),
})

export const putSchema = z.strictObject({
  nodeId: z.string().min(1),
  pluginId: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  version: z.string().min(1),
})

// The decision, split from the disclosure that came with it, because the two have different failure
// budgets. This half identifies the bytes and says yes or no; it is entirely this app's own
// vocabulary, so nothing a node does can make it unparseable, and it must always be recordable.
//
// A plain object rather than a strict one, because both halves are parsed out of the same payload and
// each would otherwise reject the other's keys. Nothing is read from the raw payload after this: the
// stored record is built from parsed fields only, so stripping an unknown key is exactly as safe as
// refusing it, and it is what lets a newer renderer add a field without wedging an older main.
export const decisionSchema = z.object({
  pluginId: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  nodeId: z.string().min(1),
  version: z.string().min(1),
  decision: z.enum(['accepted', 'rejected']),
})

// The snapshot, kept only so a later update can show what changed. Parsed, not cast: it is the
// disclosure the owner consents to, so it has to be provably the shape the node parsed off disk
// (@acorn/protocol/pluginContract.ts). But parsed separately, because a node running a newer manifest
// schema than this shell can produce a grant this schema refuses. When that happened with one combined
// schema the whole handler threw, so neither accept nor reject could be recorded, and the prompt
// re-queued on every boot: a plugin the owner had explicitly turned away asked again forever.
export const disclosureSchema = z.object({
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
  // a disclosure with no such field, and refusing it would put us back in the loop this schema was
  // split up to escape. A decision that cannot be recorded is a prompt that re-queues forever.
  extensions: z.array(z.strictObject({
    kind: z.enum(['hosts', 'extends', 'replaces']),
    target: z.string().min(1).max(130),
    label: z.string().min(1).max(80),
  })).max(32).default([]) as z.ZodType<PluginExtensionGrant[]>,
  // Defaulted for the same reason `extensions` is: a node whose manifest schema predates schedules sends
  // a disclosure without the field, and refusing it would put a decision beyond recording.
  schedules: z.array(z.strictObject({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    cadence: cadenceSchema,
  })).max(4).default([]) as z.ZodType<PluginScheduleGrant[]>,
  // Defaulted for the same reason the two above are: a node whose manifest schema predates archive
  // checks sends a disclosure without the field.
  taskChecks: z.array(z.strictObject({
    id: z.string().min(1).max(64),
    cleansUp: z.boolean(),
  })).max(4).default([]) as z.ZodType<PluginTaskCheckGrant[]>,
})

// Nothing recognisable to record, which is still a real acknowledgement of a real decision.
export const NO_DISCLOSURE = {
  permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } },
  webviews: [],
  keyClaims: [],
  extensions: [],
  schedules: [],
  taskChecks: [],
} satisfies z.infer<typeof disclosureSchema>

export type PluginsState = {
  // hash → what we hold. The renderer diffs a node's listing against this to decide what to fetch.
  cached: Record<string, { pluginId: string; version: string; bytes: number }>
  acks: PluginAck[]
  devGrants: PluginDevGrant[]
}

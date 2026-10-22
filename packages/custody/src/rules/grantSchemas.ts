import { z } from 'zod'
import type { PluginCustomAgentGrant, PluginExtensionGrant } from '@acorn/protocol/api.ts'
import { EXTENSION_POINT_KINDS, HOOK_MODES } from '@acorn/protocol/extensionPoints.ts'

// One schema for the disclosure arriving from the renderer and the acknowledgement persisted by the
// host. `pointKind` and `mode` affect the sentence and comparison key, so accepting them in only one
// of those two places would either re-prompt forever or store a consent record it cannot read back.
export const pluginExtensionGrantSchema = z.strictObject({
  kind: z.enum(['hosts', 'extends', 'replaces']),
  pointKind: z.enum(EXTENSION_POINT_KINDS).optional(),
  mode: z.enum(HOOK_MODES).optional(),
  // A `<pluginId>:<pointId>` reference or a designated core slot id, both bounded by the manifest.
  target: z.string().min(1).max(130),
  label: z.string().min(1).max(80),
}) as z.ZodType<PluginExtensionGrant>

// The same rule for a contributed custom agent. Its instructions are part of the comparison, so a
// changed text reads as newly requested, and both sides have to accept the whole of it.
export const pluginCustomAgentGrantSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  harness: z.string().min(1).max(130),
  instructions: z.string().min(1).max(16_000).nullable(),
  maxToolRisk: z.enum(['read', 'write', 'execute']).nullable(),
}) as z.ZodType<PluginCustomAgentGrant>

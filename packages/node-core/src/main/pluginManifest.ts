// `acorn-plugin.json` — the file at the root of an installed plugin package, and the only thing the
// loader trusts about it (docs/third-party/phase-1-node-loader.md § The manifest).
//
// It arrives from disk rather than from the wire, and it is still parsed with a module-level Zod
// schema and `safeParse` (docs/architecture-overview.md § wire validation). Disk is a trust boundary
// here for the same reason a request body is: the bytes were written by someone other than us, and
// everything downstream — a route namespace, a SQLite filename, a set of CoreServices facets — is
// bound from what this file says.
//
// The HOST binds every namespace from `id`. `plugin.name` inside the bundle is checked to match and
// otherwise ignored, so a bundle cannot mount itself under another plugin's prefix by lying.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

// Re-exported so this file stays the one import for everything manifest-shaped. The constant itself
// moved to @acorn/protocol when the client gained a stake in it: the node uses it to decide what to
// LOAD, the client to decide which of a fleet's bundles it can RUN
// (client-core/plugins/resolveBundles.ts), and one compatibility contract cannot live on one side.
export { PLUGIN_API_MAJOR } from '@acorn/protocol/api.ts'

// Same shape as the route registry's and the plugin database factory's id rules, plus a length
// bound, because this id becomes both `/v2/p/<id>` and `<dataRoot>/plugins/<id>.sqlite`.
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/

// Node-half permissions. This block SHAPES `ctx` (main/pluginPermissions.ts) and is disclosed to the
// user; it is not enforced, because a loaded bundle shares the Node's process and can import
// `node:fs` directly. docs/third-party/node-security.md is blunt about that distinction and every
// surface rendering this block has to preserve it.
const nodePermissions = z.object({
  // CoreServices facets. Tokens are validated in pluginPermissions.ts rather than here: an unknown
  // token is a facet this acorn does not have, which is a skip-that-facet, not a bad manifest.
  core: z.array(z.string().min(1)).max(64).default([]),
  capabilities: z.array(z.string().min(1)).max(64).default([]),
  // Use-scoped credential access through ctx.core.secrets.
  secrets: z.boolean().default(false),
  // The process broker (ctx.core.proc).
  exec: z.boolean().default(false),
  // Intended egress hosts. Pure disclosure until the credential broker and rung 2/3 land.
  net: z.array(z.string().min(1)).max(64).default([]),
})

export type NodePermissions = z.infer<typeof nodePermissions>

// A relative entrypoint. Absolute paths and `..` escapes are rejected here so the loader's
// confinement check never has to reason about a path that was hostile from the start.
const entry = z.string().min(1).max(256).refine(
  (value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'),
  'entrypoint must be a relative path inside the plugin directory',
)

// `api`, `events` and `contributions` are validated but unused: phase 3 hard-enforces the first two
// on the UI bridge and phase 4 renders the third. They are parsed now so a manifest written today
// is still valid then, and so the schema stops being a moving target for early authors.
export const pluginManifestSchema = z.object({
  id: z.string().regex(ID_RE, `plugin id must match ${ID_RE.source}`),
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(64),
  apiVersion: z.string().min(1).max(16),
  node: entry.optional(),
  client: entry.optional(),
  permissions: z.object({
    api: z.array(z.string().min(1)).max(64).default([]),
    events: z.array(z.string().min(1)).max(64).default([]),
    node: nodePermissions.prefault({}),
  }).prefault({}),
  contributions: z.record(z.string(), z.unknown()).default({}),
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>

export const MANIFEST_FILE = 'acorn-plugin.json'

// Never throws. A missing, unreadable, non-JSON or schema-violating manifest is all one outcome —
// "this directory is not a plugin we can run" — and the loader turns that into a skip plus a report.
export function readPluginManifest(dir: string): PluginManifest | null {
  try {
    const parsed = pluginManifestSchema.safeParse(JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

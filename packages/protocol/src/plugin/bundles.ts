import { z } from 'zod'

/** Where the device obtained the bytes. Trust remains keyed on plugin id and hash. */
export const bundleSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('node'), nodeId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('device') }),
])
export type BundleSource = z.infer<typeof bundleSourceSchema>

const DEVICE_CONTRIBUTIONS = new Set([
  'frames', 'sources', 'commands', 'keybindings', 'contentLinks', 'themes', 'styles',
  'contextMenus', 'extensionPoints', 'extensions',
])

// These values address a handler in the plugin's own Node namespace. A remote tree can ask for
// ordinary core API grants, but no device package can supply one of these handlers.
const NODE_ROUTE_FIELDS = new Set([
  'route', 'readRoute', 'writeRoute', 'items', 'data', 'options', 'capture', 'resolve',
  'read', 'write', 'urlSource',
])

function needsNodeRoute(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(needsNodeRoute)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.verb === 'runNodeAction' || record.kind === 'hook') return true
  return Object.entries(record).some(([key, child]) =>
    (NODE_ROUTE_FIELDS.has(key) && typeof child === 'string') || needsNodeRoute(child))
}

/** Device bundles may declare client contributions only. Check both parsed and loose manifests. */
export function hasNodeHalf(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== 'object') return false
  const record = manifest as Record<string, unknown>
  if (record.node !== undefined || record.migrations !== undefined) return true
  const permissions = record.permissions && typeof record.permissions === 'object' ? record.permissions as Record<string, unknown> : {}
  const node = permissions.node && typeof permissions.node === 'object' ? permissions.node as Record<string, unknown> : {}
  if (Object.values(node).some((value) => Array.isArray(value) ? value.length > 0 : value === true)) return true
  const contributions = record.contributions && typeof record.contributions === 'object'
    ? record.contributions as Record<string, unknown> : {}
  for (const [kind, value] of Object.entries(contributions)) {
    if (!DEVICE_CONTRIBUTIONS.has(kind) && (Array.isArray(value) ? value.length > 0 : value !== undefined)) return true
  }
  return needsNodeRoute(contributions)
}

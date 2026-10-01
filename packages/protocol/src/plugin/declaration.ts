import type { InstalledPluginRow, PluginRuntimeIdentity } from '../transport/api.ts'

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** The client authority represented by a plugin offer, independent of roster metadata and bundle
 * provenance. Both a running identity and an installed candidate must produce the same value for
 * equivalent declarations. Persist this with consent so a node cannot widen grants under old bytes. */
export const clientDeclaration = (declaration: Pick<InstalledPluginRow | PluginRuntimeIdentity,
  'apiVersion' | 'permissions' | 'contributions' | 'emits'>): string => canonical({
  apiVersion: declaration.apiVersion,
  permissions: declaration.permissions,
  contributions: declaration.contributions,
  emits: declaration.emits ?? [],
})

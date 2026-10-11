import type { NodePluginRow, PluginRuntimeIdentity } from '@acorn/protocol/api.ts'

/** A modern node states absence with `active: null`. Only an omitted field can be an old cached
 * response, and old rows are usable solely when disk and running state were reported as aligned.
 * Mixed-version path until 2026-12-26. */
export function runtimeIdentityForRow(row: NodePluginRow): PluginRuntimeIdentity | null {
  if (row.active !== undefined) return row.active
  if (row.state !== 'active' || !row.running || !row.installed) return null
  const { source: _source, bundled: _bundled, installedAt: _installedAt, ...declaration } = row.installed
  return { ...declaration, activation: 'node' }
}

/** Mixed-version path until 2026-12-26. */
export const legacyRuntimeIdentityWithheld = (row: NodePluginRow): boolean =>
  row.active === undefined && row.installed !== undefined && runtimeIdentityForRow(row) === null

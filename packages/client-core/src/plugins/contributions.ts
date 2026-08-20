import type { InstalledPluginRow, NodePluginRow, PluginContributions } from '@acorn/protocol/api.ts'
import { isOverlaySurface, isProjectPaneSurface, isTaskPaneSurface } from '@acorn/protocol/pluginContract.ts'
import { activeBundles, bundleAccepted, installedByNode } from './distribution'

// Who may contribute, and what they declared: the shared identity-and-trust check both registration
// passes need before either can draw anything (docs/plugins.md § One shared eligibility and trust
// check for why this used to be duplicated between frames/register.ts and chrome/register.ts, and what
// broke when the two copies drifted).

export type EligiblePlugin = {
  pluginId: string
  row: NodePluginRow
  installed: InstalledPluginRow
  // The bundle this device would actually run, the winner of fleet resolution, or '' when nothing
  // runnable resolved (docs/plugins.md § One shared eligibility and trust check).
  hash: string
  // May this device execute this plugin's code? See docs/plugins.md § One shared eligibility and trust
  // check for the frames-versus-chrome distinction this backs.
  trusted: boolean
}

/**
/** Every plugin whose contributions this device may draw, one row per plugin id, already labelled with
 *  its trust state (docs/plugins.md § One shared eligibility and trust check). */
export function eligiblePlugins(): EligiblePlugin[] {
  const bundles = activeBundles()
  const rowsById = new Map<string, { row: NodePluginRow; installed: InstalledPluginRow }[]>()
  for (const roster of installedByNode().values()) {
    for (const row of roster) {
      if (!row.installed) continue
      const entry = { row, installed: row.installed }
      const rows = rowsById.get(row.name)
      if (rows) rows.push(entry)
      else rowsById.set(row.name, [entry])
    }
  }

  const eligible: EligiblePlugin[] = []
  for (const [pluginId, rows] of rowsById) {
    const winner = bundles?.get(pluginId)
    const chosen = (winner && rows.find((entry) => entry.installed.client?.hash === winner.hash)) ?? rows[0]!
    // No fallback to the row's own claimed hash (docs/plugins.md § One shared eligibility and trust
    // check explains why).
    const hash = winner && chosen.installed.client?.hash === winner.hash ? winner.hash : ''
    eligible.push({
      pluginId,
      row: chosen.row,
      installed: chosen.installed,
      hash,
      trusted: hash !== '' && bundleAccepted(pluginId, hash),
    })
  }
  return eligible
}

/**
/** Does this package carry code this device has not been cleared to run? See docs/plugins.md § One
 *  shared eligibility and trust check for how this differs from `trusted`. */
export const hasWithheldCode = (entry: EligiblePlugin): boolean => entry.installed.client !== null && !entry.trusted

/**
/**
 * A task-scoped pane, which is the only kind of surface a task's layout can hold.
 *
 * Re-exported rather than written here: the node's manifest parser asks the same question when it
 * checks that an `openPane` names a pane the manifest declares, so the predicate lives in the contract
 * both sides read (@acorn/protocol/pluginContract.ts).
 */
export { isTaskPaneSurface as isTaskPane } from '@acorn/protocol/pluginContract.ts'

export type DeclaredSurfaces = {
  // Task-scoped panes: the `openPane` allowlist (docs/plugins.md § One shared eligibility and trust check).
  panes: ReadonlySet<string>
  // The detail half of a rail source's browse, kept out of `panes` (docs/plugins.md § One shared
  // eligibility and trust check).
  projectPanes: ReadonlySet<string>
  // Full-screen pickers the host places. Not panes (docs/plugins.md § One shared eligibility and trust
  // check).
  overlays: ReadonlySet<string>
}

/** The surface classification both passes work from. */
export function declaredSurfaces(contributions: PluginContributions): DeclaredSurfaces {
  const frames = contributions.frames ?? []
  return {
    panes: new Set(frames.filter(isTaskPaneSurface).map((frame) => frame.id)),
    projectPanes: new Set(frames.filter(isProjectPaneSurface).map((frame) => frame.id)),
    overlays: new Set(frames.filter(isOverlaySurface).map((frame) => frame.id)),
  }
}

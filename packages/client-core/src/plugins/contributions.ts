import type { InstalledPluginRow, NodePluginRow, PluginContributions } from '@acorn/protocol/api.ts'
import { isOverlaySurface, isProjectPaneSurface, isTaskPaneSurface } from '@acorn/protocol/pluginContract.ts'
import { activeBundles, bundleAccepted, installedByNode } from './distribution'

// Who may contribute, and what they declared. The two questions both registration passes have to
// answer before either can draw anything.
//
// They used to answer them separately: `eligible()` was written out in frames/register.ts and again
// in chrome/register.ts, and the task-pane predicate was byte-identical copy-paste in both. That
// predicate is not cosmetic — it feeds the `openPane` allowlist, the list deciding which pane ids a
// sandboxed frame may ask the host to open — so it was a security check maintained in two places,
// connected by nothing. A new frame target updated in one copy and not the other fails silently in
// whichever direction the author happened to miss, and `tsc` stays quiet because each copy is
// locally consistent.
//
// The split between the two passes stays: rendering a sandboxed iframe and registering a command
// palette row genuinely are different jobs. What moves here is the part that was never supposed to
// differ — identity and trust — so the seam is cut with the decisions behind it and only the
// rendering strategy in front.

export type EligiblePlugin = {
  pluginId: string
  row: NodePluginRow
  installed: InstalledPluginRow
  // The bundle this device would actually run — the winner of fleet resolution — or '' when nothing
  // runnable resolved. Empty covers two different situations, and `installed.client` is what tells
  // them apart: a package with no client half has nothing to run, while a package whose bundle lost
  // resolution (an apiVersion this shell does not speak) has code it cannot run.
  hash: string
  // May this device EXECUTE this plugin's code? True only for a resolved bundle whose exact bytes the
  // owner accepted. False for a package with no client half — there is nothing to execute, and saying
  // "trusted" about it would let a webview surface mount external content behind a prompt that can
  // never fire (the trust queue only ever holds bundles).
  //
  // The two consumers ask different questions of this and that difference is deliberate: frames gates
  // code-bearing surfaces on it, while chrome asks the weaker "does this package have code I have not
  // been cleared to run" — see each call site.
  trusted: boolean
}

/**
 * Every plugin whose contributions this device may draw, one row per plugin id, already labelled with
 * its trust state.
 *
 * The row is the one whose bundle WON fleet resolution, not the first one seen. Those differ in a
 * mixed-version fleet — node A offering v1 first while node B's v2 wins — and taking the manifest from
 * one row and the hash from another means registering contributions declared by bytes nobody accepted.
 * Manifest, hash and trust all come from the same row, or the answer is not about anything.
 *
 * A package with no client half anywhere in the fleet never enters resolution, so first-seen is the
 * only available answer for it; it is also the pre-existing one, and such a package contributes
 * descriptors and host-drawn surfaces whose behaviour does not turn on which node described them.
 */
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
    // No fallback to the row's own claimed hash. `activeBundles` is the answer to "which bytes would
    // this device actually run", and when it has no answer the honest hash is none: a plugin whose
    // candidate was dropped at resolution still carries a `client.hash` in its roster row, and
    // trusting that would let an acceptance recorded against an older, runnable build clear a bundle
    // this shell has already decided it cannot run.
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
 * Does this package carry code this device has not been cleared to run? The weaker question, and the
 * one the chrome pass gates on: a descriptor-only package has no such code and its rail rows and
 * commands are host-drawn, so withholding them would hide a plugin that executes nothing.
 */
export const hasWithheldCode = (entry: EligiblePlugin): boolean => entry.installed.client !== null && !entry.trusted

/**
 * A task-scoped pane, which is the only kind of surface a task's layout can hold.
 *
 * Re-exported rather than written here: the NODE's manifest parser asks the same question when it
 * checks that an `openPane` names a pane the manifest declared, so the predicate lives in the contract
 * both sides read (@acorn/protocol/pluginContract.ts). It used to be spelled here, in chrome's
 * register module, and a third time in the node parser — where it was spelled differently.
 */
export { isTaskPaneSurface as isTaskPane } from '@acorn/protocol/pluginContract.ts'

export type DeclaredSurfaces = {
  // Task-scoped panes: the `openPane` allowlist, in both the descriptor verbs and the frame bridge.
  panes: ReadonlySet<string>
  // The detail half of a rail source's browse. It has a URL, not a slot in a task's layout, so it is
  // kept out of `panes` — an `openPane` naming one would be an offer that can only fail.
  projectPanes: ReadonlySet<string>
  // Full-screen pickers the host places. Not panes: an overlay belongs to no task layout, so folding
  // it into the set above would make `openPane` accept one.
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

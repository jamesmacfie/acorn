import { PLUGIN_API_MAJOR, type NodePluginRow, type PluginContributions, type PluginRuntimeIdentity } from '@acorn/protocol/api.ts'
import { speaksApiVersion } from '@acorn/protocol/plugin/apiVersion.ts'
import { hasFrameRegion, hasRemoteRegion, isOverlaySurface, isProjectPaneSurface, isTaskPaneSurface } from '@acorn/protocol/plugin/contract.ts'
import { namespaceContributions } from './contributionIds'
import { activeNodeId } from '../../infra/node/activeNode'
import { distribution } from './distribution'
import { runtimeIdentityForRow } from './runtimeIdentity'
import { decisionKey } from './distributionModel'

// Who may contribute, and what they declared: the shared identity-and-trust check both registration
// passes need before either can draw anything (docs/plugins/distribution.md § One shared eligibility and trust
// check for why this used to be duplicated between frames/register.ts and chrome/register.ts, and what
// broke when the two copies drifted).

export type EligiblePlugin = {
  pluginId: string
  row: NodePluginRow
  installed: PluginRuntimeIdentity
  inactive: boolean
  // The bundle selected for the active node's running identity, or '' when none is usable.
  hash: string
  // May this device execute this plugin's code? See docs/plugins/distribution.md § One shared eligibility and trust
  // check for the frames-versus-chrome distinction this backs.
  trusted: boolean
}

/** Every plugin whose contributions this device may draw, one row per plugin id, already labelled with
 *  its trust state (docs/plugins/distribution.md § One shared eligibility and trust check). */
export function eligiblePlugins(options: { includeInactive?: boolean } = {}): EligiblePlugin[] {
  const snapshot = distribution()
  const nodeId = activeNodeId() ?? snapshot.byNode.keys().next().value
  const eligible: EligiblePlugin[] = []
  for (const [pluginId, entry] of snapshot.selectedDevice) {
    const runtime = entry.row.installed && { ...entry.row.installed, activation: 'client-only' as const }
    if (!runtime || entry.row.disabled) continue
    const hash = entry.hash
    const trusted = snapshot.cachedHashes.has(hash) && snapshot.acceptedKeys.has(decisionKey(pluginId, hash))
    eligible.push({
      pluginId, row: { ...entry.row, installed: runtime },
      installed: { ...runtime, contributions: namespaceContributions(pluginId, runtime.contributions) },
      inactive: false, hash, trusted,
    })
  }
  if (!nodeId) return eligible
  const observation = snapshot.byNode.get(nodeId)
  if (!observation?.reachable || observation.stale) return eligible
  for (const row of observation.rows) {
    if (snapshot.selectedDevice.has(row.name)) continue
    const active = runtimeIdentityForRow(row)
    // Chrome keeps command and shortcut metadata for a disabled plugin so saved bindings stay
    // explainable. Every invocation still checks the active runtime on this node.
    const runtime = active ??
      (options.includeInactive && row.installed ? { ...row.installed, activation: 'node' as const } : null)
    if (!runtime) continue
    const selection = snapshot.selectionsByNode.get(nodeId)?.get(row.name)
    const hash = speaksApiVersion(runtime.apiVersion, PLUGIN_API_MAJOR)
      ? selection?.hash ?? runtime.client?.hash ?? ''
      : ''
    // The one place a manifest's declared ids are bound to the plugin's own name (./contributionIds.ts).
    // Here rather than at each registration site, so every consumer below reads one spelling: the
    // registries, the `openPane` allowlist, the extension-point bindings and the content-link router all
    // work off this object.
    const installed = { ...runtime, contributions: namespaceContributions(row.name, runtime.contributions) }
    eligible.push({
      pluginId: row.name,
      row: { ...row, installed: runtime },
      installed,
      inactive: !active,
      hash,
      trusted: hash !== '' && selection?.hash === hash,
    })
  }
  return eligible
}

/** Does this package carry code this device has not been cleared to run? See docs/plugins/distribution.md § One
 *  shared eligibility and trust check for how this differs from `trusted`. */
export const hasWithheldCode = (entry: EligiblePlugin): boolean => entry.installed.client !== null && !entry.trusted

/**
 * A task-scoped pane, which is the only kind of surface a task's layout can hold.
 *
 * Re-exported rather than written here: the node's manifest parser asks the same question when it
 * checks that an `openPane` names a pane the manifest declares, so the predicate lives in the contract
 * both sides read (@acorn/protocol/plugin/contract.ts).
 */
export { isTaskPaneSurface as isTaskPane } from '@acorn/protocol/plugin/contract.ts'

export type DeclaredSurfaces = {
  // Task-scoped panes: the `openPane` allowlist (docs/plugins/distribution.md § One shared eligibility and trust check).
  panes: ReadonlySet<string>
  // The detail half of a rail source's browse, kept out of `panes` (docs/plugins/distribution.md § One shared
  // eligibility and trust check).
  projectPanes: ReadonlySet<string>
  // Full-screen pickers the host places. Not panes (docs/plugins/distribution.md § One shared eligibility and trust
  // check).
  overlays: ReadonlySet<string>
  // Panes of either scope that draw at least one region with this plugin's own bytes: the
  // `surfaceAction` allowlist. The verb delivers a command id across the bridge, so what it needs is a
  // pane on the far end of one — an iframe region and a worker region qualify alike, and a pane whose
  // regions are all host-drawn does not, because there would be nothing listening.
  actionPanes: ReadonlySet<string>
}

/** The surface classification both passes work from. */
export function declaredSurfaces(contributions: PluginContributions): DeclaredSurfaces {
  const frames = contributions.frames ?? []
  return {
    panes: new Set(frames.filter(isTaskPaneSurface).map((frame) => frame.id)),
    projectPanes: new Set(frames.filter(isProjectPaneSurface).map((frame) => frame.id)),
    overlays: new Set(frames.filter(isOverlaySurface).map((frame) => frame.id)),
    actionPanes: new Set(
      frames
        .filter((frame) => frame.target === 'pane' && (hasFrameRegion(frame) || hasRemoteRegion(frame)))
        .map((frame) => frame.id),
    ),
  }
}

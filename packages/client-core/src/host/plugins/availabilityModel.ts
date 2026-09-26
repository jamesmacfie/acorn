import { speaksApiVersion } from '@acorn/protocol/plugin/apiVersion.ts'
import type { InstalledPluginRow, NodePluginRow, PluginRuntimeIdentity } from '@acorn/protocol/api.ts'
import { runtimeIdentityForRow } from './runtimeIdentity'
import { decisionKey, type PluginDistributionSnapshot } from './distributionModel'

export type NodePluginRuntimeState =
  | { kind: 'unknown' }
  | { kind: 'unreachable'; lastKnown?: PluginRuntimeIdentity }
  | { kind: 'absent' }
  | { kind: 'compiled-active' }
  | { kind: 'disabled' }
  | { kind: 'failed'; stage?: string; reason?: string }
  | { kind: 'waiting-for-restart'; candidate: InstalledPluginRow }
  | { kind: 'active'; runtime: PluginRuntimeIdentity; pendingCandidate?: InstalledPluginRow; warning?: string }

export type LoadedSelectionState =
  | { kind: 'accepted'; hash: string }
  | { kind: 'pending-trust'; hash: string }
  | { kind: 'rejected'; hash: string }
  | { kind: 'bundle-missing'; hash: string }
  | { kind: 'incompatible' }
  | { kind: 'declaration-conflict'; hash: string }
  | { kind: 'none' }

export type ContributionAvailability = {
  available: boolean
  runtime: NodePluginRuntimeState
  selection: LoadedSelectionState
  reason: NodePluginRuntimeState['kind'] | LoadedSelectionState['kind']
}

/** The roster is the only running proof for a compiled built-in, which has no bundle declaration. */
export const compiledServiceActive = (row: NodePluginRow): boolean =>
  (row.active === null || (!row.installed && row.active === undefined)) &&
  row.running && (row.state === 'active' || row.state === 'pending-restart')

export function nodePluginRuntime(
  snapshot: PluginDistributionSnapshot,
  nodeId: string,
  pluginId: string,
): NodePluginRuntimeState {
  const observation = snapshot.byNode.get(nodeId)
  if (!observation) return { kind: 'unknown' }
  const row = observation.rows.find((candidate) => candidate.name === pluginId)
  if (!observation.reachable || observation.stale) {
    const lastKnown = row && runtimeIdentityForRow(row)
    return { kind: 'unreachable', ...(lastKnown ? { lastKnown } : {}) }
  }
  if (!row) return { kind: 'absent' }
  const runtime = runtimeIdentityForRow(row)
  if (runtime) {
    const pendingCandidate = row.installed &&
      (row.installed.version !== runtime.version || row.installed.client?.hash !== runtime.client?.hash)
      ? row.installed : undefined
    return {
      kind: 'active', runtime,
      ...(pendingCandidate ? { pendingCandidate } : {}),
      ...(row.state === 'failed' && row.reason ? { warning: row.reason } : {}),
    }
  }
  // Built-in node plugins have no installed package declaration or client bundle. Their roster
  // outcome is the runtime proof for compiled contributions, while loaded UI still requires an
  // explicit client identity and exact-hash selection below.
  if (compiledServiceActive(row)) {
    return { kind: 'compiled-active' }
  }
  if (row.state === 'failed') return { kind: 'failed', ...(row.stage ? { stage: row.stage } : {}), ...(row.reason ? { reason: row.reason } : {}) }
  if (row.disabled || row.state === 'disabled') return { kind: 'disabled' }
  if (row.installed) return { kind: 'waiting-for-restart', candidate: row.installed }
  return { kind: 'absent' }
}

/** The shared node-runtime gate for compiled contributions with `{ plugin: id }`. */
export const nodePluginServiceAvailable = (snapshot: PluginDistributionSnapshot, nodeId: string, pluginId: string): boolean => {
  const state = nodePluginRuntime(snapshot, nodeId, pluginId)
  return state.kind === 'compiled-active' || (state.kind === 'active' && state.runtime.activation === 'node')
}

export function contributionAvailability(
  snapshot: PluginDistributionSnapshot,
  nodeId: string,
  pluginId: string,
  apiVersion: string,
): ContributionAvailability {
  const runtime = nodePluginRuntime(snapshot, nodeId, pluginId)
  if (runtime.kind !== 'active') return { available: false, runtime, selection: { kind: 'none' }, reason: runtime.kind }
  if (!speaksApiVersion(runtime.runtime.apiVersion, apiVersion)) {
    return { available: false, runtime, selection: { kind: 'incompatible' }, reason: 'incompatible' }
  }
  const hash = runtime.runtime.client?.hash ?? ''
  const key = decisionKey(pluginId, hash)
  if (snapshot.conflictingKeys.has(key)) {
    return { available: false, runtime, selection: { kind: 'declaration-conflict', hash }, reason: 'declaration-conflict' }
  }
  const selection = snapshot.selectionsByNode.get(nodeId)?.get(pluginId)
  if (selection?.hash === hash) return { available: true, runtime, selection: { kind: 'accepted', hash }, reason: 'accepted' }
  if (!hash) return { available: false, runtime, selection: { kind: 'none' }, reason: 'none' }
  if (!snapshot.cachedHashes.has(hash)) return { available: false, runtime, selection: { kind: 'bundle-missing', hash }, reason: 'bundle-missing' }
  const decision = snapshot.decisionsByKey.get(key)
  if (decision === 'rejected') return { available: false, runtime, selection: { kind: 'rejected', hash }, reason: 'rejected' }
  return { available: false, runtime, selection: { kind: 'pending-trust', hash }, reason: 'pending-trust' }
}

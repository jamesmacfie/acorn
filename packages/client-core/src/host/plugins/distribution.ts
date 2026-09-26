import { createSignal } from 'solid-js'
import { corePluginsRoute, PLUGIN_API_MAJOR, type NodePluginRow, type NodePluginState } from '@acorn/protocol/api.ts'
import type { PluginAckRecord, PluginHostState } from '../../infra/platform'
import { readJson } from '../../infra/node/apiClient'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodes, nodeState } from '../../infra/node/fleet'
import { cachePluginBundle, pluginHostAvailable, readPluginHostState } from './host'
import { createLogger } from '../../infra/telemetry/logger'
import { runtimeIdentityForRow, legacyRuntimeIdentityWithheld } from './runtimeIdentity'
import {
  decisionKey, derivePluginDistribution,
  type NodePluginObservation, type PluginDistributionSnapshot, type PluginTrustRequest,
} from './distributionModel'
import { contributionAvailability, nodePluginRuntime, nodePluginServiceAvailable } from './availabilityModel'
import { stopTreeWorker } from '../tree/workerHost'

const log = createLogger('plugins')
const emptyHost = (): PluginHostState => ({ cached: {}, acks: [], devGrants: [] })
const emptySnapshot = (): PluginDistributionSnapshot => derivePluginDistribution(new Map(), emptyHost(), 0, PLUGIN_API_MAJOR)
const [distribution, setDistribution] = createSignal<PluginDistributionSnapshot>(emptySnapshot())
let initialized = false
let requestedGeneration = 0
let reconcileTail: Promise<void> = Promise.resolve()
let lastHostState = emptyHost()
const dismissed = new Set<string>()
const listeners = new Set<() => void>()

export { distribution }
export type { PluginTrustRequest }

// Compatibility projections. The snapshot is the only mutable source of truth.
export const installedByNode = (): ReadonlyMap<string, readonly NodePluginRow[]> =>
  new Map([...distribution().byNode].map(([id, observation]) => [id, observation.rows]))
export const pendingTrust = (): readonly PluginTrustRequest[] =>
  distribution().pendingTrust.filter((request) => !dismissed.has(decisionKey(request.row.name, request.hash)))
export const activeBundles = (): ReadonlyMap<string, { hash: string }> | null => {
  if (!initialized) return null
  const snapshot = distribution()
  const nodeId = activeNodeId() ?? snapshot.byNode.keys().next().value
  const selections = nodeId ? snapshot.selectionsByNode.get(nodeId) : undefined
  return new Map([...(selections ?? [])].map(([id, selection]) => [id, { hash: selection.hash }]))
}
export const bundleAccepted = (pluginId: string, hash: string): boolean =>
  distribution().acceptedKeys.has(decisionKey(pluginId, hash))

export const pluginEnabledOnNode = (nodeId: string, pluginId: string): boolean =>
  contributionAvailability(distribution(), nodeId, pluginId, PLUGIN_API_MAJOR).available
export const pluginServiceAvailableOnNode = (nodeId: string, pluginId: string): boolean =>
  nodePluginServiceAvailable(distribution(), nodeId, pluginId)

export type LoadedPluginState = 'enabled' | 'disabled' | 'absent'
export const loadedPluginStateOnNode = (nodeId: string, pluginId: string): LoadedPluginState => {
  const runtime = nodePluginRuntime(distribution(), nodeId, pluginId)
  return runtime.kind === 'active' || runtime.kind === 'compiled-active' ? 'enabled'
    : runtime.kind === 'absent' || runtime.kind === 'unknown' ? 'absent' : 'disabled'
}
export const pluginInstalledAtOnNode = (nodeId: string, pluginId: string): number | undefined =>
  distribution().byNode.get(nodeId)?.rows.find((row) => row.name === pluginId)?.installed?.installedAt

export function onPluginDistributionCommit(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const activeSelectionSignature = (snapshot: PluginDistributionSnapshot): string => {
  const nodeId = activeNodeId() ?? snapshot.byNode.keys().next().value
  const selections = nodeId ? snapshot.selectionsByNode.get(nodeId) : undefined
  const observation = nodeId ? snapshot.byNode.get(nodeId) : undefined
  const runtimes = observation?.reachable && !observation.stale
    ? observation.rows.map((row) => {
      const runtime = runtimeIdentityForRow(row)
      return [row.name, runtime?.version, runtime?.client?.hash, runtime?.contributions,
        runtime ? null : row.installed?.contributions]
    })
    : []
  return JSON.stringify([nodeId, runtimes, [...(selections ?? [])].map(([id, selection]) => [id, selection.hash])])
}

function publish(next: PluginDistributionSnapshot): void {
  const previous = distribution()
  const changed = activeSelectionSignature(previous) !== activeSelectionSignature(next)
  const selectedKeys = (snapshot: PluginDistributionSnapshot): ReadonlySet<string> =>
    new Set([...snapshot.selectionsByNode.values()].flatMap((entries) =>
      [...entries.values()].filter((selection) => selection.hash).map((selection) => decisionKey(selection.pluginId, selection.hash))))
  const retained = selectedKeys(next)
  for (const key of selectedKeys(previous)) if (!retained.has(key)) {
    const [pluginId, hash] = JSON.parse(key) as [string, string]
    stopTreeWorker({ pluginId, hash }, 'plugin selection withdrawn')
  }
  initialized = true
  setDistribution(next)
  if (changed) for (const listener of listeners) listener()
}

export function notifyActivePluginNodeChanged(): void {
  for (const listener of listeners) listener()
}

export function markPluginNodeStale(nodeId: string): void {
  const current = distribution()
  const observation = current.byNode.get(nodeId)
  if (!observation || observation.stale) return
  const byNode = new Map(current.byNode)
  byNode.set(nodeId, { ...observation, reachable: false, stale: true })
  publish(derivePluginDistribution(byNode, lastHostState, current.revision + 1, PLUGIN_API_MAJOR))
}

/** Remove a node immediately so an in-flight read cannot keep its authority alive. */
export function forgetPluginNode(nodeId: string): void {
  requestedGeneration++
  const byNode = new Map(distribution().byNode)
  if (!byNode.delete(nodeId)) return
  const current = distribution()
  publish(derivePluginDistribution(byNode, lastHostState, current.revision + 1, PLUGIN_API_MAJOR))
}

async function rosterFor(nodeId: string): Promise<readonly NodePluginRow[]> {
  return (await readJson<NodePluginState>(corePluginsRoute, { nodeId })).plugins
}

export type DistributionSyncOptions = { nodeIds?: readonly string[]; trustOnly?: boolean }

/** Every input enters one serial queue. Reads publish in request order, so an older result cannot
 * overwrite a newer one. Unpaired nodes are checked again at commit. */
export function syncPluginDistribution(options: DistributionSyncOptions = {}): Promise<void> {
  const generation = ++requestedGeneration
  const pass = async (): Promise<void> => {
    if (!pluginHostAvailable()) return
    const previous = distribution()
    const paired = new Set(nodes().map((node) => node.nodeId))
    // Trust writes never change fleet membership. Keep the last observations even when a host does
    // not expose a fleet list (the origin-node and terminal adapters).
    if (options.trustOnly) for (const id of previous.byNode.keys()) paired.add(id)
    const byNode = new Map([...previous.byNode].filter(([id]) => paired.has(id)))
    const wanted = options.trustOnly ? new Set<string>() : new Set(options.nodeIds ?? paired)
    for (const nodeId of paired) {
      if (options.trustOnly) continue
      if (nodeState(nodeId) === 'offline') {
        const old = byNode.get(nodeId)
        if (old) byNode.set(nodeId, { ...old, reachable: false, stale: true })
        continue
      }
      if (!wanted.has(nodeId)) continue
      try {
        const rows = await rosterFor(nodeId)
        for (const row of rows) if (legacyRuntimeIdentityWithheld(row)) {
          log.warn(`${row.name} on ${nodeId} has no provable running identity; loaded UI is withheld`)
        }
        byNode.set(nodeId, { nodeId, rows, reachable: true, stale: false, generation, observedAt: Date.now() })
      } catch (error) {
        log.warn(`could not read the plugin roster on ${nodeId}`, error)
        const old = byNode.get(nodeId)
        if (old) byNode.set(nodeId, { ...old, stale: true })
      }
    }

    // Cache active and installed offers; caching an update never selects it.
    const seen = new Set<string>()
    for (const observation of byNode.values()) {
      if (!observation.reachable || observation.stale) continue
      for (const row of observation.rows) {
        const runtime = runtimeIdentityForRow(row)
        const offers = [runtime, row.installed].filter((value) => value?.client)
        for (const offer of offers) {
          const hash = offer!.client!.hash
          const sourceKey = decisionKey(observation.nodeId, hash)
          if (seen.has(sourceKey)) continue
          seen.add(sourceKey)
          // Even a cached hash must be reported by this node to update provenance in custody.
          const result = await cachePluginBundle({ nodeId: observation.nodeId, pluginId: row.name, hash, version: offer!.version })
          if ('error' in result) log.warn(`${row.name} from ${observation.nodeId} was not cached: ${result.error}`, undefined, { 'plugin.id': row.name })
        }
      }
    }
    const host = await readPluginHostState()
    lastHostState = host
    const currentPaired = options.trustOnly ? paired : new Set(nodes().map((node) => node.nodeId))
    for (const id of byNode.keys()) if (!currentPaired.has(id)) byNode.delete(id)
    publish(derivePluginDistribution(byNode, host, distribution().revision + 1, PLUGIN_API_MAJOR))
  }
  const result = reconcileTail.then(pass)
  reconcileTail = result.catch((error: unknown) => log.warn('could not reconcile plugin distribution', error))
  return result
}

/** Refresh the full snapshot after a durable trust write, before rebuilding registries. */
export const refreshPluginTrust = async (): Promise<void> => {
  await syncPluginDistribution({ trustOnly: true })
}

export function resolvePendingTrust(pluginId: string, hash: string): void {
  dismissed.add(decisionKey(pluginId, hash))
  setDistribution({ ...distribution() })
}

export function _seedPluginDistribution(
  rosters: Iterable<readonly [string, readonly NodePluginRow[]]>,
  accepted: readonly string[] = [],
): void {
  const byNode = new Map<string, NodePluginObservation>([...rosters].map(([nodeId, rows]) =>
    [nodeId, { nodeId, rows, reachable: true, stale: false, generation: 1, observedAt: Date.now() }]))
  const cached: PluginHostState['cached'] = {}
  for (const observation of byNode.values()) for (const row of observation.rows) {
    for (const declaration of [runtimeIdentityForRow(row), row.installed]) {
      if (declaration?.client) cached[declaration.client.hash] = { pluginId: row.name, version: declaration.version, bytes: declaration.client.bytes }
    }
  }
  const acks = accepted.map((value) => {
    const split = value.lastIndexOf(' ')
    return { pluginId: value.slice(0, split), hash: value.slice(split + 1), decision: 'accepted' } as PluginAckRecord
  })
  initialized = true
  dismissed.clear()
  lastHostState = { cached, acks, devGrants: [] }
  setDistribution(derivePluginDistribution(byNode, lastHostState, distribution().revision + 1, PLUGIN_API_MAJOR))
}

export function _seedPendingTrust(requests: readonly PluginTrustRequest[]): void {
  dismissed.clear()
  setDistribution({ ...distribution(), pendingTrust: requests })
}

export function _resetPluginDistribution(): void {
  requestedGeneration++
  initialized = false
  dismissed.clear()
  lastHostState = emptyHost()
  setDistribution(emptySnapshot())
}

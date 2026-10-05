import { createSignal } from 'solid-js'
import { corePluginsRoute, PLUGIN_API_MAJOR, type NodePluginRow, type NodePluginState } from '@acorn/protocol/api.ts'
import { pluginManifestShape } from '@acorn/protocol/plugin/contract.ts'
import { hasNodeHalf } from '@acorn/protocol/plugin/bundles.ts'
import { clientDeclaration } from '@acorn/protocol/plugin/declaration.ts'
import type { PluginAckRecord, PluginHostState } from '../../infra/platform'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { readDevicePrefs, setDevicePluginIds } from '../../infra/persistence/devicePrefs'
import { readJson } from '../../infra/node/apiClient'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodes, nodeState } from '../../infra/node/fleet'
import { cachePluginBundle, pluginHostAvailable, readPluginHostState } from './host'
import { createLogger } from '../../infra/telemetry/logger'
import { runtimeIdentityForRow, legacyRuntimeIdentityWithheld } from './runtimeIdentity'
import {
  decisionKey, derivePluginDistribution,
  type DevicePluginEntry, type NodePluginObservation, type PluginDistributionSnapshot, type PluginTrustRequest,
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
export const devicePlugins = (): readonly DevicePluginEntry[] => distribution().devicePlugins
const [reviewFirst, setReviewFirst] = createSignal<string>()
export const pendingTrust = (): readonly PluginTrustRequest[] => {
  const first = reviewFirst()
  return distribution().pendingTrust.filter((request) => !dismissed.has(decisionKey(request.row.name, request.hash)))
    .sort((a, b) => Number(b.row.name === first) - Number(a.row.name === first))
}

/** Only the requests about a client bundle. The terminal client draws no dashboards, so it can't
 *  approve what a plugin reads and leaves those to the desktop app. */
export const pendingBundleTrust = (): readonly PluginTrustRequest[] => pendingTrust().filter((request) => request.hash)

/** Bring a plugin's waiting request back to the front, even after "Not now", for a row's Manage. */
export function reviewPendingTrust(pluginId: string): void {
  for (const key of dismissed) if ((JSON.parse(key) as [string, string])[0] === pluginId) dismissed.delete(key)
  setReviewFirst(pluginId)
  setDistribution({ ...distribution() })
}
export const activeBundles = (): ReadonlyMap<string, { hash: string }> | null => {
  if (!initialized) return null
  const snapshot = distribution()
  const nodeId = activeNodeId() ?? snapshot.byNode.keys().next().value
  const selections = nodeId ? snapshot.selectionsByNode.get(nodeId) : undefined
  const bundles = new Map([...(selections ?? [])].map(([id, selection]) => [id, { hash: selection.hash }]))
  for (const [id, entry] of snapshot.selectedDevice) bundles.set(id, { hash: entry.hash })
  return bundles
}
export const bundleAccepted = (pluginId: string, hash: string): boolean =>
  distribution().acceptedKeys.has(decisionKey(pluginId, hash))

export const pluginEnabledOnNode = (nodeId: string, pluginId: string): boolean => {
  const snapshot = distribution()
  const local = snapshot.selectedDevice.get(pluginId)
  if (local) return !local.row.disabled && snapshot.acceptedKeys.has(decisionKey(pluginId, local.hash))
  return contributionAvailability(snapshot, nodeId, pluginId, PLUGIN_API_MAJOR).available
}
export const pluginServiceAvailableOnNode = (nodeId: string, pluginId: string): boolean =>
  nodePluginServiceAvailable(distribution(), nodeId, pluginId)

export type LoadedPluginState = 'enabled' | 'disabled' | 'absent'
export const loadedPluginStateOnNode = (nodeId: string, pluginId: string): LoadedPluginState => {
  const local = distribution().selectedDevice.get(pluginId)
  if (local) return local.row.disabled ? 'disabled' : 'enabled'
  const runtime = nodePluginRuntime(distribution(), nodeId, pluginId)
  return runtime.kind === 'active' || runtime.kind === 'compiled-active' ? 'enabled'
    : runtime.kind === 'absent' || runtime.kind === 'unknown' ? 'absent' : 'disabled'
}
export const pluginInstalledAtOnNode = (nodeId: string, pluginId: string): number | undefined =>
  distribution().byNode.get(nodeId)?.rows.find((row) => row.name === pluginId)?.installed?.installedAt

const disabledDeviceIds = (): Set<string> => {
  try {
    const list: unknown = JSON.parse(readDevicePrefs()[PrefKeys.devicePluginsDisabled] ?? '[]')
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [])
  } catch { return new Set() }
}

export function deviceEntries(state: PluginHostState): DevicePluginEntry[] {
  const disabled = disabledDeviceIds()
  const entries: DevicePluginEntry[] = []
  for (const [hash, cached] of Object.entries(state.cached)) {
    if (cached.source?.kind !== 'device') continue
    const parsed = pluginManifestShape.safeParse(cached.manifest)
    if (!parsed.success || hasNodeHalf(cached.manifest) || parsed.data.id !== cached.pluginId || !parsed.data.client) {
      log.warn(`invalid device manifest for ${cached.pluginId}; skipping bundle`)
      continue
    }
    const manifest = parsed.data
    entries.push({ hash, row: {
      name: manifest.id, label: manifest.name, required: false, disabled: disabled.has(manifest.id),
      running: !disabled.has(manifest.id), state: disabled.has(manifest.id) ? 'disabled' : 'active',
      emits: manifest.emits,
      installed: {
        version: manifest.version, apiVersion: manifest.apiVersion, permissions: manifest.permissions,
        contributions: manifest.contributions, client: { hash, bytes: cached.bytes },
        source: cached.sourceLabel, icon: manifest.icon, icons: manifest.icons, emits: manifest.emits,
      },
    }, sourceLabel: cached.sourceLabel ?? 'this device', nodeIds: cached.nodeIds ?? [], sameHashNodeIds: [], installSource: cached.installSource })
  }
  return entries
}

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
  const device = [...snapshot.selectedDevice].map(([id, entry]) => [
    id, entry.hash, entry.row.disabled, snapshot.acceptedKeys.has(decisionKey(id, entry.hash)),
  ])
  return JSON.stringify([nodeId, runtimes, [...(selections ?? [])].map(([id, selection]) => [id, selection.hash]), device])
}

function publish(next: PluginDistributionSnapshot): void {
  const previous = distribution()
  const changed = activeSelectionSignature(previous) !== activeSelectionSignature(next)
  const selectedKeys = (snapshot: PluginDistributionSnapshot): ReadonlySet<string> => {
    const keys = [...snapshot.selectionsByNode.values()].flatMap((entries) =>
      [...entries.values()].filter((selection) => selection.hash && !snapshot.selectedDevice.has(selection.pluginId))
        .map((selection) => decisionKey(selection.pluginId, selection.hash)))
    for (const [id, entry] of snapshot.selectedDevice) {
      const key = decisionKey(id, entry.hash)
      if (!entry.row.disabled && snapshot.acceptedKeys.has(key)) keys.push(key)
    }
    return new Set(keys)
  }
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
  publish(derivePluginDistribution(byNode, lastHostState, current.revision + 1, PLUGIN_API_MAJOR, current.devicePlugins))
}

/** Remove a node immediately so an in-flight read cannot keep its authority alive. */
export function forgetPluginNode(nodeId: string): void {
  requestedGeneration++
  const byNode = new Map(distribution().byNode)
  if (!byNode.delete(nodeId)) return
  const current = distribution()
  publish(derivePluginDistribution(byNode, lastHostState, current.revision + 1, PLUGIN_API_MAJOR, current.devicePlugins))
}

async function rosterFor(nodeId: string): Promise<readonly NodePluginRow[]> {
  return (await readJson<NodePluginState>(corePluginsRoute, { nodeId })).plugins
}

export type DistributionSyncOptions = { nodeIds?: readonly string[]; trustOnly?: boolean; deviceOnly?: boolean }

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
    if (options.trustOnly || options.deviceOnly) for (const id of previous.byNode.keys()) paired.add(id)
    const byNode = new Map([...previous.byNode].filter(([id]) => paired.has(id)))
    const wanted = options.trustOnly || options.deviceOnly ? new Set<string>() : new Set(options.nodeIds ?? paired)
    for (const nodeId of paired) {
      if (options.trustOnly || options.deviceOnly) continue
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
    for (const observation of options.deviceOnly ? [] : byNode.values()) {
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
    const offers = [...byNode.values()].flatMap((observation) => observation.rows.flatMap((row) =>
      [runtimeIdentityForRow(row), row.installed].filter((declaration) => declaration?.client).map((declaration) => ({
        pluginId: row.name, nodeId: observation.nodeId, hash: declaration!.client!.hash,
      }))))
    const local = deviceEntries(host).map((entry) => ({
      ...entry,
      nodeIds: [...new Set(offers.filter((offer) => offer.pluginId === entry.row.name).map((offer) => offer.nodeId))],
      sameHashNodeIds: [...new Set(offers.filter((offer) => offer.pluginId === entry.row.name && offer.hash === entry.hash).map((offer) => offer.nodeId))],
    }))
    setDevicePluginIds([...new Set(local.map((entry) => entry.row.name))])
    const currentPaired = options.trustOnly || options.deviceOnly ? paired : new Set(nodes().map((node) => node.nodeId))
    for (const id of byNode.keys()) if (!currentPaired.has(id)) byNode.delete(id)
    publish(derivePluginDistribution(byNode, host, distribution().revision + 1, PLUGIN_API_MAJOR, local))
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
    const pluginId = value.slice(0, split)
    const hash = value.slice(split + 1)
    const declaration = [...byNode.values()].flatMap((observation) => observation.rows)
      .filter((row) => row.name === pluginId)
      .flatMap((row) => [runtimeIdentityForRow(row), row.installed])
      .find((offer) => offer?.client?.hash === hash)
    return { pluginId, hash, decision: 'accepted', ...(declaration ? { declaration: clientDeclaration(declaration) } : {}) } as PluginAckRecord
  })
  initialized = true
  dismissed.clear()
  lastHostState = { cached, acks, devGrants: [] }
  setDistribution(derivePluginDistribution(byNode, lastHostState, distribution().revision + 1, PLUGIN_API_MAJOR))
}

/** Test seam for provenance arbitration and device enablement at the shared contribution gate. */
export function _seedDevicePluginDistribution(entries: readonly DevicePluginEntry[]): void {
  setDevicePluginIds(entries.map((entry) => entry.row.name))
  const current = distribution()
  const cached = { ...lastHostState.cached }
  for (const entry of entries) cached[entry.hash] = {
    pluginId: entry.row.name, version: entry.row.installed!.version, bytes: entry.row.installed!.client?.bytes ?? 0,
  }
  const acks = lastHostState.acks.map((ack) => {
    const entry = entries.find((candidate) => candidate.row.name === ack.pluginId && candidate.hash === ack.hash)
    return entry?.row.installed && ack.decision === 'accepted'
      ? { ...ack, declaration: clientDeclaration(entry.row.installed) } : ack
  })
  lastHostState = { ...lastHostState, cached, acks }
  publish(derivePluginDistribution(current.byNode, lastHostState, current.revision + 1, PLUGIN_API_MAJOR, entries))
}

// Test seam, for the half of the boot pass above that `_seedPluginDistribution` does not stand in for:
// the queue the trust dialog drains. What is worth asserting about an answer is which entry it
// removes, and, when the host could not store it, that it removes none.
export function _seedPendingTrust(requests: readonly PluginTrustRequest[]): void {
  dismissed.clear()
  setDistribution({ ...distribution(), pendingTrust: requests })
}

export function _resetPluginDistribution(): void {
  setDevicePluginIds([])
  requestedGeneration++
  initialized = false
  dismissed.clear()
  lastHostState = emptyHost()
  setDistribution(emptySnapshot())
}

import { speaksApiVersion } from '@acorn/protocol/plugin/apiVersion.ts'
import type { InstalledPluginRow, NodePluginRow, PluginInstallSource, PluginRuntimeIdentity } from '@acorn/protocol/api.ts'
import type { BundleSource } from '@acorn/protocol/plugin/bundles.ts'
import type { PluginAckRecord, PluginHostState } from '../../infra/platform'
import { runtimeIdentityForRow } from './runtimeIdentity'

// Device releases sort by numeric version segments, then hash for deterministic ties. Node
// selections use their own running identity and never participate in this version comparison.
const compareVersions = (a: string, b: string): number => {
  const parts = (value: string) => value.split('.').map((segment) => Number.parseInt(segment, 10) || 0)
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** A validated bundle held by this host, independent of every node's running declaration. */
export type DevicePluginEntry = {
  hash: string
  row: NodePluginRow
  sourceLabel: string
  nodeIds: string[]
  sameHashNodeIds: string[]
  installSource?: PluginInstallSource
}

/** One node's last valid answer. Offline and failed reads retain the rows for explanation, but cannot
 * authorize a visible contribution until a fresh read succeeds. */
export type NodePluginObservation = {
  nodeId: string
  rows: readonly NodePluginRow[]
  reachable: boolean
  stale: boolean
  generation: number
  observedAt: number
}

export type OfferedPluginCandidate = {
  nodeId: string
  pluginId: string
  row: NodePluginRow
  declaration: InstalledPluginRow | PluginRuntimeIdentity
  hash: string
  relation: 'active' | 'installed'
}

export type PluginSelection = {
  nodeId: string
  pluginId: string
  row: NodePluginRow
  runtime: PluginRuntimeIdentity
  hash: string
}

export type PluginTrustRequest = {
  row: NodePluginRow
  hash: string
  nodeId: string
  sourceNodeIds: readonly string[]
  relation: 'active' | 'installed'
  source?: BundleSource
  sourceLabel?: string
  previous?: PluginAckRecord
}

export type PluginDistributionSnapshot = {
  revision: number
  byNode: ReadonlyMap<string, NodePluginObservation>
  selectionsByNode: ReadonlyMap<string, ReadonlyMap<string, PluginSelection>>
  offeredCandidates: readonly OfferedPluginCandidate[]
  acceptedKeys: ReadonlySet<string>
  decisionsByKey: ReadonlyMap<string, PluginAckRecord['decision']>
  cachedHashes: ReadonlySet<string>
  pendingTrust: readonly PluginTrustRequest[]
  conflictingKeys: ReadonlySet<string>
  devicePlugins: readonly DevicePluginEntry[]
  selectedDevice: ReadonlyMap<string, DevicePluginEntry>
}

export const decisionKey = (pluginId: string, hash: string): string => JSON.stringify([pluginId, hash])

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// One acknowledgement covers one exact pair. If nodes attach different grants to the same bytes,
// no selection or prompt may turn that single decision into authority for both declarations.
const enforcedDeclaration = (candidate: OfferedPluginCandidate): string => canonical({
  apiVersion: candidate.declaration.apiVersion,
  permissions: candidate.declaration.permissions,
  contributions: candidate.declaration.contributions,
  emits: candidate.declaration.emits ?? [],
})

const offersFor = (nodeId: string, row: NodePluginRow): OfferedPluginCandidate[] => {
  const active = runtimeIdentityForRow(row)
  const offers: OfferedPluginCandidate[] = []
  if (active?.client) offers.push({ nodeId, pluginId: row.name, row, declaration: active, hash: active.client.hash, relation: 'active' })
  if (row.installed?.client) {
    offers.push({ nodeId, pluginId: row.name, row, declaration: row.installed, hash: row.installed.client.hash, relation: 'installed' })
  }
  return offers
}

const latestPrevious = (acks: readonly PluginAckRecord[], pluginId: string, hash: string): PluginAckRecord | undefined =>
  acks.filter((ack) => ack.pluginId === pluginId && ack.hash !== hash && ack.decision === 'accepted' && !ack.partial)
    .sort((a, b) => b.decidedAt - a.decidedAt)[0]

/** Pure policy for one fleet revision. I/O and generation checks live in distribution.ts. */
export function derivePluginDistribution(
  byNode: ReadonlyMap<string, NodePluginObservation>,
  host: PluginHostState,
  revision: number,
  apiVersion: string,
  devicePlugins: readonly DevicePluginEntry[] = [],
): PluginDistributionSnapshot {
  const offeredCandidates = [...byNode.values()].filter((observation) => observation.reachable && !observation.stale).flatMap((observation) =>
    observation.rows.flatMap((row) => offersFor(observation.nodeId, row)))
  const byKey = new Map<string, OfferedPluginCandidate[]>()
  for (const candidate of offeredCandidates) {
    const key = decisionKey(candidate.pluginId, candidate.hash)
    byKey.set(key, [...(byKey.get(key) ?? []), candidate])
  }
  const conflictingKeys = new Set<string>()
  for (const [key, candidates] of byKey) {
    if (new Set(candidates.map(enforcedDeclaration)).size > 1) conflictingKeys.add(key)
  }

  const acksByKey = new Map(host.acks.map((ack) => [decisionKey(ack.pluginId, ack.hash), ack]))
  const acceptedKeys = new Set(host.acks.filter((ack) => ack.decision === 'accepted').map((ack) => decisionKey(ack.pluginId, ack.hash)))
  const cached = new Set(Object.keys(host.cached))
  const selectedDevice = new Map<string, DevicePluginEntry>()
  for (const entry of devicePlugins) {
    const installed = entry.row.installed
    if (!installed || !speaksApiVersion(installed.apiVersion, apiVersion)) continue
    const previous = selectedDevice.get(entry.row.name)
    if (!previous || compareVersions(installed.version, previous.row.installed!.version) > 0 ||
      (installed.version === previous.row.installed!.version && entry.hash > previous.hash)) {
      selectedDevice.set(entry.row.name, entry)
    }
  }
  const selectionsByNode = new Map<string, ReadonlyMap<string, PluginSelection>>()
  for (const observation of byNode.values()) {
    const selections = new Map<string, PluginSelection>()
    if (observation.reachable && !observation.stale) {
      for (const row of observation.rows) {
        const runtime = runtimeIdentityForRow(row)
        if (!runtime || !speaksApiVersion(runtime.apiVersion, apiVersion)) continue
        const hash = runtime.client?.hash ?? ''
        const key = decisionKey(row.name, hash)
        if (hash && (!cached.has(hash) || !acceptedKeys.has(key) || conflictingKeys.has(key))) continue
        selections.set(row.name, { nodeId: observation.nodeId, pluginId: row.name, row, runtime, hash })
      }
    }
    selectionsByNode.set(observation.nodeId, selections)
  }

  const pendingTrust: PluginTrustRequest[] = []
  for (const entry of selectedDevice.values()) {
    const key = decisionKey(entry.row.name, entry.hash)
    if (!cached.has(entry.hash) || acksByKey.has(key)) continue
    const previous = latestPrevious(host.acks, entry.row.name, entry.hash)
    pendingTrust.push({
      row: entry.row, hash: entry.hash, nodeId: '', sourceNodeIds: entry.sameHashNodeIds,
      relation: 'installed', source: { kind: 'device' }, sourceLabel: entry.sourceLabel,
      ...(previous ? { previous } : {}),
    })
  }
  for (const [key, candidates] of byKey) {
    if (conflictingKeys.has(key) || acksByKey.has(key) ||
      selectedDevice.has(candidates[0]!.pluginId)) continue
    const compatible = candidates.filter((candidate) => speaksApiVersion(candidate.declaration.apiVersion, apiVersion))
    if (!compatible.length || !cached.has(compatible[0]!.hash)) continue
    compatible.sort((a, b) => Number(b.relation === 'active') - Number(a.relation === 'active') || a.nodeId.localeCompare(b.nodeId))
    const first = compatible[0]!
    const previous = latestPrevious(host.acks, first.pluginId, first.hash)
    pendingTrust.push({
      row: first.relation === 'active' ? { ...first.row, installed: first.declaration } : first.row,
      hash: first.hash,
      nodeId: first.nodeId,
      sourceNodeIds: [...new Set(compatible.map((candidate) => candidate.nodeId))].sort(),
      relation: first.relation,
      source: { kind: 'node', nodeId: first.nodeId },
      ...(previous ? { previous } : {}),
    })
  }
  pendingTrust.sort((a, b) => Number(b.relation === 'active') - Number(a.relation === 'active') || a.row.name.localeCompare(b.row.name) || a.hash.localeCompare(b.hash))
  return {
    revision, byNode, selectionsByNode, offeredCandidates, acceptedKeys,
    decisionsByKey: new Map([...acksByKey].map(([key, ack]) => [key, ack.decision])),
    cachedHashes: cached, pendingTrust, conflictingKeys, devicePlugins, selectedDevice,
  }
}

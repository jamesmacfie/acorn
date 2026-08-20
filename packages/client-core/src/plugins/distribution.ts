import { createSignal } from 'solid-js'
import { corePluginsRoute, PLUGIN_API_MAJOR, type NodePluginRow, type NodePluginState } from '@acorn/protocol/api.ts'
import type { PluginAckRecord } from '../platform'
import { readJson } from '../apiClient'
import { nodes } from '../node/fleet'
import { cachePluginBundle, pluginHostAvailable, readPluginHostState } from './host'
import { resolveActiveBundles, type ActiveBundle, type BundleCandidate } from './resolveBundles'

// Getting third-party plugin bundles from every node in the fleet onto this device, and asking the
// owner about each one before anything runs it (docs/plugins.md § Loaded plugins: the client half;
// docs/security.md § Third-party plugin bundles for the trust model).
//
// Three fleet-wide signals: `installedByNode` (each node's roster, unlike node/nodePlugins.ts which
// tracks only the active node and clears on switch), `pendingTrust` (the queue the dialog drains), and
// `activeBundles` (which single bundle wins per plugin id, pinned once per session; see below).
//
// Nothing here loads or executes a bundle: phase 3 does that. What this file guarantees is that by
// the time it can, the bytes are cached, the hash was computed locally, and the owner has said yes.

const [installedByNode, setInstalledByNode] = createSignal<ReadonlyMap<string, readonly NodePluginRow[]>>(new Map())
const [pendingTrust, setPendingTrust] = createSignal<readonly PluginTrustRequest[]>([])
const [activeBundles, setActiveBundles] = createSignal<ReadonlyMap<string, ActiveBundle> | null>(null)
// `<pluginId> <hash>` for every bundle this device has said yes to. Held here because it is read on the
// same pass that reads it from main, and phase 3 needs it as a gate rather than a round trip: a bundle
// with no acceptance must not get so far as registering a contribution.
const [acceptedBundles, setAcceptedBundles] = createSignal<ReadonlySet<string>>(new Set())

export { installedByNode, pendingTrust, activeBundles }

/** Has this device agreed to run these exact bytes? Keyed on the pair, because consent was given to a
 * hash and not to a name (main/pluginTrustStore.ts). */
export const bundleAccepted = (pluginId: string, hash: string): boolean => acceptedBundles().has(`${pluginId} ${hash}`)

/** Called by the trust dialog once main has stored the decision, so a just-accepted plugin's surfaces can
 * appear without a reload. The durable answer still lives in main's trust store; this is the projection
 * catching up. */
export function noteBundleAccepted(pluginId: string, hash: string): void {
  setAcceptedBundles(new Set([...acceptedBundles(), `${pluginId} ${hash}`]))
}

// What the trust dialog renders. `previous` is the last bundle of this plugin the owner accepted,
// present only when this is an update: it turns "do you trust this?" into "here is what changed".
export type PluginTrustRequest = {
  row: NodePluginRow
  hash: string
  nodeId: string
  previous?: PluginAckRecord
}

// The predicate phases 3 and 4 gate their surfaces on: does this node run this plugin? Deliberately
// per-node and never ambient. A plugin enabled on the node you are looking at says nothing about the
// node whose pane is open beside it. Sits alongside the `providerId` gate in tabs/sources.ts, which
// answers the same shape of question for integrations.
export const pluginEnabledOnNode = (nodeId: string, pluginId: string): boolean =>
  (installedByNode().get(nodeId) ?? []).some((row) => row.name === pluginId && row.running)

export type LoadedPluginState = 'enabled' | 'disabled' | 'absent'

export const loadedPluginStateOnNode = (nodeId: string, pluginId: string): LoadedPluginState => {
  const row = (installedByNode().get(nodeId) ?? []).find((candidate) => candidate.name === pluginId && candidate.installed)
  if (!row) return 'absent'
  return row.running ? 'enabled' : 'disabled'
}

export const pluginInstalledAtOnNode = (nodeId: string, pluginId: string): number | undefined =>
  (installedByNode().get(nodeId) ?? []).find((candidate) => candidate.name === pluginId)?.installed?.installedAt

// Every bundle any known node is offering, as candidates for resolution.
const candidatesFrom = (rosters: ReadonlyMap<string, readonly NodePluginRow[]>): BundleCandidate[] =>
  [...rosters].flatMap(([nodeId, rows]) =>
    rows.flatMap((row) =>
      row.installed?.client
        ? [{ pluginId: row.name, version: row.installed.version, apiVersion: row.installed.apiVersion, hash: row.installed.client.hash, nodeId }]
        : [],
    ),
  )

// Read one node's roster. A node that does not answer contributes nothing rather than clearing what
// we already knew about it, the same stance node/nodePlugins.ts takes for the same reason: an
// offline node is not a node with no plugins.
const rosterFor = async (nodeId: string): Promise<readonly NodePluginRow[] | null> => {
  try {
    return (await readJson<NodePluginState>(corePluginsRoute, { nodeId })).plugins
  } catch (error) {
    console.warn(`[plugins] could not read the plugin roster on ${nodeId}:`, error)
    return null
  }
}

// The boot pass: ask every node what it carries, cache anything new, and queue whatever this device
// has never decided about.
//
// Fire-and-forget from the composition root. It must never fail a boot: a fleet where every node is
// offline, or a build with no plugin host at all, simply ends with nothing pending.
export async function syncPluginDistribution(options: { repin?: boolean } = {}): Promise<void> {
  if (!pluginHostAvailable()) return

  const rosters = new Map(installedByNode())
  await Promise.all(
    nodes().map(async (node) => {
      const rows = await rosterFor(node.nodeId)
      if (rows) rosters.set(node.nodeId, rows)
    }),
  )
  setInstalledByNode(rosters)

  // Fetch first, decide second. The hash the owner is asked about has to be one this device computed
  // from bytes it holds, not one a node asserted, so a bundle is cached before it is ever named in a
  // prompt and a node that lies about its hash is refused here rather than at the dialog.
  const cached = new Set(Object.keys((await readPluginHostState()).cached))
  for (const [nodeId, rows] of rosters) {
    for (const row of rows) {
      const client = row.installed?.client
      if (!client || cached.has(client.hash)) continue
      const result = await cachePluginBundle({ nodeId, pluginId: row.name, hash: client.hash, version: row.installed!.version })
      if ('hash' in result) cached.add(result.hash)
      else console.warn(`[plugins] ${row.name} from ${nodeId} was not cached: ${result.error}`)
    }
  }

  // Chosen once per session and never recomputed (docs/plugins.md § The dev loop describes the one
  // place this pin is deliberately dropped). `repin` is that exception: only the node's own
  // "plugins changed" event asks for it (plugins/reload.ts), because a reload replaces the bytes
  // behind a plugin id and the pinned winner would otherwise name a bundle the node no longer offers.
  if (options.repin || !activeBundles()) {
    setActiveBundles(resolveActiveBundles(candidatesFrom(rosters), { apiVersion: PLUGIN_API_MAJOR }))
  }

  await refreshPendingTrust(rosters)
}

// Everything cached that this device has never answered for. Read from the host rather than tracked
// locally, so a decision made in a previous session is honoured without the renderer keeping its own
// copy of the answer.
async function refreshPendingTrust(rosters: ReadonlyMap<string, readonly NodePluginRow[]>): Promise<void> {
  const { cached, acks } = await readPluginHostState()
  const decided = new Set(acks.map((ack) => `${ack.pluginId}\0${ack.hash}`))
  setAcceptedBundles(new Set(acks.filter((ack) => ack.decision === 'accepted').map((ack) => `${ack.pluginId} ${ack.hash}`)))
  const requests: PluginTrustRequest[] = []
  const queued = new Set<string>()

  for (const [nodeId, rows] of rosters) {
    for (const row of rows) {
      const client = row.installed?.client
      if (!client || !(client.hash in cached)) continue
      const key = `${row.name}\0${client.hash}`
      // One prompt per bundle, not per node offering it: the same bytes are the same decision, and
      // the node named is simply the first one we saw them from.
      if (decided.has(key) || queued.has(key)) continue
      queued.add(key)
      // `partial` rows are skipped: their snapshot is known-incomplete, so a diff against one would
      // mark grants as newly requested that the owner had in fact already accepted. With no baseline
      // the prompt degrades to a plain first-time decision, which is honest: it says "here is what
      // this asks for" rather than a wrong "here is what it gained".
      const previous = acks
        .filter((ack) => ack.pluginId === row.name && ack.hash !== client.hash && ack.decision === 'accepted' && !ack.partial)
        .sort((a, b) => b.decidedAt - a.decidedAt)[0]
      requests.push({ row, hash: client.hash, nodeId, ...(previous ? { previous } : {}) })
    }
  }
  setPendingTrust(requests)
}

// Called by the dialog once a decision is recorded. Drops just that bundle, so a queue of three
// prompts advances rather than being rebuilt from a round trip per answer.
export function resolvePendingTrust(pluginId: string, hash: string): void {
  setPendingTrust(pendingTrust().filter((request) => !(request.row.name === pluginId && request.hash === hash)))
}

// Test seam. Standing in for a boot pass: `syncPluginDistribution` needs a plugin host, a fleet and a
// broker, and the surfaces that read these signals (phase 3's frames, phase 4's chrome) are testable
// without any of that.
export function _seedPluginDistribution(
  rosters: Iterable<readonly [string, readonly NodePluginRow[]]>,
  accepted: readonly string[] = [],
): void {
  const seeded = new Map(rosters)
  setInstalledByNode(seeded)
  setAcceptedBundles(new Set(accepted))
  // Resolved the same way a real boot pass resolves it, because "which bundle wins" is now what
  // decides which node's manifest a plugin's contributions come from and which bytes its trust
  // decision is about (plugins/contributions.ts). A seam that left this null would have let the
  // suites agree with each other about a world production never sees.
  setActiveBundles(resolveActiveBundles(candidatesFrom(seeded), { apiVersion: PLUGIN_API_MAJOR }))
}

// Test seam, for the half of the boot pass above that `_seedPluginDistribution` does not stand in for:
// the queue the trust dialog drains. What is worth asserting about an answer is which entry it
// removes, and, when the host could not store it, that it removes none.
export function _seedPendingTrust(requests: readonly PluginTrustRequest[]): void {
  setPendingTrust(requests)
}

// Test seam. The signals are module-level because the registries they feed are, and a suite that
// asserts on one run must not inherit the previous one's fleet.
export function _resetPluginDistribution(): void {
  setInstalledByNode(new Map())
  setPendingTrust([])
  setActiveBundles(null)
  setAcceptedBundles(new Set<string>())
}

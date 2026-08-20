// Which client bundle wins when a fleet disagrees (docs/plugins.md).
//
// Two nodes may carry different versions of one plugin. Contribution IDs are not namespaced (`pr`,
// `changes`, `palette.files` are persisted layout keys and user-visible chord targets, see the comment
// block in registries/plugin.ts), so two versions of one plugin registering at once would collide on
// ids that a user's saved layout points at. Exactly one bundle per plugin id may be active, and this is
// where that one is chosen.
//
// Pure on purpose: everything about it is a decision over a candidate list, and a decision worth
// getting right is worth testing without a fleet.

export type BundleCandidate = {
  pluginId: string
  version: string
  apiVersion: string
  hash: string
  nodeId: string
}

export type ActiveBundle = { pluginId: string; version: string; hash: string; nodeIds: string[] }

// Dotted numeric compare, ignoring anything after the first non-numeric segment. No `semver`
// dependency exists in this repo and adding one to answer "is 2.10.0 newer than 2.9.0" would be a
// dependency for a `<`. Prerelease ordering is deliberately not modelled: a plugin author shipping
// `1.0.0-rc1` and `1.0.0` to two nodes at once gets the tie-break below, which is stable but
// arbitrary, and that is an acceptable answer for a case the ecosystem does not have yet.
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.split('.').map((segment) => Number.parseInt(segment, 10) || 0)
  const left = parts(a)
  const right = parts(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// Highest version whose apiVersion this client speaks. Candidates carrying an apiVersion we do not
// support are dropped rather than deferred: a bundle built for a plugin API this shell does not have
// cannot be run, and pretending otherwise would fail at import time instead of here.
//
// Ties (the same version offered by several nodes, or two builds of one version) resolve on the hash,
// lexicographically. Arbitrary but stable, which is what matters: the same fleet must pick the same
// bundle on every boot, or a user's panes would move between machines for no visible reason.
export function resolveActiveBundles(
  candidates: readonly BundleCandidate[],
  options: { apiVersion: string },
): Map<string, ActiveBundle> {
  const winners = new Map<string, ActiveBundle>()
  const supported = candidates.filter((candidate) => candidate.apiVersion === options.apiVersion)
  for (const candidate of supported) {
    const current = winners.get(candidate.pluginId)
    if (!current) {
      winners.set(candidate.pluginId, { pluginId: candidate.pluginId, version: candidate.version, hash: candidate.hash, nodeIds: [candidate.nodeId] })
      continue
    }
    if (current.hash === candidate.hash) {
      // The same bytes from a second node. One bundle, two sources, and the plugin's UI renders
      // against both, which is why the node list is plural.
      if (!current.nodeIds.includes(candidate.nodeId)) current.nodeIds.push(candidate.nodeId)
      continue
    }
    const better = compareVersions(candidate.version, current.version) || current.hash.localeCompare(candidate.hash)
    if (better > 0) {
      winners.set(candidate.pluginId, { pluginId: candidate.pluginId, version: candidate.version, hash: candidate.hash, nodeIds: [candidate.nodeId] })
    }
  }
  return winners
}

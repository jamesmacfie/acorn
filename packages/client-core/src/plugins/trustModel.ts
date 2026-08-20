import { noteBundleAccepted, resolvePendingTrust, type PluginTrustRequest } from './distribution'
import {
  extensionGrants,
  extensionPermissionLines,
  keyClaimGrants,
  keyClaimPermissionLines,
  nodePermissionLines,
  type PermissionLine,
  scheduleGrants,
  schedulePermissionLines,
  taskCheckGrants,
  taskCheckPermissionLines,
  uiPermissionLines,
  webviewGrants,
  webviewPermissionLines,
} from './permissions'
import { recordPluginTrust } from './host'
import { syncPluginContributions } from './syncContributions'

// What the trust prompt says, and what answering it does (PluginTrustDialog.tsx draws it).
//
// A plain module rather than two memos inside the dialog, for the reason documentSurfaces.ts gives:
// the repo's client suites run in bare Node with no Solid transform, so anything in a `.tsx` file is
// structurally untestable, and the two things here are the ones worth pinning. The tier split is a
// security claim (docs/security.md § Design rules, rule 6): `Enforced` is a fence the UI bridge holds,
// `Declared` is a disclosure the plugin can ignore entirely, and the three lists may never be merged,
// because a strong claim must not lend credibility to a weaker one sitting beside it. And `decide` is
// where a stray keypress once permanently disabled a plugin with no undo surface anywhere in the UI.

export type TierKey = 'enforced' | 'declared' | 'web'

export const TIER_LABEL: Record<TierKey, string> = { enforced: 'Enforced', declared: 'Declared', web: 'Web pages' }

export type TrustLine = PermissionLine & {
  tier: TierKey
  // Did the version the owner last approved lack this grant? Always false on a first install, where
  // there is no previous version for anything to be new against.
  added: boolean
}

export type TrustTier = { key: TierKey; lines: TrustLine[] }

/**
/**
 * Every declared line, decorated with the tier that owns it and, on an update, whether the version
 * the owner last approved had it.
 *
 * The diff runs over the grant key, never the sentence, so a copy edit is a copy edit rather than a
 * fleet-wide "asks for more" (plugins/permissions.ts).
 */
export function trustTiers(request: PluginTrustRequest | undefined): TrustTier[] {
  const installed = request?.row.installed
  if (!request || !installed) return []
  const previous = request.previous
  const groups: { key: TierKey; now: readonly PermissionLine[]; was: readonly PermissionLine[] | null }[] = [
    {
      key: 'enforced',
      now: [
        ...uiPermissionLines(installed.permissions),
        ...keyClaimPermissionLines(keyClaimGrants(installed.contributions)),
        // Both directions of the cooperative seam plus any core-surface offer. `request.row.name` is the
        // plugin id the host read the manifest under, the same value every other namespace is minted
        // from, so a point's public name here is the one the rest of the app will address it by.
        ...extensionPermissionLines(extensionGrants(request.row.name, installed.contributions)),
      ],
      was: previous
        ? [
          ...uiPermissionLines(previous.permissions),
          ...keyClaimPermissionLines(previous.keyClaims ?? []),
          ...extensionPermissionLines(previous.extensions ?? []),
        ]
        : null,
    },
    {
      key: 'declared',
      // Schedules sit here rather than under `Enforced` for the reason the legend gives: the host does
      // hold the cadence and the route confinement, but what runs is the plugin's own node code, and a
      // claim about that can never be stronger than the group it is in.
      now: [
        ...nodePermissionLines(installed.permissions),
        ...schedulePermissionLines(scheduleGrants(installed.contributions)),
        // Beside the schedules and for the same reason: the host holds the route confinement and the
        // deadline, but what runs on archive is the plugin's own node code.
        ...taskCheckPermissionLines(taskCheckGrants(installed.contributions)),
      ],
      was: previous
        ? [
          ...nodePermissionLines(previous.permissions),
          ...schedulePermissionLines(previous.schedules ?? []),
          ...taskCheckPermissionLines(previous.taskChecks ?? []),
        ]
        : null,
    },
    {
      key: 'web',
      now: webviewPermissionLines(webviewGrants(installed.contributions)),
      was: previous ? webviewPermissionLines(previous.webviews ?? []) : null,
    },
  ]
  return groups.map(({ key, now, was }) => {
    const before = was ? new Set(was.map((entry) => entry.key)) : null
    return {
      key,
      lines: now.map((entry) => ({ ...entry, tier: key, added: before ? !before.has(entry.key) : false })),
    }
  })
}

/**
/**
 * Record an answer, accepted or rejected, and let the shell catch up.
 *
 * Both answers are remembered (main/pluginTrustStore.ts keeps a rejection so a turned-away plugin does
 * not ask every boot), which is exactly why dismissal must not come through here: Escape is "not now"
 * and records nothing. See the dialog's `dismiss`.
 */
export async function recordTrustDecision(request: PluginTrustRequest, decision: 'accepted' | 'rejected'): Promise<void> {
  const installed = request.row.installed
  if (!installed) return
  await recordPluginTrust({
    pluginId: request.row.name,
    hash: request.hash,
    nodeId: request.nodeId,
    version: installed.version,
    permissions: installed.permissions,
    webviews: webviewGrants(installed.contributions),
    keyClaims: keyClaimGrants(installed.contributions),
    // Recorded as well as shown, for the reason the key claims are: the update prompt's "what is new"
    // mark is a set difference against what the owner last approved, and a grant that is not stored can
    // never read as newly requested. A plugin that starts reaching into a different package between
    // versions is exactly the change that must not slide past unremarked.
    extensions: extensionGrants(request.row.name, installed.contributions),
    // Recorded for the same reason as the three above: an unrecorded grant can never read as newly
    // requested, and "this package now runs itself every five minutes" is exactly the change that must
    // not slide past the update prompt unremarked.
    schedules: scheduleGrants(installed.contributions),
    // Recorded for the same reason as the four above. "This package now stops my containers when I
    // archive" is exactly the change the update prompt has to be able to mark as new.
    taskChecks: taskCheckGrants(installed.contributions),
    decision,
  })
  resolvePendingTrust(request.row.name, request.hash)
  // An acceptance is what lets the plugin's surfaces exist at all (frames/register.ts gates on it), so
  // register them now rather than at the next boot. A rejection needs no counterpart: nothing was
  // registered to take away.
  if (decision === 'accepted') {
    noteBundleAccepted(request.row.name, request.hash)
    // Both passes, because a bundle-bearing plugin's chrome is gated on the same acceptance as its
    // rectangles, so it appears with the rest of its surfaces rather than at the next boot.
    syncPluginContributions()
  }
}

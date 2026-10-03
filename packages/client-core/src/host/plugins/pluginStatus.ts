import { PLUGIN_API_MAJOR, type NodePluginRow } from '@acorn/protocol/api.ts'
import { contributionAvailability } from './availabilityModel'
import { decisionKey, type DevicePluginEntry, type PluginDistributionSnapshot } from './distributionModel'

// One plugin's state in a few words, for the three places that say it: a row under Settings > Plugins >
// Installed, the status line of the plugin strip above the plugin's own settings page, and the rows the
// attention inbox raises for what waits on the person (docs/plugins/activation.md § What the owner sees).
// One function so the three never disagree about whether something needs the person.

export type PluginStatusTone = 'ok' | 'warn' | 'danger' | 'muted' | 'accent'

export type PluginStatus = {
  tone: PluginStatusTone
  text: string
  /** Something only the person can settle: an approval, a review, a failed load, or a restart. */
  needsYou: boolean
  /** What the strip's status line is about, when there is one: the four states it names. */
  line?: 'disabled' | 'waiting' | 'failed' | 'offline'
}

const status = (tone: PluginStatusTone, text: string, needsYou = false, line?: PluginStatus['line']): PluginStatus =>
  ({ tone, text, needsYou, ...(line ? { line } : {}) })

/** A plugin a node reports, as the device sees it on that node. `devMode` is this device's dev grant for
 *  the plugin against that node (docs/security/plugin-install.md § The dev grant). */
export function nodePluginStatus(snapshot: PluginDistributionSnapshot, nodeId: string | null, row: NodePluginRow, devMode = false): PluginStatus {
  if (row.pendingReview) {
    return 'corrupt' in row.pendingReview
      ? status('danger', 'Review record is unreadable. Remove this package to recover.', true, 'failed')
      : status('warn', 'Waiting for your review. Its node code cannot start until you approve it.', true, 'waiting')
  }
  if (!nodeId) return status('muted', 'Node unavailable', false, 'offline')
  const result = contributionAvailability(snapshot, nodeId, row.name, PLUGIN_API_MAJOR)
  const runtime = result.runtime
  if (runtime.kind === 'active') {
    if (runtime.warning) return status('warn', `Current version still active. Reloading it failed: ${runtime.warning}`, true, 'failed')
    if (row.disabled) return status('muted', 'Off after the node restarts. Still active until then.', true, 'disabled')
    if (result.available && runtime.pendingCandidate) return status('warn', 'Current version active. The update waits for a node restart.', true)
    if (result.available) return devMode ? status('accent', 'In development. Bundle changes are trusted without asking.') : status('ok', 'Active')
    switch (result.selection.kind) {
      case 'pending-trust': return status('warn', 'Waiting for approval on this device', true, 'waiting')
      case 'rejected': return status('muted', 'Rejected on this device', false, 'disabled')
      case 'bundle-missing': return status('danger', 'Its client bundle is not available on this device', true, 'failed')
      case 'incompatible': return status('danger', 'Its client bundle does not work with this version of acorn', true, 'failed')
      case 'declaration-conflict': return status('danger', 'Your nodes disagree about what this bundle is allowed to do', true, 'failed')
      default: return status('danger', 'Its client bundle does not match the running plugin', true, 'failed')
    }
  }
  switch (runtime.kind) {
    case 'compiled-active':
      return row.disabled ? status('muted', 'Off after the node restarts. Still active until then.', true, 'disabled') : status('ok', 'Active')
    case 'unknown': return status('muted', 'Not known yet')
    case 'unreachable': return status('muted', 'Node unavailable', false, 'offline')
    case 'absent': return status('muted', 'Not installed on this node')
    case 'disabled': return status('muted', 'Off', false, 'disabled')
    case 'failed': return status('danger', `Failed to load${runtime.reason ? `: ${runtime.reason}` : ''}`, true, 'failed')
    case 'waiting-for-restart': return status('warn', 'Waiting for the node to restart', true)
  }
}

/** A client-only plugin this device holds. It has no node to wait on, so the questions are whether it is
 *  on and whether this device accepted its bundle. */
export function devicePluginStatus(snapshot: PluginDistributionSnapshot, entry: DevicePluginEntry, devMode = false): PluginStatus {
  if (entry.row.disabled) return status('muted', 'Off', false, 'disabled')
  const key = decisionKey(entry.row.name, entry.hash)
  if (snapshot.acceptedKeys.has(key)) return devMode ? status('accent', 'In development. Bundle changes are trusted without asking.') : status('ok', 'Active')
  if (snapshot.decisionsByKey.get(key) === 'rejected') return status('muted', 'Rejected on this device', false, 'disabled')
  return status('warn', 'Waiting for approval on this device', true, 'waiting')
}

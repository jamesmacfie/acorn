import type { NodePluginRow } from '@acorn/protocol/api.ts'
import type { DevicePluginEntry, PluginDistributionSnapshot } from '../../../host/plugins/distributionModel'
import type { SettingsNavigate } from '../../../host/registries/shell/settings'
import { createDetailRequest } from '../settingsDetail'
import { pluginLabel } from '../../../host/plugins/pluginLabel'
import { devicePluginStatus, nodePluginStatus, type PluginStatus } from '../../../host/plugins/pluginStatus'

// The one list Settings > Plugins > Installed draws: the plugins the node in the header reports and the
// client-only plugins this device holds, side by side (docs/plugins/activation.md § What the owner sees).
// Two kinds because they are stored in two places and switched off in two ways: a node plugin by the
// node's disabled list, which takes effect when it restarts, and a device plugin by this device's own
// list, at once. Nothing here changes where either is stored.

export type InstalledPlugin =
  | { kind: 'node'; id: string; row: NodePluginRow }
  | { kind: 'device'; id: string; entry: DevicePluginEntry }

export type InstalledFilter = 'all' | 'needs-you' | 'device'

/** Node plugins then device ones, each by the name people read. The same id can be both, when a client-only plugin shares
 *  a name with one a node runs, so a plugin is addressed by kind and id together. */
export function installedPlugins(rows: readonly NodePluginRow[], device: readonly DevicePluginEntry[]): InstalledPlugin[] {
  return [
    ...[...rows].sort((a, b) => pluginLabel(a).localeCompare(pluginLabel(b))).map((row): InstalledPlugin => ({ kind: 'node', id: row.name, row })),
    ...[...device].sort((a, b) => pluginLabel(a.row).localeCompare(pluginLabel(b.row))).map((entry): InstalledPlugin => ({ kind: 'device', id: entry.row.name, entry })),
  ]
}

export const pluginRow = (plugin: InstalledPlugin): NodePluginRow => (plugin.kind === 'node' ? plugin.row : plugin.entry.row)

/** The plugin's name as people read it, or its id from a node that sends no name. */
export const pluginName = (plugin: InstalledPlugin): string => pluginLabel(pluginRow(plugin))

export function statusOf(snapshot: PluginDistributionSnapshot, nodeId: string | null, plugin: InstalledPlugin, devMode: boolean): PluginStatus {
  return plugin.kind === 'node' ? nodePluginStatus(snapshot, nodeId, plugin.row, devMode) : devicePluginStatus(snapshot, plugin.entry, devMode)
}

export const matchesFilter = (filter: InstalledFilter, plugin: InstalledPlugin, status: PluginStatus): boolean =>
  filter === 'all' || (filter === 'device' ? plugin.kind === 'device' : status.needsYou)

/** The status in one word, for a list row's badge. The sentence in `status.text` says more when the
 *  word is not enough (`statusDetail`). */
export function statusWord(status: PluginStatus): string {
  if (status.tone === 'ok') return 'Active'
  if (status.tone === 'accent') return 'In development'
  if (status.line === 'failed' || status.tone === 'danger') return 'Failed'
  if (status.line === 'waiting' || status.needsYou) return 'Needs you'
  if (status.line === 'disabled') return 'Off'
  if (status.line === 'offline') return 'Offline'
  return status.text.startsWith('Not installed') ? 'Not installed' : 'Unknown'
}

/** The status sentence when the badge's word leaves something out, or nothing. */
export const statusDetail = (status: PluginStatus): string | undefined =>
  status.text === statusWord(status) ? undefined : status.text

/** The badge's tone. A status dot's grey is a badge's plain one. */
export const statusBadgeTone = (status: PluginStatus): 'ok' | 'warn' | 'danger' | 'accent' | 'neutral' =>
  status.tone === 'muted' ? 'neutral' : status.tone

/** Where a plugin came from, in the words of the strip and the list: "built in", "from GitHub". */
export function pluginOrigin(plugin: InstalledPlugin): string {
  if (plugin.kind === 'device') return `on this device, from ${sourceKind(plugin.entry.sourceLabel)}`
  const installed = plugin.row.installed
  if (!installed || installed.bundled) return 'built in'
  return installed.source ? `from ${sourceKind(installed.source)}` : 'installed by hand'
}

// The installer writes the source as one display line (@acorn/protocol/plugin/source.ts).
const sourceKind = (source: string): string =>
  source.startsWith('github:') ? 'GitHub'
    : source.startsWith('npm:') ? 'npm'
      : source.startsWith('path:') ? 'a local folder'
        : /^https?:/.test(source) ? 'a download link' : source

// Manage plugin on a plugin's own settings page, and a tool's owner on Tools and permissions, open that
// plugin's page under Installed. The page is a detail of the Installed list rather than a page of its own,
// so the link travels as a detail request (../settingsDetail.ts).
export const INSTALLED_PAGE = 'plugins'
const requests = createDetailRequest<{ id: string; kind?: InstalledPlugin['kind'] }>()
/** The plugin page waiting to open, taken so it opens once. */
export const takePluginRequest = () => requests.take(INSTALLED_PAGE)

/** Open one plugin's page under Installed, from anywhere inside settings. */
export function openPluginPage(navigate: SettingsNavigate, id: string, kind?: InstalledPlugin['kind']): void {
  requests.open(navigate, INSTALLED_PAGE, kind ? { id, kind } : { id })
}

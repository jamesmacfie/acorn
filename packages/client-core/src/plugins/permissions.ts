import type { NodePluginPermissions, PluginContributions, PluginKeyClaimGrant, PluginWebviewGrant } from '@acorn/protocol/api.ts'
import { pluginKeyClaimGrants, pluginWebviewGrants } from '@acorn/protocol/pluginGrants.ts'
import { formatChord } from '../tasks/paneShortcuts'
import { describeChannel, isSubscribable } from './frames/channels'
import { describeScope, GRANTABLE_SCOPES } from './frames/scopes'

// What a plugin's declared permissions read as in the trust prompt (PluginTrustDialog.tsx), in two
// groups that are NOT the same kind of promise.
//
// The `node` half describes what the plugin's server code says it will touch. Nothing checks it: that
// code shares the node's process and can import `node:fs` whatever its manifest claims. The `api` /
// `events` half is enforced — the UI bridge refuses anything undeclared (plugins/frames/scopes.ts).
// Rendering them as one list would let the strong half lend credibility to the weak one, which is
// exactly the thing docs/security.md § Design rules, rule 6 forbids.
//
// A plain module rather than exports on the dialog, so a node-env suite can import it: client-core's
// tests run under plain Node with no Solid plugin, and a .tsx does not parse there.
//
// The update prompt's "what is new" mark is set-difference over these strings, so the WORDING is the
// diff key — rephrasing a line without changing the grant would light it up as newly requested.

const NODE_CORE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  fs: 'Read and write task files',
  git: 'Read repository history and run Git commands',
  tasks: 'Read task details',
  context: 'Read task launch context',
  models: 'Generate text with configured model providers',
  prefs: 'Read and write this plugin’s saved state',
  identity: 'Read the node owner identity',
  'projects:read': 'Read projects, including where every codebase lives on disk',
  'projects:config': 'Read every project’s build, dev and database scripts',
  'projects:write': 'Create and update projects, including their on-disk locations',
}

const ignoredLine = (count: number, kind = ''): string =>
  `${count} ${kind}${kind ? ' ' : ''}request${count === 1 ? '' : 's'} this version of acorn does not recognise (ignored)`

export const nodePermissionLines = (permissions: NodePluginPermissions): string[] => {
  const core = permissions.node.core.flatMap((facet) => NODE_CORE_DESCRIPTIONS[facet] ?? [])
  const ignored = permissions.node.core.length - core.length
  return [
    ...(permissions.node.secrets ? ['Use your saved credentials to make requests on its behalf'] : []),
    ...(permissions.node.exec ? ['Run commands on the node'] : []),
    ...permissions.node.net.map((host) => `Reach ${host}`),
    ...core,
    ...permissions.node.capabilities.map((id) => `Use capability ${id}`),
    ...(ignored ? [ignoredLine(ignored, 'node permission')] : []),
  ]
}

export const uiPermissionLines = (permissions: NodePluginPermissions): string[] => {
  // Classify instead of echoing: these strings came from an untrusted manifest, while every grant
  // sentence under "In this app — enforced" must be copy the host owns and can actually enforce.
  const scopes = permissions.api.flatMap((scope) => {
    if (!GRANTABLE_SCOPES.includes(scope)) return []
    const description = describeScope(scope)
    return description ? [description] : []
  })
  const events = permissions.events.flatMap((channel) => {
    if (!isSubscribable(channel)) return []
    const description = describeChannel(channel)
    return description ? [description] : []
  })
  const ignored = permissions.api.length + permissions.events.length - scopes.length - events.length
  return [...scopes, ...events, ...(ignored ? [ignoredLine(ignored)] : [])]
}

export const webviewGrants = (contributions: PluginContributions): PluginWebviewGrant[] =>
  pluginWebviewGrants(contributions)

export const webviewPermissionLines = (grants: readonly PluginWebviewGrant[]): string[] =>
  [...grants]
    .sort((a, b) => a.surface.localeCompare(b.surface))
    .map((grant) => `Show web pages from ${[...grant.hosts].sort().join(', ')} in the "${grant.label}" pane`)

// How a line is DRAWN, keyed off the sentences above. Presentation only: an icon that helps a reader
// skim, and `high` for the handful of grants that deserve to survive a skim — credentials, running
// commands, and the two that hand over where code lives on disk.
//
// Keyed off the copy rather than threading a second value out of every describe* function in three
// files. The strings are host-owned constants, so the failure mode of a rewording is a neutral icon
// on one row — cosmetic, not a wrong claim. Keep this table next to the copy it reads.
const LINE_STYLES: readonly (readonly [prefix: string, icon: string, high?: boolean])[] = [
  ['Use your saved credentials', 'key-round', true],
  ['Run commands on the node', 'square-terminal', true],
  ['Read projects, including where every codebase lives on disk', 'folder-tree', true],
  ['Read every project’s build, dev and database scripts', 'file-cog', true],
  ['Create and update projects', 'folder-plus', true],
  ['Reach ', 'globe'],
  ['Read and write task files', 'file-text'],
  ['Read repository history and run Git commands', 'git-branch'],
  ['Read task details', 'list'],
  ['Read task launch context', 'info'],
  ['Generate text with configured model providers', 'sparkles'],
  ['Read and write this plugin’s saved state', 'database'],
  ['Read the node owner identity', 'user-round'],
  ['Use capability ', 'puzzle'],
  ['Create and update tasks', 'square-pen'],
  ['Read tasks', 'list'],
  ['Read workspaces', 'layout-grid'],
  ['Receive ', 'radio'],
  ['Show web pages from ', 'app-window'],
  ['Handle ', 'keyboard'],
]

export type PermissionLineStyle = { icon: string; high: boolean }

export const permissionLineStyle = (text: string): PermissionLineStyle => {
  // The ignored line opens with a count, so it is the one entry that cannot be matched by prefix.
  if (text.includes('does not recognise')) return { icon: 'circle-dashed', high: false }
  const hit = LINE_STYLES.find(([prefix]) => text.startsWith(prefix))
  return { icon: hit?.[1] ?? 'shield', high: hit?.[2] ?? false }
}

export const keyClaimGrants = (contributions: PluginContributions): PluginKeyClaimGrant[] =>
  pluginKeyClaimGrants(contributions)

export const keyClaimPermissionLines = (grants: readonly PluginKeyClaimGrant[]): string[] =>
  [...grants]
    .sort((a, b) => a.surface.localeCompare(b.surface))
    .map((grant) => `Handle ${grant.chords.map(formatChord).join(', ')} in the "${grant.label}" surface`)

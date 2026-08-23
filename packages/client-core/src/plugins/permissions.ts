import type { NodePluginPermissions, PluginContributions, PluginExtensionGrant, PluginHarnessGrant, PluginKeyClaimGrant, PluginScheduleGrant, PluginTaskCheckGrant, PluginWebviewGrant } from '@acorn/protocol/api.ts'
import { pluginExtensionGrants, pluginHarnessGrants, pluginKeyClaimGrants, pluginScheduleGrants, pluginTaskCheckGrants, pluginWebviewGrants } from '@acorn/protocol/pluginGrants.ts'
import { describeCadence } from '@acorn/protocol/schedules.ts'
import { formatChord } from '../tasks/paneShortcuts'
import { describeChannel, isFrameChannel } from './frames/channels'
import { describeScope, GRANTABLE_SCOPES } from './frames/scopes'

// What a plugin's declared permissions read as in the trust prompt (PluginTrustDialog.tsx): a `node`
// group (declared, unenforced) and an `api`/`events` group (enforced by plugins/frames/scopes.ts),
// kept apart per docs/security.md § Design rules, rule 6.
//
// A plain module rather than exports on the dialog, so a node-env suite can import it. A .tsx does not
// parse under plain Node with no Solid plugin.
//
// For why the update diff runs on `key` and never on `text`, see docs/security.md § Third-party plugin
// bundles, "What 'gained' means".
export type PermissionLine = {
  // The stable grant identifier the update diff compares. Never shown.
  key: string
  // The human sentence. Free to change at any time.
  text: string
  icon: string
  high: boolean
}

/** What a description table holds for one grant: the copy plus how the prompt draws it. */
export type GrantDescription = { text: string; icon: string; high?: boolean }

const line = (key: string, description: GrantDescription): PermissionLine =>
  ({ key, text: description.text, icon: description.icon, high: description.high ?? false })

const NODE_CORE_DESCRIPTIONS: Readonly<Record<string, GrantDescription>> = {
  fs: { text: 'Read and write task files', icon: 'file-text' },
  git: { text: 'Read repository history and run Git commands', icon: 'git-branch' },
  tasks: { text: 'Read task details', icon: 'list' },
  context: { text: 'Read task launch context', icon: 'info' },
  models: { text: 'Generate text with configured model providers', icon: 'sparkles' },
  prefs: { text: 'Read and write this plugin’s saved state', icon: 'database' },
  identity: { text: 'Read the node owner identity', icon: 'user-round' },
  // The three that hand over where code lives on disk, and the reason `high` exists.
  'projects:read': { text: 'Read projects, including where every codebase lives on disk', icon: 'folder-tree', high: true },
  'projects:config': { text: 'Read every project’s build, dev and database scripts', icon: 'file-cog', high: true },
  'projects:write': { text: 'Create and update projects, including their on-disk locations', icon: 'folder-plus', high: true },
}

// One line for everything this acorn could not name.
//
// The count is part of the key, and that is the point of the line. One unrecognised request becoming
// three is a widening this shell cannot describe, and a constant key would let it slide past the
// update prompt unremarked.
const ignoredLine = (key: string, count: number, kind = ''): PermissionLine => ({
  key: `${key}:${count}`,
  text: `${count} ${kind}${kind ? ' ' : ''}request${count === 1 ? '' : 's'} this version of acorn does not recognise (ignored)`,
  icon: 'circle-dashed',
  high: false,
})

export const nodePermissionLines = (permissions: NodePluginPermissions): PermissionLine[] => {
  const core = permissions.node.core.flatMap((facet) => {
    const description = NODE_CORE_DESCRIPTIONS[facet]
    return description ? [line(`node.core:${facet}`, description)] : []
  })
  const ignored = permissions.node.core.length - core.length
  return [
    ...(permissions.node.secrets
      ? [line('node.secrets', { text: 'Use your saved credentials to make requests on its behalf', icon: 'key-round', high: true })]
      : []),
    ...(permissions.node.exec ? [line('node.exec', { text: 'Run commands on the node', icon: 'square-terminal', high: true })] : []),
    ...permissions.node.net.map((host) => line(`node.net:${host}`, { text: `Reach ${host}`, icon: 'globe' })),
    ...core,
    ...permissions.node.capabilities.map((id) => line(`node.capability:${id}`, { text: `Use capability ${id}`, icon: 'puzzle' })),
    ...(ignored ? [ignoredLine('node.ignored', ignored, 'node permission')] : []),
  ]
}

export const uiPermissionLines = (permissions: NodePluginPermissions): PermissionLine[] => {
  // Classify instead of echoing. These strings came from an untrusted manifest, and every sentence
  // under "Enforced" has to be copy the host owns. The key is the scope name, which is host-recognised
  // by this point.
  const scopes = permissions.api.flatMap((scope) => {
    if (!GRANTABLE_SCOPES.includes(scope)) return []
    const description = describeScope(scope)
    return description ? [line(scope, description)] : []
  })
  const events = permissions.events.flatMap((channel) => {
    if (!isFrameChannel(channel)) return []
    const description = describeChannel(channel)
    return description ? [line(channel, description)] : []
  })
  const ignored = permissions.api.length + permissions.events.length - scopes.length - events.length
  return [...scopes, ...events, ...(ignored ? [ignoredLine('ui.ignored', ignored)] : [])]
}

export const webviewGrants = (contributions: PluginContributions): PluginWebviewGrant[] =>
  pluginWebviewGrants(contributions)

export const webviewPermissionLines = (grants: readonly PluginWebviewGrant[]): PermissionLine[] =>
  [...grants]
    .sort((a, b) => a.surface.localeCompare(b.surface))
    .map((grant) => {
      const hosts = [...grant.hosts].sort()
      // The hosts are part of the grant, not decoration, so they belong in the key: widening a
      // surface's host list has to read as newly requested.
      return line(`webview:${grant.surface}:${hosts.join(' ')}`, {
        text: `Show web pages from ${hosts.join(', ')} in the "${grant.label}" pane`,
        icon: 'app-window',
      })
    })

export const scheduleGrants = (contributions: PluginContributions): PluginScheduleGrant[] =>
  pluginScheduleGrants(contributions)

// A `Declared` line rather than an `Enforced` one, because this is the plugin's own node code and
// nothing checks what it does once it starts. What the line adds is when it runs, with no client open,
// which a person cannot discover by using the plugin.
//
// The cadence is part of the key, so a package that moves from daily to every five minutes reads as
// newly requested.
export const schedulePermissionLines = (grants: readonly PluginScheduleGrant[]): PermissionLine[] =>
  [...grants]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((grant) =>
      line(`schedule:${grant.id}:${JSON.stringify(grant.cadence)}`, {
        text: `Run “${grant.label}” on the node ${describeCadence(grant.cadence)}, with nobody watching`,
        icon: 'clock',
      }),
    )

export const taskCheckGrants = (contributions: PluginContributions): PluginTaskCheckGrant[] =>
  pluginTaskCheckGrants(contributions)

// `Declared`, like a schedule and for the same reason: the plugin's own node code runs and nothing
// checks it. What the line adds is that archiving a task asks this package, and that a check which can
// clean up will offer to change something.
//
// Two sentences rather than one with a clause, because the second fact is worth reading twice.
// `cleansUp` is in the key, so a version that starts offering a cleanup reads as newly requested.
export const taskCheckPermissionLines = (grants: readonly PluginTaskCheckGrant[]): PermissionLine[] =>
  [...grants]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((grant) =>
      line(`task-check:${grant.id}:${grant.cleansUp}`, {
        text: grant.cleansUp
          ? 'Check a task before you archive it, and offer to clean up after it'
          : 'Check a task before you archive it',
        icon: 'archive',
      }),
    )

export const harnessGrants = (contributions: PluginContributions): PluginHarnessGrant[] =>
  pluginHarnessGrants(contributions)

// `Enforced`, and the only line in that group that names a program. The claim does not depend on the
// plugin behaving: the host spawns this command with these arguments and nothing else, and the plugin
// never gets a process of its own (docs/managed-agents.md § Harnesses).
//
// `high`, because "acorn will run this binary" is the fact an owner most needs to read.
//
// The environment is a second sentence, and both it and the command are in the key, so a version that
// swaps the binary or widens the globs reads as newly requested.
export const harnessPermissionLines = (grants: readonly PluginHarnessGrant[]): PermissionLine[] =>
  [...grants]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((grant) => {
      const run = grant.kind === 'command'
        ? `Run “${grant.run}” as the “${grant.label}” agent`
        : `Run JavaScript this package ships (${grant.run}) as the “${grant.label}” agent`
      const env = grant.env.length ? ` and pass it ${grant.env.join(', ')} from this node’s environment` : ''
      return line(`harness:${grant.id}:${grant.kind}:${grant.run}:${grant.env.join(' ')}`, {
        text: `${run}${env}`,
        icon: 'bot',
        high: true,
      })
    })

export const keyClaimGrants = (contributions: PluginContributions): PluginKeyClaimGrant[] =>
  pluginKeyClaimGrants(contributions)

export const extensionGrants = (pluginId: string, contributions: PluginContributions): PluginExtensionGrant[] =>
  pluginExtensionGrants(pluginId, contributions)

// The cross-plugin lines, under `Enforced` rather than `Declared`. The host delivers only to points a
// manifest declared, draws only the descriptor shapes it knows, and never puts a replacement on screen
// the owner did not pick in settings. None of it depends on the plugin behaving.
//
// The copy is the host's. `label` is manifest text and reaches the sentence as an interpolated string,
// as a webview surface's label does, so a plugin cannot phrase its own grant.
const EXTENSION_KIND_ICON: Record<PluginExtensionGrant['kind'], string> = {
  hosts: 'door-open',
  extends: 'puzzle',
  replaces: 'replace',
}

export const extensionPermissionLines = (grants: readonly PluginExtensionGrant[]): PermissionLine[] =>
  grants.map((grant) => {
    const text = grant.kind === 'hosts'
      ? `Let other plugins add rows to its “${grant.label}” list`
      : grant.kind === 'extends'
        // The owner half of the reference is the point of this line. It names the package this one
        // reaches into, so "this plugin extends that plugin" is on screen before anything runs.
        ? `Add its own rows to ${grant.target.split(':')[0]}’s “${grant.label}” list`
        : `Offer to replace acorn’s own ${grant.target} — you choose in Settings`
    // Kind and target together, so a package that starts extending a different plugin's point reads as
    // newly requested.
    return line(`extension:${grant.kind}:${grant.target}`, { text, icon: EXTENSION_KIND_ICON[grant.kind] })
  })

export const keyClaimPermissionLines = (grants: readonly PluginKeyClaimGrant[]): PermissionLine[] =>
  [...grants]
    .sort((a, b) => a.surface.localeCompare(b.surface))
    // Same rule as the webview hosts: the chords are the grant.
    .map((grant) =>
      line(`keys:${grant.surface}:${[...grant.chords].sort().join(' ')}`, {
        text: `Handle ${grant.chords.map(formatChord).join(', ')} in the "${grant.label}" surface`,
        icon: 'keyboard',
      }),
    )

import type { NodePluginPermissions, PluginContributions, PluginExtensionGrant, PluginHarnessGrant, PluginKeyClaimGrant, PluginScheduleGrant, PluginTaskCheckGrant, PluginWebviewGrant } from '@acorn/protocol/api.ts'
import { isExtensionPointKind, isHookMode, type ExtensionPointKind, type HookMode } from '@acorn/protocol/extensionPoints.ts'
import { pluginExtensionGrants, pluginHarnessGrants, pluginKeyClaimGrants, pluginScheduleGrants, pluginTaskCheckGrants, pluginWebviewGrants } from '@acorn/protocol/pluginGrants.ts'
import { describeCadence } from '@acorn/protocol/schedules.ts'
import { formatChord } from '../../tasks/paneShortcuts'
import { describeChannel } from '../frames/channels'
import { describeScope, GRANTABLE_SCOPES } from '../frames/scopes'

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

// `pluginId` tells a plugin channel apart from another plugin's; without it every one reads as its own.
export const uiPermissionLines = (permissions: NodePluginPermissions, pluginId?: string): PermissionLine[] => {
  // Classify instead of echoing. These strings came from an untrusted manifest, and every sentence
  // under "Enforced" has to be copy the host owns. The key is the scope name, which is host-recognised
  // by this point.
  const scopes = permissions.api.flatMap((scope) => {
    if (!GRANTABLE_SCOPES.includes(scope)) return []
    const description = describeScope(scope)
    return description ? [line(scope, description)] : []
  })
  const events = permissions.events.flatMap((channel) => {
    // No shape guard first: `describeChannel` already answers "nothing this build can describe" with
    // undefined, and it now covers the node-side catalogue as well as the frame one. A guard that knew
    // only about frames sent an enforced node grant to the "ignored" line, which is a lie about what the
    // owner is consenting to.
    const description = describeChannel(channel, pluginId)
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

/**
 * What the owner's half of each kind reads as, and what the contributor's does.
 *
 * Two tables rather than one sentence with a noun slot, because the verbs differ: rows are added,
 * marks are put on things, UI is drawn, a box is placed, and a decision is taken part in. A generated
 * sentence would have read as one in four cases and as machine output in the rest.
 *
 * `%s` is the owner plugin's id on the contributor side, minted by the host from the point reference.
 * The label is manifest text and is quoted, the way a webview surface's label is.
 */
const HOSTS_COPY: Record<ExtensionPointKind, string> = {
  rows: 'Let other plugins add rows to its “%l” list',
  annotation: 'Let other plugins put marks on the items in its “%l”',
  remote: 'Reserve part of its “%l” for other plugins’ own UI',
  rectangle: 'Reserve a box beside its “%l” for another plugin’s own page',
  hook: 'Let other plugins act before it does “%l”',
}

const EXTENDS_COPY: Record<ExtensionPointKind, string> = {
  rows: 'Add its own rows to %s’s “%l” list',
  annotation: 'Put its own marks on the items in %s’s “%l”',
  remote: 'Draw its own UI inside %s’s “%l”',
  rectangle: 'Place its own page beside %s’s “%l”',
  hook: 'Take part in %s’s “%l” decision',
}

// A handler's mode is the difference between watching and stopping, so it replaces the generic hook
// sentence above rather than qualifying it.
const HOOK_MODE_COPY: Record<HookMode, string> = {
  observe: 'Watch %s’s “%l” decision as it happens',
  transform: 'Change what %s does when it “%l”s',
  veto: 'Stop %s from doing “%l”',
}

// A grant this build has no sentence for. It still gets a line, and the line still carries the target
// in its key, because "this package reaches into that one" is the disclosure and a shell that cannot
// name the kind must not therefore say nothing (docs/security.md § Design rules, rule 6).
const UNKNOWN_KIND_COPY = { hosts: 'Open part of its own “%l” to other plugins', extends: 'Reach into %s’s “%l”' }

const fill = (template: string, grant: PluginExtensionGrant): string =>
  template.replaceAll('%s', grant.target.split(':')[0] ?? '').replaceAll('%l', grant.label)

/** The sentence for one cross-plugin grant, and the key the update diff compares it under. Exported so
 *  the copy can be held against the kind list without rendering a dialog: every kind and both
 *  directions must have a sentence, and a kind added to the protocol with no line here is a hole a
 *  person would consent through. */
export function extensionPermissionLine(grant: PluginExtensionGrant): PermissionLine {
  const kind = isExtensionPointKind(grant.pointKind) ? grant.pointKind : null
  const mode = grant.kind === 'extends' && kind === 'hook' && isHookMode(grant.mode) ? grant.mode : null
  const template = grant.kind === 'replaces'
    ? 'Offer to replace acorn’s own %t — you choose in Settings'
    : mode
      ? HOOK_MODE_COPY[mode]
      : kind
        // The owner half of the reference is the point of the `extends` line. It names the package this
        // one reaches into, so "this plugin extends that plugin" is on screen before anything runs.
        ? (grant.kind === 'hosts' ? HOSTS_COPY : EXTENDS_COPY)[kind]
        : UNKNOWN_KIND_COPY[grant.kind]
  // Kind, point kind, mode and target together, so a package that starts vetoing where it used to
  // observe, or reaches into a different plugin's point, reads as newly requested. The point kind and
  // the mode are omitted when there is none rather than spelled as a placeholder: `replaces` is the
  // exclusive slot and never has either, and a segment that is always the same carries nothing.
  const parts = ['extension', grant.kind, ...(kind ? [kind] : []), ...(mode ? [mode] : []), grant.target]
  const key = parts.join(':')
  return line(key, {
    text: fill(template, grant).replace('%t', grant.target),
    icon: EXTENSION_KIND_ICON[grant.kind],
    // Stopping or rewriting somebody else's decision is the one cross-plugin grant that changes what
    // another package does rather than what it shows.
    high: mode === 'veto' || mode === 'transform',
  })
}

export const extensionPermissionLines = (grants: readonly PluginExtensionGrant[]): PermissionLine[] =>
  grants.map(extensionPermissionLine)

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

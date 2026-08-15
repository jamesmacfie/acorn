import type { NodePluginPermissions, PluginContributions, PluginExtensionGrant, PluginKeyClaimGrant, PluginWebviewGrant } from '@acorn/protocol/api.ts'
import { pluginExtensionGrants, pluginKeyClaimGrants, pluginWebviewGrants } from '@acorn/protocol/pluginGrants.ts'
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
// Every line is a RECORD, and the split between `key` and `text` is the point of it. The update
// prompt's "what is new" mark is a set-difference, and it used to run over the sentences — so the
// user-facing copy was the identifier. Improving the wording of a line ("Read your projects" →
// "See your projects") would then re-prompt every owner of every installed plugin with that line
// highlighted as newly requested: the dialog wrong, in the alarming direction, over a copy edit.
// Owners who see enough false "asks for more" learn to click through it, which is the one reflex a
// trust prompt exists to prevent. The grant identifier is the key now, and the sentence is free.
//
// `icon` and `high` ride along for the same reason. They used to be reconstructed downstream by
// prefix-matching the copy against a table of twenty `startsWith` rules plus a substring sniff, which
// meant a new high-risk grant whose sentence matched no prefix rendered as boring as "show a toast".
// The tables below already know how serious each grant is; they just stop discarding it.
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
// The COUNT is part of the key, and that is the whole point of the line. An update that asks for three
// unrecognised things where it previously asked for one has grown its reach — this shell just cannot
// say into what — and a constant key would let exactly that slide past the "what is new" mark
// unremarked. Growth in the unnamed is still growth, and it is the growth an owner has least ability
// to reason about, so it is the last thing that should diff as unchanged.
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
  // Classify instead of echoing: these strings came from an untrusted manifest, while every grant
  // sentence under "In this app — enforced" must be copy the host owns and can actually enforce. The
  // KEY is the scope name, which is host-recognised by the time it gets here.
  const scopes = permissions.api.flatMap((scope) => {
    if (!GRANTABLE_SCOPES.includes(scope)) return []
    const description = describeScope(scope)
    return description ? [line(scope, description)] : []
  })
  const events = permissions.events.flatMap((channel) => {
    if (!isSubscribable(channel)) return []
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

export const keyClaimGrants = (contributions: PluginContributions): PluginKeyClaimGrant[] =>
  pluginKeyClaimGrants(contributions)

export const extensionGrants = (pluginId: string, contributions: PluginContributions): PluginExtensionGrant[] =>
  pluginExtensionGrants(pluginId, contributions)

// The cross-plugin lines, and they belong under `Enforced` rather than `Declared`. That is a claim about
// what the host actually does, and it is true in both directions: the host delivers only to points a
// manifest declared, draws only the descriptor shapes it knows, and never puts a replacement on screen
// that the owner did not pick in settings. Nothing about any of it depends on the plugin behaving.
//
// The COPY is the host's, not the plugin's. `label` is manifest text and reaches the sentence as an
// interpolated string, exactly as a webview surface's label already does; what the sentence CLAIMS is
// host vocabulary, so a plugin cannot phrase its own grant.
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
        // The owner half of the reference is the whole point of this line: it names the package this one
        // reaches into, so "this plugin extends that plugin" is on screen before anything runs.
        ? `Add its own rows to ${grant.target.split(':')[0]}’s “${grant.label}” list`
        : `Offer to replace acorn’s own ${grant.target} — you choose in Settings`
    // Kind and target together: a package that starts extending a DIFFERENT plugin's point has grown its
    // reach, and a constant key would let that slide past the update prompt's "what is new" mark.
    return line(`extension:${grant.kind}:${grant.target}`, { text, icon: EXTENSION_KIND_ICON[grant.kind] })
  })

export const keyClaimPermissionLines = (grants: readonly PluginKeyClaimGrant[]): PermissionLine[] =>
  [...grants]
    .sort((a, b) => a.surface.localeCompare(b.surface))
    // Same rule as the webview hosts: the chords ARE the grant.
    .map((grant) =>
      line(`keys:${grant.surface}:${[...grant.chords].sort().join(' ')}`, {
        text: `Handle ${grant.chords.map(formatChord).join(', ')} in the "${grant.label}" surface`,
        icon: 'keyboard',
      }),
    )

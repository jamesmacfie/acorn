// `acorn-plugin.json` — the file at the root of an installed plugin package, and the only thing the
// loader trusts about it (docs/plugins.md).
//
// It arrives from disk rather than from the wire, and it is still parsed with a module-level Zod
// schema and `safeParse` (docs/architecture-overview.md § wire validation). Disk is a trust boundary
// here for the same reason a request body is: the bytes were written by someone other than us, and
// everything downstream — a route namespace, a SQLite filename, a set of CoreServices facets — is
// bound from what this file says.
//
// The HOST binds every namespace from `id`. `plugin.name` inside the bundle is checked to match and
// otherwise ignored, so a bundle cannot mount itself under another plugin's prefix by lying.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  compileContentLinkPattern,
  CONTENT_LINK_PATTERN_MAX_LENGTH,
} from '@acorn/protocol/contentLinkPattern.ts'
import {
  isAllowedWebviewUrl,
  normalizeWebviewHost,
  WEBVIEW_HOST_MAX_COUNT,
  WEBVIEW_HOST_MAX_LENGTH,
} from '@acorn/protocol/webview.ts'
import {
  isNormalizedChord,
  isPluginKeyClaim,
  isPluginShortcutChord,
  isReservedPluginKeyClaim,
} from '@acorn/protocol/keybindings.ts'

// Re-exported so this file stays the one import for everything manifest-shaped. The constant itself
// moved to @acorn/protocol when the client gained a stake in it: the node uses it to decide what to
// LOAD, the client to decide which of a fleet's bundles it can RUN
// (client-core/plugins/resolveBundles.ts), and one compatibility contract cannot live on one side.
export { PLUGIN_API_MAJOR } from '@acorn/protocol/api.ts'

// Same shape as the route registry's and the plugin database factory's id rules, plus a length
// bound, because this id becomes both `/v2/p/<id>` and `<dataRoot>/plugins/<id>.sqlite`.
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/

// Node-half permissions. This block SHAPES `ctx` (main/pluginPermissions.ts) and is disclosed to the
// user; it is not enforced, because a loaded bundle shares the Node's process and can import
// `node:fs` directly. docs/security.md is blunt about that distinction and every
// surface rendering this block has to preserve it.
const nodePermissions = z.object({
  // CoreServices facets. Tokens are validated in pluginPermissions.ts rather than here: an unknown
  // token is a facet this acorn does not have, which is a skip-that-facet, not a bad manifest.
  core: z.array(z.string().min(1)).max(64).default([]),
  capabilities: z.array(z.string().min(1)).max(64).default([]),
  // Use-scoped credential access through ctx.core.secrets.
  secrets: z.boolean().default(false),
  // The process broker (ctx.core.proc).
  exec: z.boolean().default(false),
  // Intended egress hosts. Pure disclosure until the credential broker and rung 2/3 land.
  net: z.array(z.string().min(1)).max(64).default([]),
})

export type NodePermissions = z.infer<typeof nodePermissions>

// A relative entrypoint. Absolute paths and `..` escapes are rejected here so the loader's
// confinement check never has to reason about a path that was hostile from the start.
const entry = z.string().min(1).max(256).refine(
  (value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'),
  'entrypoint must be a relative path inside the plugin directory',
)

// A rectangle the plugin's client bundle draws, hosted by the shell in a sandboxed frame
// (docs/plugins.md).
//
// Declared HERE and nowhere else. The shell's contribution registries are keyed by un-namespaced ids
// that are persisted layout keys and chord targets, so who may claim `board` has to be decided by the
// host reading this file — a plugin's client bundle cannot register a shell contribution at all. This
// is the client-side twin of the route-namespace binding the node host already does.
const webviewHost = z.string().min(1).max(WEBVIEW_HOST_MAX_LENGTH).superRefine((value, ctx) => {
  try {
    normalizeWebviewHost(value)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
  }
})

const frameSurface = z.object({
  // Which registry this lands in. The shell renders all four the same way; what differs is the
  // surrounding chrome it supplies.
  target: z.enum(['pane', 'refPanel', 'settings', 'importer', 'webview']),
  // The contribution id. Not namespaced by us: it becomes a persisted layout key the moment a user
  // opens the pane, and prefixing it later would be a storage break (registries/plugin.ts).
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  // A Lucide name, resolved client-side; an unmatched name renders as-is.
  glyph: z.string().min(1).max(64).default('puzzle'),
  order: z.number().int().min(0).max(100_000).default(500),
  // Costless now while the schema is unversioned, and what lets a future mobile shell skip a
  // desktop-shaped pane instead of rendering it unusably (docs/future/remote.md).
  formFactor: z.array(z.enum(['desktop', 'mobile'])).min(1).max(2).default(['desktop']),
  // `refPanel` only, and checked against the plugin id by the client adapter — a panel names the
  // provider whose items it renders, and may only name its own.
  providerId: z.string().min(1).max(64).optional(),
  // `settings` only.
  group: z.enum(['general', 'workspace']).optional(),
  // `webview` only. The URL may be static or resolved from the plugin's own node route; the declared
  // hosts are the grant the device records and Electron enforces across redirects.
  url: z.string().min(1).max(2_048).optional(),
  urlSource: z.string().min(1).max(256).optional(),
  hosts: z.array(webviewHost).min(1).max(WEBVIEW_HOST_MAX_COUNT).optional(),
  // Chords the frame may keep instead of forwarding to the shell. Runtime code may narrow this
  // list, never widen it; declaring the upper bound makes the capture visible before code runs.
  claimsKeys: z.array(z.string().min(1).max(64).superRefine((value, ctx) => {
    if (isReservedPluginKeyClaim(value)) {
      ctx.addIssue({ code: 'custom', message: `${value} is reserved by acorn and cannot be claimed` })
    } else if (!isPluginKeyClaim(value)) {
      ctx.addIssue({ code: 'custom', message: 'claimed keys must be canonical chords with meta, ctrl, or alt' })
    }
  })).max(32).default([]),
})

// ── Declarative chrome (docs/plugins.md) ───────────────────────────
//
// Small chrome — a rail source, a footer badge, palette rows, an attention item, a node stat — is
// DATA, not a rectangle. An iframe for a 20px badge is absurd, and a badge has to be live when no
// plugin frame is mounted anywhere, so its data cannot come from plugin UI code at all: it comes
// from a route on the plugin's node half, which is always running, and the host draws the pixels
// with its own components.
//
// Everything below is therefore either static data or a path into the plugin's own namespace. The
// confinement check itself lives in the manifest-level refinement, because it needs `id`.

// A path the host will GET or POST on this plugin's behalf. Bounded here, confined below.
const pluginRoute = z.string().min(1).max(256)

// The closed verb set the host executes on a descriptor's behalf. Closed on purpose: it is the
// flexibility dial, every plugin composes the same few verbs, and adding one later is additive.
//
// `invoke` — an RPC into the plugin's frame, mounting it if none is up — is deliberately NOT here in
// v1. It needs a headless frame lifecycle the shell does not have, and a verb that parses but does
// nothing is worse for an author than one that fails loudly.
const chromeAction = z.discriminatedUnion('verb', [
  // A pane the SAME manifest declares under `frames`, checked below. The clicked row's id rides along
  // as a pane intent (client-core/registries/clientEvents.ts).
  z.object({ verb: z.literal('openPane'), pane: z.string().min(1).max(64) }),
  z.object({ verb: z.literal('runNodeAction'), path: pluginRoute }),
  // Host-owned promotion. The selected rail row carries the seed; the verb itself carries no plugin
  // callbacks and therefore survives the descriptor boundary.
  z.object({ verb: z.literal('createTask') }),
  // https only, and opened in the real browser — never in-app (docs/electron.md § navigation policy).
  z.object({ verb: z.literal('openUrl'), url: z.string().url() }),
])

// Seconds. A fallback for data that changes with no node-side trigger; the primary freshness path is
// `ctx.events.status()` on the existing invalidation channel. Floored so a descriptor cannot turn
// itself into a busy loop against a remote node.
const refresh = z.number().int().min(30).max(86_400).optional()

const sourceDescriptor = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  glyph: z.string().min(1).max(64).default('puzzle'),
  // Required, exactly as SourceContribution.order is: rail position is DECLARED, never derived from
  // plugin load order (registries/sources.ts states the argument at length).
  order: z.number().int().min(0).max(100_000),
  // Optional gate on a connected integration, same as a first-party source.
  providerId: z.string().min(1).max(64).optional(),
  // GET → { items: PluginRailItem[] }
  items: pluginRoute,
  onSelect: chromeAction.optional(),
  refresh,
})

const slotDescriptor = z.object({
  id: z.string().min(1).max(64),
  // Enumerated host slots, so an unknown one is a parse error rather than a contribution that
  // silently never appears. `footer` is the task footer — the slot `docker-footer-badge` already
  // occupies, which is the precedent the phase doc names.
  slot: z.enum(['footer']),
  icon: z.string().min(1).max(64).optional(),
  // GET → PluginSlotBadge | null, where null hides the badge.
  data: pluginRoute,
  onClick: chromeAction.optional(),
  refresh,
})

const paletteDescriptor = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  action: chromeAction,
})

const commandCategory = z.enum(['action', 'navigation', 'pane', 'task', 'terminal', 'workspace'])

// `createTask` depends on a selected rail row and its host-owned promotion callback. A command has
// neither, so exposing that otherwise-valid chrome verb here would create a command that can only fail.
const commandAction = z.discriminatedUnion('verb', [
  z.object({ verb: z.literal('openPane'), pane: z.string().min(1).max(64) }),
  z.object({ verb: z.literal('runNodeAction'), path: pluginRoute }),
  z.object({ verb: z.literal('openUrl'), url: z.string().url() }),
])

const commandDescriptor = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  category: commandCategory.default('action'),
  palette: z.boolean().default(true),
  action: commandAction,
})

const keybindingDescriptor = z.object({
  command: z.string().min(1).max(64),
  defaultChord: z.string().min(1).max(64).superRefine((value, ctx) => {
    if (!isNormalizedChord(value)) {
      ctx.addIssue({ code: 'custom', message: 'shortcut must use canonical meta+ctrl+alt+shift+key order' })
    } else if (!isPluginShortcutChord(value)) {
      ctx.addIssue({ code: 'custom', message: 'plugin shortcuts require meta, ctrl, or alt' })
    }
  }),
  when: z.enum(['global', 'task', 'surface']),
  surface: z.string().min(1).max(64).optional(),
})

const attentionDescriptor = z.object({
  id: z.string().min(1).max(64),
  order: z.number().int().min(0).max(100_000).default(500),
  // GET → { items: PluginAttentionWireItem[] }, fetched per node like every attention source.
  items: pluginRoute,
  refresh,
})

const nodeStatDescriptor = z.object({
  id: z.string().min(1).max(64),
  order: z.number().int().min(0).max(100_000).default(500),
  // Singular/plural, so a card reads "1 card stuck" rather than "1 cards stuck".
  label: z.tuple([z.string().min(1).max(60), z.string().min(1).max(60)]),
  // GET → PluginNodeStatValue
  data: pluginRoute,
  refresh,
})

const contentLinkPattern = z.string().min(1).max(CONTENT_LINK_PATTERN_MAX_LENGTH).superRefine((value, ctx) => {
  try {
    compileContentLinkPattern(value)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
  }
})

const contentLinkDescriptor = z.object({
  id: z.string().min(1).max(64),
  match: contentLinkPattern,
  openPane: z.string().min(1).max(64),
  item: z.string().min(1).max(32),
})

// An entry in the agent composer's "add Acorn context" list, served by two routes on the plugin's own
// node half (@acorn/protocol/agentContext.ts holds the response schemas).
//
// The registry this lands in takes two async FUNCTIONS, which is what kept it off this list while
// `http` and `database` waited — but the contract was already data-in/data-out, so a pair of routes
// carries it with nothing lost. It follows the same argument as every descriptor above: the data lives
// on the node anyway, the node is always running, and the host draws the picker with its own
// components.
//
// `revision?()` gets NO manifest form, and that is a decision rather than an omission. It is a
// synchronous number the composer reads while assembling its automatic-context cache key, and a
// descriptor answers across a fetch — there is no value to return in time. The invalidation ping the
// rest of the chrome already rides (client-core/plugins/chrome/data.ts) covers the same freshness
// need, so a plugin loses nothing it could have used.
const agentContextDescriptor = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(240).optional(),
  // GET ?taskId=&workspaceId= → AgentContextOption[]
  options: pluginRoute,
  // POST { taskId, workspaceId?, optionIds? } → snapshot bodies. The host binds `source` from the
  // plugin id, stamps the capture time, and measures the bytes itself.
  capture: pluginRoute,
})

// `api` and `events` are enforced by the UI bridge (client-core/plugins/frames). `contributions` is
// still a loose object even now that phase 4's keys are named: a manifest written for a newer acorn
// should contribute less on an older one rather than fail to parse.
const contributions = z.looseObject({
  frames: z.array(frameSurface).max(32).default([]),
  sources: z.array(sourceDescriptor).max(8).default([]),
  slots: z.array(slotDescriptor).max(8).default([]),
  palette: z.array(paletteDescriptor).max(32).default([]),
  commands: z.array(commandDescriptor).max(32).default([]),
  keybindings: z.array(keybindingDescriptor).max(32).default([]),
  attention: z.array(attentionDescriptor).max(4).default([]),
  nodeStats: z.array(nodeStatDescriptor).max(4).default([]),
  contentLinks: z.array(contentLinkDescriptor).max(16).default([]),
  // Four, the same ceiling as attention and nodeStats. A composer list with more than a couple of
  // entries from one plugin is a picker inside a picker, not a richer integration.
  agentContexts: z.array(agentContextDescriptor).max(4).default([]),
}).prefault({})

export type PluginFrameSurface = z.infer<typeof frameSurface>
export type PluginChromeAction = z.infer<typeof chromeAction>
export type PluginCommandDescriptor = z.infer<typeof commandDescriptor>
export type PluginKeybindingDescriptor = z.infer<typeof keybindingDescriptor>
export type PluginAgentContextDescriptor = z.infer<typeof agentContextDescriptor>

const manifestShape = z.object({
  id: z.string().regex(ID_RE, `plugin id must match ${ID_RE.source}`),
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(64),
  apiVersion: z.string().min(1).max(16),
  node: entry.optional(),
  client: entry.optional(),
  // Loaded-plugin storage is host-opened and host-migrated. The same confinement rule as the code
  // entrypoints keeps its DDL chain inside the installed package.
  migrations: entry.optional(),
  permissions: z.object({
    // Core API scopes, `core.<resource>:<read|write>`. Unvalidated as strings for the same reason the
    // node block's `core` list is: an unknown scope is one this acorn cannot grant, which the bridge
    // handles by denying it (client-core/plugins/frames/scopes.ts), not by rejecting the manifest.
    api: z.array(z.string().min(1).max(64)).max(64).default([]),
    events: z.array(z.string().min(1).max(64).regex(/^[a-z][a-z0-9:._-]*$/i)).max(64).default([]),
    node: nodePermissions.prefault({}),
  }).prefault({}),
  contributions,
})

// Cross-field checks, which is why they are here and not on the fields: every one of them needs
// either `id` or the frame list, and neither is visible from inside a nested schema.
//
// All three are the same idea the rest of the file already applies — THE HOST BINDS EVERY NAMESPACE
// — moved to the one place a manifest can name things outside itself. A descriptor route is the
// parse-time twin of the bridge's runtime confinement (client-core/plugins/frames/scopes.ts): a
// plugin may address its own `/v2/p/<id>/` prefix and nothing else, so it cannot make the host read
// core routes, or another plugin's, on its behalf.
export const pluginManifestSchema = manifestShape.superRefine((manifest, ctx) => {
  const own = `/v2/p/${manifest.id}/`
  const panes = new Set(manifest.contributions.frames.filter((frame) => frame.target === 'pane' || frame.target === 'webview').map((frame) => frame.id))

  const route = (path: string, at: (string | number)[]): void => {
    let confined = false
    try {
      const url = new URL(path, 'https://acorn.invalid')
      confined = path.startsWith('/') && url.origin === 'https://acorn.invalid' && url.pathname.startsWith(own)
    } catch {
      // Report the same confinement error for malformed and escaped paths.
    }
    if (!confined) ctx.addIssue({ code: 'custom', path: at, message: `route must be inside ${own}` })
  }

  const action = (value: PluginChromeAction, at: (string | number)[]): void => {
    // A pane the manifest did not declare is a manifest error, not a runtime surprise — and it cannot
    // name another plugin's pane, because the host only ever registers panes this manifest declared.
    if (value.verb === 'openPane' && !panes.has(value.pane)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'pane'], message: `openPane names '${value.pane}', which this manifest does not declare as a pane` })
    }
    if (value.verb === 'runNodeAction') route(value.path, [...at, 'path'])
    // `openUrl` reaches the real browser. Anything but https is either a downgrade or a scheme handler,
    // and neither is a thing a descriptor gets to choose for the user.
    if (value.verb === 'openUrl' && !value.url.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: [...at, 'url'], message: 'openUrl must be https' })
    }
  }

  const { frames, sources, slots, palette, commands, keybindings, attention, nodeStats, contentLinks, agentContexts } = manifest.contributions
  frames.forEach((frame, i) => {
    const at = ['contributions', 'frames', i] as (string | number)[]
    if (frame.target !== 'webview') {
      if (frame.url !== undefined || frame.urlSource !== undefined || frame.hosts !== undefined) {
        ctx.addIssue({ code: 'custom', path: at, message: 'url, urlSource and hosts are only valid on a webview surface' })
      }
      return
    }
    if ((frame.url === undefined) === (frame.urlSource === undefined)) {
      ctx.addIssue({ code: 'custom', path: at, message: 'a webview must declare exactly one of url or urlSource' })
    }
    if (!frame.hosts?.length) {
      ctx.addIssue({ code: 'custom', path: [...at, 'hosts'], message: 'a webview must declare at least one host' })
    }
    if (frame.urlSource) route(frame.urlSource, [...at, 'urlSource'])
    if (frame.url && frame.hosts?.length && !isAllowedWebviewUrl(frame.url, frame.hosts)) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'url'],
        message: 'webview url must use https (or loopback http) and match a declared host',
      })
    }
  })
  sources.forEach((entry, i) => {
    route(entry.items, ['contributions', 'sources', i, 'items'])
    if (entry.onSelect) action(entry.onSelect, ['contributions', 'sources', i, 'onSelect'])
  })
  slots.forEach((entry, i) => {
    route(entry.data, ['contributions', 'slots', i, 'data'])
    if (entry.onClick) action(entry.onClick, ['contributions', 'slots', i, 'onClick'])
  })
  palette.forEach((entry, i) => action(entry.action, ['contributions', 'palette', i, 'action']))
  commands.forEach((entry, i) => action(entry.action, ['contributions', 'commands', i, 'action']))
  const commandIds = new Set([...commands, ...palette].map((entry) => entry.id))
  const surfaceIds = new Set(frames.map((frame) => frame.id))
  const boundCommands = new Set<string>()
  keybindings.forEach((entry, i) => {
    const at = ['contributions', 'keybindings', i] as (string | number)[]
    if (!commandIds.has(entry.command)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'command'], message: `keybinding names undeclared command '${entry.command}'` })
    }
    if (boundCommands.has(entry.command)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'command'], message: `command '${entry.command}' has more than one keybinding` })
    }
    boundCommands.add(entry.command)
    if (entry.when === 'surface') {
      if (!entry.surface) {
        ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: 'surface is required when a keybinding uses surface scope' })
      } else if (!surfaceIds.has(entry.surface)) {
        ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: `keybinding names undeclared surface '${entry.surface}'` })
      }
    } else if (entry.surface !== undefined) {
      ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: 'surface is only valid with surface scope' })
    }
  })
  attention.forEach((entry, i) => route(entry.items, ['contributions', 'attention', i, 'items']))
  nodeStats.forEach((entry, i) => route(entry.data, ['contributions', 'nodeStats', i, 'data']))
  agentContexts.forEach((entry, i) => {
    route(entry.options, ['contributions', 'agentContexts', i, 'options'])
    route(entry.capture, ['contributions', 'agentContexts', i, 'capture'])
  })
  contentLinks.forEach((entry, i) => {
    if (!panes.has(entry.openPane)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'contentLinks', i, 'openPane'],
        message: `content link names '${entry.openPane}', which this manifest does not declare as a pane`,
      })
    }
    try {
      const compiled = compileContentLinkPattern(entry.match)
      if (!compiled.captures.includes(entry.item)) {
        ctx.addIssue({
          code: 'custom',
          path: ['contributions', 'contentLinks', i, 'item'],
          message: `content link item '${entry.item}' is not captured by its match pattern`,
        })
      }
    } catch {
      // The field refinement already reports the grammar error at `match`.
    }
  })

  // Ids are per-registry on the client, but a plugin that reuses one across its own descriptors is
  // ambiguous about which contribution a query key or a disposal refers to. Cheap to forbid outright.
  const seen = new Set<string>()
  for (const entry of [...manifest.contributions.frames, ...sources, ...slots, ...palette, ...commands, ...attention, ...nodeStats, ...contentLinks, ...agentContexts]) {
    if (seen.has(entry.id)) ctx.addIssue({ code: 'custom', path: ['contributions'], message: `duplicate contribution id '${entry.id}'` })
    seen.add(entry.id)
  }
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>

export const MANIFEST_FILE = 'acorn-plugin.json'

// Never throws. A missing, unreadable, non-JSON or schema-violating manifest is all one outcome —
// "this directory is not a plugin we can run" — and the loader turns that into a skip plus a report.
export function readPluginManifest(dir: string): PluginManifest | null {
  try {
    const parsed = pluginManifestSchema.safeParse(JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// The schema for `acorn-plugin.json`, shared by the Node and clients.
// The private descriptor modules own individual field rules; this module assembles the manifest
// and retains the public wire types used by older roster rows.
import { z } from 'zod'
import { ACORN_BASELINE } from '../baseline.ts'
import { dataSourceDiscoverySchema, dataSourceRegistrationSchema } from '../data/dataSourceContributions.ts'
import { PLUGIN_API_RANGE_RE } from './apiVersion.ts'
import { pluginCliCommandDescriptorSchema } from './cliCommands.ts'
import {
  chromeAction, contextFreeAction, contextMenuDescriptor, emptyStateDescriptor, panelRegion,
  selectedRowAction, slotDescriptor, sourceDescriptor,
} from './manifest/chromeDescriptors.ts'
import {
  actionCommandDescriptor, commandCategory, commandDescriptor, groupCommandDescriptor,
  inputCommandDescriptor, keybindingDescriptor, searchCommandDescriptor, settingCommandDescriptor,
} from './manifest/commandDescriptors.ts'
import {
  agentContextDescriptor, attentionDescriptor, clientRouteDescriptor, contentLinkDescriptor,
  nodeStatDescriptor, refResolverDescriptor, styleDescriptor, themeDescriptor,
} from './manifest/displayDescriptors.ts'
import { extensionDescriptor, extensionPointDescriptor } from './manifest/extensionDescriptors.ts'
import { brandMark, entry, ID_RE, nodePermissions } from './manifest/manifestFields.ts'
import { pluginAgentToolDescriptorSchema, pluginContextSectionDescriptorSchema } from './runtimeContributions.ts'
import { auditActionDescriptor, harnessDescriptor, scheduleDescriptor, taskCheckDescriptor } from './manifest/runtimeDescriptors.ts'
import { documentCompletions, documentRegion, frameSurface, navigationDestination } from './manifest/surfaces.ts'

// A saved start for a managed session: a harness, the provider options it starts on, text for its
// system prompt, and a ceiling on acorn's own tools (docs/managed-agents/custom-agents.md § Custom agents). Data
// only. It names no program, so it needs no grant beyond the owner reading its instructions, and it
// cannot bring a tool server: a server is a program to run, which is what `agentTools` is for.
const customAgentDescriptor = z.object({
  // Namespaced by the host into `<pluginId>:<id>` and copied onto every session started from it.
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(100),
  glyph: z.string().min(1).max(64).optional(),
  description: z.string().min(1).max(500).optional(),
  // A harness id: `claude`, `codex`, another plugin's `<pluginId>:<harnessId>`, or the bare id of a
  // harness this manifest declares, which the host qualifies.
  harness: z.string().min(1).max(130),
  // Provider option id to value, the same table a session default is. A value the harness does not
  // advertise is dropped when the session starts, with a line in the transcript.
  options: z.record(z.string().min(1).max(200), z.string().max(500))
    .refine((value) => Object.keys(value).length <= 20, 'at most 20 options')
    .default({}),
  // Shown in full in the trust prompt, and a changed text asks again.
  instructions: z.string().min(1).max(16_000).optional(),
  maxToolRisk: z.enum(['read', 'write', 'execute']).optional(),
})

// `api` and `events` are enforced by the UI bridge (client-core/host/plugins/frames). `contributions` stays
// loose: a manifest written for a newer acorn should contribute less on an older one rather than fail
// to parse.
//
// The caps are product judgements, not storage limits. Eight is "as many as a plugin has rail sources"
// and four is "a handful"; a package that wants more is describing an app rather than an integration.
const contributionsShape = z.looseObject({
  frames: z.array(frameSurface).max(32).default([]),
  sources: z.array(sourceDescriptor).max(8).default([]),
  slots: z.array(slotDescriptor).max(8).default([]),
  commands: z.array(commandDescriptor).max(32).default([]),
  keybindings: z.array(keybindingDescriptor).max(32).default([]),
  attention: z.array(attentionDescriptor).max(4).default([]),
  nodeStats: z.array(nodeStatDescriptor).max(4).default([]),
  contentLinks: z.array(contentLinkDescriptor).max(16).default([]),
  routes: z.array(clientRouteDescriptor).max(8).default([]),
  agentContexts: z.array(agentContextDescriptor).max(4).default([]),
  refResolvers: z.array(refResolverDescriptor).max(4).default([]),
  themes: z.array(themeDescriptor).max(8).default([]),
  styles: z.array(styleDescriptor).max(8).default([]),
  // A plugin can declare more than eight rail surfaces; keep the total bounded.
  contextMenus: z.array(contextMenuDescriptor).max(32).default([]),
  // Raised from four and eight when the one key grew from rows to five kinds: a plugin that opens a
  // pane, a slot in it, a hook before it acts and an annotation on its rows is describing one
  // integration, not four, and the old caps were sized for rows alone.
  extensionPoints: z.array(extensionPointDescriptor).max(16).default([]),
  extensions: z.array(extensionDescriptor).max(16).default([]),
  dataSources: z.array(dataSourceRegistrationSchema).max(32).optional(),
  dataSourceDiscoveries: z.array(dataSourceDiscoverySchema).max(8).optional(),
  schedules: z.array(scheduleDescriptor).max(4).default([]),
  taskChecks: z.array(taskCheckDescriptor).max(4).default([]),
  // Audit verbs. The ctx twin is `ctx.audit`, and both feeders land in the same registry.
  auditActions: z.array(auditActionDescriptor).max(8).default([]),
  // Managed agent harnesses. The ctx twin is the `agents.harnessRegistry` capability. See
  // docs/managed-agents/harnesses.md § Harnesses.
  harnesses: z.array(harnessDescriptor).max(4).default([]),
  // Custom agents. The ctx twin is the `agents.customAgentRegistry` capability. See
  // docs/managed-agents/custom-agents.md § Custom agents.
  customAgents: z.array(customAgentDescriptor).max(8).default([]),
  // Node-runtime carriers. The host adapts these into the same registries compiled contributions use.
  agentTools: z.array(pluginAgentToolDescriptorSchema).max(16).default([]),
  contextSections: z.array(pluginContextSectionDescriptorSchema).max(8).default([]),
  cliCommands: z.array(pluginCliCommandDescriptorSchema).max(16).default([]),
})

// Every contribution kind a manifest may declare, as a runtime list.
//
// Derived from the schema rather than typed out beside it, so the two cannot drift. Two consumers: the
// forward-compatibility report, which needs to know which of a loose object's keys this build actually
// understands (node-core/server/plugins/manifest.ts), and the contribution-kind table in
// docs/contribution-kinds.md, which a test holds against this list.
export const CONTRIBUTION_KINDS = Object.keys(contributionsShape.shape).sort() as readonly string[]

const contributions = contributionsShape.prefault({})

// The permissions block as a whole, named so the wire projection can be inferred from it. This is what
// the trust dialog renders and the owner consents to. `api` scopes stay unvalidated strings: an unknown
// scope is one this acorn can't grant, which the bridge denies rather than the manifest rejecting.
const manifestPermissions = z.object({
  api: z.array(z.string().min(1).max(64)).max(64).default([]),
  events: z.array(z.string().min(1).max(64).regex(/^[a-z][a-z0-9:._-]*$/i)).max(64).default([]),
  node: nodePermissions.prefault({}),
})

// What a plugin announces on its own `plugin:<id>:<verb>` channel that *other* plugins may subscribe
// to (docs/plugins.md § Hearing another plugin). A verb works undeclared for the
// plugin's own frames; declaring it is what lets another manifest name it in `permissions.events`, and
// what gives the settings page a line to render. The description is the author's own words and is
// shown as text, never as trust-prompt copy.
export const pluginEmitSchema = z.object({
  verb: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, 'a verb is lowercase, starts with a letter, and holds no colon'),
  description: z.string().min(1).max(200),
})
export type PluginEmit = z.infer<typeof pluginEmitSchema>

const manifestShape = z.object({
  // The JSON Schema an editor validates this file against (./pluginSchema.test.ts generates it, and
  // create-acorn-plugin writes the key). Declared so it is a known key rather than one the
  // forward-compatibility report has to name on every scaffolded plugin. Nothing reads it at load time.
  $schema: z.string().max(200).optional(),
  id: z.string().regex(ID_RE, `plugin id must match ${ID_RE.source}`),
  name: z.string().min(1).max(120),
  // The plugin's own logo, registered by the host under `brand:<id>` so every contribution in this
  // manifest can name it as a `glyph`. Top level beside `name` because it identifies the package,
  // where `glyph` stays per-contribution.
  icon: brandMark.optional(),
  // The plural feeder, for a package that hosts several brands. Keys become the suffix in
  // `brand:<pluginId>/<key>`; the host stamps the prefix, so the key namespace is private to the plugin.
  icons: z.record(z.string().min(1).max(32).regex(/^[a-z0-9][a-z0-9-]*$/), brandMark)
    .refine((marks) => Object.keys(marks).length <= 16, 'too many icons')
    .optional(),
  version: z.string().min(1).max(64),
  baseline: z.literal(ACORN_BASELINE),
  emits: z.array(pluginEmitSchema).max(32).default([]),
  // A range over plugin API majors, not a single number: '3', '2 || 3', '2-4'. Held to the shape
  // here so a typo fails the manifest with a reason instead of loading nowhere (./apiVersion.ts).
  apiVersion: z.string().min(1).max(16).regex(PLUGIN_API_RANGE_RE, 'apiVersion must be a major or a range of majors, such as "3" or "2 || 3"'),
  // What this package needs from the rest of the node before it can work.
  //
  // Without it a plugin that consumes another plugin's capability has no way to say so, and the failure
  // is a missing capability at runtime, in whichever route happened to reach for it first. The owner
  // reads that as "this plugin is broken". With it the loader can say "it needs the agents plugin,
  // which is not installed", before anything runs.
  //
  // `version` is a range over the required plugin's major, the same grammar and the same matcher as
  // `apiVersion` above. A plugin's version is its own, so majors are all a dependant can reason about
  // without the two packages sharing a release process.
  requires: z.object({
    plugins: z.array(z.object({
      id: z.string().regex(ID_RE, `plugin id must match ${ID_RE.source}`),
      version: z.string().min(1).max(16).regex(PLUGIN_API_RANGE_RE, 'version must be a major or a range of majors, such as "3" or "2 || 3"').optional(),
    })).max(16).default([]),
  }).prefault({}),
  node: entry.optional(),
  client: entry.optional(),
  // Loaded-plugin storage is host-opened and host-migrated. The same confinement rule as the code
  // entrypoints keeps its DDL chain inside the installed package.
  migrations: entry.optional(),
  permissions: manifestPermissions.prefault({}),
  contributions,
})
// `pluginManifestSchema` in node-core/server/plugins/manifest.ts wraps this with the cross-field
// refinements (route confinement, surface reachability, id uniqueness), which need `id` and the frame
// list and so can't live on the fields.
export const pluginManifestShape = manifestShape
export type PluginManifestShape = z.infer<typeof manifestShape>

// The permissions block on its own, because the desktop parses it a second time. It arrives there
// over IPC and is written into the trust store, where it used to be accepted by `z.custom<...>()`, a
// cast wearing a Zod costume that accepts anything. That's the one place where a wrong shape doesn't
// crash: it shows the owner a security disclosure and records their consent against it.
export const pluginPermissionsSchema = manifestPermissions

// ── Surface classification ────────────────────────────────────────────────────────────────────────
//
// Both sides of the wire ask which of the three kinds a declared frame is, and they must agree: the
// node checks that an `openPane` names a pane the manifest declared, and the client builds the runtime
// allowlist for the same verb.
//
// `scope !== 'project'` rather than `scope === 'task'`: the client reads these off a roster row, where
// the field is absent whenever the sending node predates it. Only the negative spelling is correct
// before defaults are applied.
export const isTaskPaneSurface = (frame: { target: string; scope?: string }): boolean =>
  frame.target === 'webview' || (frame.target === 'pane' && frame.scope !== 'project')

/** The detail half of a rail source's browse: addressed by URL, never a slot in a task's layout. */
export const isProjectPaneSurface = (frame: { target: string; scope?: string }): boolean =>
  frame.target === 'pane' && frame.scope === 'project'

/** A full-screen picker the host places. Not a pane: it belongs to no task's layout. */
export const isOverlaySurface = (frame: { target: string }): boolean => frame.target === 'overlay'

/** Does this pane hold a rectangle of the plugin's own pixels? A `frame` region is the only thing that
 *  does, which makes it the question behind the key claims and `surfaceAction`. */
export const hasFrameRegion = (frame: { regions?: Record<string, unknown> }): boolean =>
  Object.values(frame.regions ?? {}).some((region) => region === 'frame')

/** Does this pane draw any region from a tree the plugin's own bundle emits? Same bytes as a frame and
 *  the same trust gate; what differs is that the host mounts its own components for what arrives. */
export const hasRemoteRegion = (frame: { regions?: Record<string, unknown> }): boolean =>
  Object.values(frame.regions ?? {}).some(
    (region) => typeof region === 'object' && region !== null && (region as { kind?: unknown }).kind === 'remote',
  )

/** Does this pane have a host-drawn editor in it? */
export const hasDocumentRegion = (frame: { regions?: Record<string, unknown> }): boolean =>
  Object.values(frame.regions ?? {}).some(
    (region) => typeof region === 'object' && region !== null && (region as { kind?: unknown }).kind === 'document',
  )

/** A replacement for a designated core surface. Not a pane and not an overlay: it has no layout key,
 *  no click site of its own and no verb that opens it. The user's arbitration is the only thing that
 *  ever puts one on screen (@acorn/protocol/extensionPoints.ts). */
export const isCoreSlotSurface = (frame: { target: string }): boolean => frame.target === 'coreSlot'

// ── The wire projection ───────────────────────────────────────────────────────────────────────────
//
// What a plugin's manifest declared, as it reaches a device inside a roster row. The node enforces
// understood grants; the loose projection below keeps an older client safe around newer fields.
//
// `z.infer` gives the shape after a parse, with defaults filled. A roster row isn't that: it's bytes
// some node sent, possibly running an older copy of this schema. So two loosenings apply, and the test
// for each is "could a node this shell still talks to have produced a row without it":
//
//   optional  where the field was added to a shape that already shipped, such as `scope` and
//     `claimsKeys` on `frameSurface`. A field present since its shape was introduced stays required.
//   wider  where the value is re-checked on arrival anyway. `languageId` is a plain string here,
//     because believing the narrow type of a value a node asserted is the mistake this file exists
//     to stop making.
//
// Getting this wrong is silent both ways: too strict and the client dereferences something an older
// node never sent, too loose and every reader grows a `??` it doesn't need.
export type NodePermissions = z.infer<typeof nodePermissions>
export type NodePluginPermissions = z.infer<typeof manifestPermissions>

export type PluginDocumentCompletions = Omit<z.infer<typeof documentCompletions>, 'triggerCharacters'> & {
  triggerCharacters?: string[]
}
export type PluginDocumentRegion = Omit<z.infer<typeof documentRegion>, 'languageId' | 'completions'> & {
  languageId: string
  completions?: PluginDocumentCompletions
}
/** What one region holds. The two object kinds carry a `kind` tag so the union stays discriminated;
 *  `'frame'` is a bare string because it has nothing to say beyond its own name. */
export type PluginPaneRegion =
  | 'frame'
  | { kind: 'remote'; entry: string }
  | ({ kind: 'document' } & PluginDocumentRegion)
export type PluginFrameSurface = Omit<z.infer<typeof frameSurface>, 'scope' | 'claimsKeys' | 'destinations' | 'layout' | 'regions' | 'coreSlot' | 'category' | 'settingsScope'> & {
  scope?: 'task' | 'project'
  // Wider than the parse: a newer node can know a group or scope this build does not, and the client
  // places the page by its own lists (client-core/host/frames/register.ts).
  category?: string
  settingsScope?: string
  claimsKeys?: string[]
  destinations?: z.infer<typeof navigationDestination>[]
  // Wider than the parse on both: a roster row is bytes a node sent, and the client re-checks the
  // layout name, the region set and every route before it registers anything.
  layout?: string
  regions?: Record<string, PluginPaneRegion>
  coreSlot?: string
}
export type PluginChromeAction = z.infer<typeof chromeAction>
// The verbs that need nothing from their click site. `createTask` depends on a selected rail row and
// `navigate` on a routed project, and a command registry row has neither in scope.
export type PluginCommandAction = z.infer<typeof contextFreeAction>
// The same verbs plus `navigate`, which a search's `onSelect` may name because a picked row is a
// selected row and its project came from the scope the search declared.
export type PluginCommandSelectAction = z.infer<typeof selectedRowAction>
export type PluginSourceEmptyState = z.infer<typeof emptyStateDescriptor>
// `views` and `fieldRole` are wider than the parse. Both are filters: a newer node naming a view kind or
// field role this build can't render must narrow what's offered, never fail to register.
export type PluginPanelRegion = Omit<z.infer<typeof panelRegion>, 'views' | 'fieldRole'> & {
  views?: string[]
  fieldRole?: string
}
export type PluginSourceDescriptor = Omit<z.infer<typeof sourceDescriptor>, 'panels'> & {
  panels?: PluginPanelRegion
}
export type PluginSlotDescriptor = z.infer<typeof slotDescriptor>
export type PluginCommandCategory = z.infer<typeof commandCategory>
// `kind` is optional on the action member and required nowhere else, which is the rule this file's
// header states: the field was added to a shape that had already shipped, so a roster row from a node
// running the previous parser carries no `kind` at all and means the action it always meant. The other
// four members can only have come from a node that has this schema.
export type PluginActionCommandDescriptor = Omit<z.infer<typeof actionCommandDescriptor>, 'kind'> & { kind?: 'action' }
export type PluginGroupCommandDescriptor = z.infer<typeof groupCommandDescriptor>
export type PluginSearchCommandDescriptor = z.infer<typeof searchCommandDescriptor>
export type PluginInputCommandDescriptor = z.infer<typeof inputCommandDescriptor>
export type PluginSettingCommandDescriptor = z.infer<typeof settingCommandDescriptor>
/** A newer node may send a kind this build has no frame for, so every reader switches on `kind` and
 *  skips what it does not know rather than coercing it into an action. */
export type PluginCommandDescriptor =
  | PluginActionCommandDescriptor
  | PluginGroupCommandDescriptor
  | PluginSearchCommandDescriptor
  | PluginInputCommandDescriptor
  | PluginSettingCommandDescriptor
export type PluginKeybindingDescriptor = z.infer<typeof keybindingDescriptor>
export type PluginAttentionDescriptor = z.infer<typeof attentionDescriptor>
export type PluginNodeStatDescriptor = z.infer<typeof nodeStatDescriptor>
export type PluginContentLinkDescriptor = z.infer<typeof contentLinkDescriptor>
export type PluginClientRouteDescriptor = z.infer<typeof clientRouteDescriptor>
export type PluginAgentContextDescriptor = z.infer<typeof agentContextDescriptor>
export type PluginRefResolverDescriptor = z.infer<typeof refResolverDescriptor>
// `tokens` is wider than the parse: the client re-checks every name and value before writing one into
// a stylesheet.
export type PluginThemeDescriptor = Omit<z.infer<typeof themeDescriptor>, 'tokens'> & {
  tokens: Record<string, string>
}
export type PluginStyleDescriptor = z.infer<typeof styleDescriptor>
// `location` is wider than the parse: the client re-checks it and every `when` key against its own
// copy of the vocabulary before registering anything.
export type PluginContextMenuDescriptor = Omit<z.infer<typeof contextMenuDescriptor>, 'location'> & {
  location: string
}
// `kind` and `location` are wider than the parse, for the reason the context-menu descriptor gives
// above: the client re-checks both against its own copy of the vocabulary before registering anything,
// and a newer node's kind must not be coerced into one this shell has a host for.
export type PluginExtensionPointDescriptor =
  & Omit<z.infer<typeof extensionPointDescriptor>, 'kind' | 'location' | 'panels' | 'key' | 'mode' | 'allows' | 'order' | 'max' | 'timeoutMs' | 'onTimeout' | 'collect'>
  & {
    kind: string
    location?: string
    panels?: PluginPanelRegion
    key?: Record<string, string>
    mode?: string
    allows?: string[]
    order?: string
    // Optional for the reason the projection's header gives: these gained defaults when the kinds
    // landed, and an older node's roster row carries none of them.
    max?: number
    timeoutMs?: number
    onTimeout?: 'allow' | 'deny'
    collect?: boolean
  }
// `mode` is wider than the parse, for the same reason the point's is; `priority` is optional, for the
// reason the defaulted fields above are.
export type PluginExtensionDescriptor = Omit<z.infer<typeof extensionDescriptor>, 'mode' | 'priority'> & {
  mode?: string
  priority?: number
}
export type PluginScheduleDescriptor = z.infer<typeof scheduleDescriptor>
export type PluginTaskCheckDescriptor = z.infer<typeof taskCheckDescriptor>
export type PluginAuditActionDescriptor = z.infer<typeof auditActionDescriptor>
export type PluginHarnessDescriptor = z.infer<typeof harnessDescriptor>
export type PluginCustomAgentDescriptor = z.infer<typeof customAgentDescriptor>
export type { PluginAgentToolDescriptor, PluginContextSectionDescriptor } from './runtimeContributions.ts'
export type { PluginCliCommandDescriptor } from './cliCommands.ts'

// Loose on the wire as well as in the schema: a client that doesn't know a future sibling key should
// contribute less rather than fail to parse. Every list but `frames` is optional because an older node's
// roster row won't carry it, and every reader uses `?? []`.
export type PluginContributions = {
  frames: PluginFrameSurface[]
  sources?: PluginSourceDescriptor[]
  slots?: PluginSlotDescriptor[]
  commands?: PluginCommandDescriptor[]
  keybindings?: PluginKeybindingDescriptor[]
  attention?: PluginAttentionDescriptor[]
  nodeStats?: PluginNodeStatDescriptor[]
  contentLinks?: PluginContentLinkDescriptor[]
  agentContexts?: PluginAgentContextDescriptor[]
  refResolvers?: PluginRefResolverDescriptor[]
  routes?: PluginClientRouteDescriptor[]
  themes?: PluginThemeDescriptor[]
  styles?: PluginStyleDescriptor[]
  contextMenus?: PluginContextMenuDescriptor[]
  extensionPoints?: PluginExtensionPointDescriptor[]
  extensions?: PluginExtensionDescriptor[]
  dataSources?: import('../data/dataSources').DataSourceRegistration[]
  dataSourceDiscoveries?: import('../data/dataSources').DataSourceDiscovery[]
  schedules?: PluginScheduleDescriptor[]
  taskChecks?: PluginTaskCheckDescriptor[]
  auditActions?: PluginAuditActionDescriptor[]
  harnesses?: PluginHarnessDescriptor[]
  customAgents?: PluginCustomAgentDescriptor[]
  agentTools?: import('./runtimeContributions.ts').PluginAgentToolDescriptor[]
  contextSections?: import('./runtimeContributions.ts').PluginContextSectionDescriptor[]
  cliCommands?: import('./cliCommands.ts').PluginCliCommandDescriptor[]
} & Record<string, unknown>

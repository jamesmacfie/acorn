// The schema for `acorn-plugin.json`, the manifest a loaded plugin ships.
// See docs/plugins.md § Loaded plugins for what a manifest is and who reads it.
//
// It lives in protocol because the node and the client both need it and neither can import the other.
// node-core/main/pluginManifest.ts adds the cross-field rules and the reader. The wire projections at
// the bottom are `z.infer` of these schemas, loosened where an older node's parser had fewer defaults.
import { z } from 'zod'
import { collectionParamsSchema, collectionSchema, COLLECTION_FIELD_ROLES, PANEL_VIEW_KINDS } from './collections.ts'
import { compileContentLinkPattern, CONTENT_LINK_PATTERN_MAX_LENGTH } from './contentLinkPattern.ts'
import { CONTEXT_MENU_LOCATIONS, unknownWhenFacts } from './contextMenus.ts'
import { CORE_EXCLUSIVE_SLOTS, EXTENSION_POINT_LOCATIONS, parseExtensionPointRef } from './extensionPoints.ts'
import { isNormalizedChord, isPluginKeyClaim, isPluginShortcutChord, isReservedPluginKeyClaim } from './keybindings.ts'
import { LANGUAGE_IDS } from './languageIds.ts'
import { cadenceSchema } from './schedules.ts'
import { isThemeColorValue, THEME_COLOR_VALUE_MAX, THEME_PALETTE_TOKENS } from './themeTokens.ts'
import { normalizeWebviewHost, WEBVIEW_HOST_MAX_COUNT, WEBVIEW_HOST_MAX_LENGTH } from './webview.ts'

// This id becomes the plugin's route namespace and `<dataRoot>/plugins/<id>.sqlite`. An architecture
// rule keeps the prefix itself out of this package; node-core/main/pluginManifest.ts confines it.
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/

// Node-half permissions: shapes `ctx` (main/pluginPermissions.ts) and is shown to the user, but is not
// enforced. Surfaces that render this block must keep saying "declared", not "enforced".
// See docs/security.md.
const nodePermissions = z.object({
  // pluginPermissions.ts validates these tokens. An unknown one means a facet this build doesn't
  // have, so it's skipped rather than treated as a bad manifest.
  core: z.array(z.string().min(1)).max(64).default([]),
  capabilities: z.array(z.string().min(1)).max(64).default([]),
  // Use-scoped credential access through ctx.core.secrets.
  secrets: z.boolean().default(false),
  // The process broker (ctx.core.proc).
  exec: z.boolean().default(false),
  // Intended egress hosts. Disclosure only, until the credential broker lands.
  net: z.array(z.string().min(1)).max(64).default([]),
})


// The plugin's logo, as one SVG path's `d` attribute rather than an SVG document, so the regex below is
// the whole check. See docs/ui-design.md § Icons.
const PATH_D_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\s+-]+$/

const brandMark = z.object({
  // Authored in a 24x24 box, like simple-icons. The renderer hardcodes that viewBox.
  d: z.string().min(1).max(4_096).regex(PATH_D_RE, 'icon must be a single SVG path `d` string'),
})

// Relative only. Rejecting `/` and `..` here keeps hostile paths away from the loader's confinement
// check.
const entry = z.string().min(1).max(256).refine(
  (value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'),
  'entrypoint must be a relative path inside the plugin directory',
)

// A rectangle the plugin's client bundle draws, hosted by the shell in a sandboxed frame. Surfaces are
// declared here and nowhere else, because the ids double as persisted layout keys and chord targets.
// See docs/plugins.md § Loaded plugins: the client half.
const webviewHost = z.string().min(1).max(WEBVIEW_HOST_MAX_LENGTH).superRefine((value, ctx) => {
  try {
    normalizeWebviewHost(value)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
  }
})

// A path the host will GET or POST for this plugin. Bounded here, confined in the manifest-level
// refinement where `id` is visible.
const pluginRoute = z.string().min(1).max(256)

// ── Host-owned document surfaces ──────────────────────────────────────────────────────────────────
//
// The host owns the editor and the plugin supplies the document: an identity, a read route, an optional
// write route, and a language id. See docs/third-party/monaco.md for why the sandbox cannot serve one,
// and for the bar a further host-owned region has to clear.

// LSP-shaped request/response routes: position and text in, standard items out, never "run my code
// inside the editor". See docs/third-party/monaco.md.
const documentCompletions = z.object({
  route: pluginRoute,
  // What re-opens the popup mid-word, beyond the editor's own identifier rule. Punctuation, not a
  // grammar.
  triggerCharacters: z.array(z.string().min(1).max(2)).max(8).default([]),
})

const documentRegion = z.object({
  // From the published vocabulary, so an unknown id is a parse error rather than a document that
  // quietly renders as plain text. LSP's spellings (@acorn/protocol/languageIds.ts).
  languageId: z.enum(LANGUAGE_IDS).default('plaintext'),
  // GET -> { text }. The host substitutes `:taskId` and `:projectId` from the pane's scope. No other
  // parameter, because no other one is the host's to know.
  read: pluginRoute,
  // PUT { text }. Absent means read-only, which is a real mode: a generated migration or a rendered
  // template in a highlighted viewer wants exactly that.
  write: pluginRoute.optional(),
  completions: documentCompletions.optional(),
})

// Which arrangement of regions the host draws for this pane, and what goes in each. Region-addressed
// from the start because it is the one-way door, and orientation lives in the template name rather than
// in a field. See docs/plugins.md § Loaded plugins: the client half.
const paneLayout = z.object({
  template: z.enum(['document', 'document-over-frame']),
  document: documentRegion,
})

const frameSurface = z.object({
  // Which registry this lands in. The shell renders them all the same way; the surrounding chrome it
  // supplies is what differs.
  //
  // `overlay` is the full-screen picker slot: the host places the rectangle and the frame draws its
  // contents. It has no click site, so `openOverlay` is the only way to open one. `coreSlot` is drawn
  // where one of core's own surfaces normally is; registering one seizes nothing, because the user
  // picks the provider in settings. See docs/plugins.md § Replacing a core surface.
  target: z.enum(['pane', 'refPanel', 'settings', 'importer', 'webview', 'overlay', 'coreSlot']),
  // Task or project, and `pane` only. `task` is the default, so every manifest written before this
  // field behaves the same. A property rather than a fifth `target`, because `target` picks the
  // registry and `scope` picks which of two things a pane is. See docs/panes.md § Pane scope.
  scope: z.enum(['task', 'project']).default('task'),
  // Not namespaced by us: it becomes a persisted layout key the moment a user opens the pane, so
  // prefixing it later would break stored layouts (registries/plugin.ts).
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  // A Lucide name, resolved client-side; an unmatched name renders as-is.
  glyph: z.string().min(1).max(64).default('puzzle'),
  order: z.number().int().min(0).max(100_000).default(500),
  // Lets a future mobile shell skip a desktop-shaped pane instead of rendering it unusably
  // (docs/future/remote.md).
  formFactor: z.array(z.enum(['desktop', 'mobile'])).min(1).max(2).default(['desktop']),
  // `refPanel` only. The client adapter checks it against the plugin id: a panel may only name its
  // own provider.
  providerId: z.string().min(1).max(64).optional(),
  // `settings` only.
  group: z.enum(['general', 'workspace']).optional(),
  // `coreSlot` only, and required there. An unknown slot is a parse error.
  coreSlot: z.enum(CORE_EXCLUSIVE_SLOTS).optional(),
  // `webview` only. The declared hosts are the grant the device records and Electron enforces across
  // redirects.
  url: z.string().min(1).max(2_048).optional(),
  urlSource: z.string().min(1).max(256).optional(),
  hosts: z.array(webviewHost).min(1).max(WEBVIEW_HOST_MAX_COUNT).optional(),
  // `pane` only. Absent means a plain frame fills the pane. Present, the host draws some or all of
  // the rectangle from the regions below.
  layout: paneLayout.optional(),
  // Chords the frame may keep instead of forwarding to the shell. Runtime code may narrow this list,
  // never widen it; declaring the upper bound makes the capture visible before code runs.
  claimsKeys: z.array(z.string().min(1).max(64).superRefine((value, ctx) => {
    if (isReservedPluginKeyClaim(value)) {
      ctx.addIssue({ code: 'custom', message: `${value} is reserved by acorn and cannot be claimed` })
    } else if (!isPluginKeyClaim(value)) {
      ctx.addIssue({ code: 'custom', message: 'claimed keys must be canonical chords with meta, ctrl, or alt' })
    }
  })).max(32).default([]),
})

// ── Declarative chrome ────────────────────────────────────────────────────────────────────────────
//
// Everything below is static data or a path into the plugin's own namespace; the host draws the pixels
// from a route on the plugin's always-running node half. The confinement check lives in the
// manifest-level refinement, because it needs `id`.
// See docs/plugins.md § Descriptors for chrome, frames for rectangles.

// The closed verb set the host executes for a descriptor. `invoke`, an RPC into the plugin's frame,
// isn't here: it needs a headless frame lifecycle the shell doesn't have.

const chromeAction = z.discriminatedUnion('verb', [
  // A pane the same manifest declares under `frames`, checked below. The clicked row's id rides along
  // as a pane intent (client-core/registries/clientEvents.ts).
  z.object({ verb: z.literal('openPane'), pane: z.string().min(1).max(64) }),
  // A project-scoped pane the same manifest declares, reached by navigating to the route declared for
  // it. Separate from `openPane` because `openPane` mutates a task's persisted layout and this changes
  // the URL, which also keeps `openPane`'s "open a task first" refusal honest.
  z.object({ verb: z.literal('navigate'), surface: z.string().min(1).max(64) }),
  z.object({ verb: z.literal('runNodeAction'), path: pluginRoute }),
  // Host-owned promotion. The selected rail row carries the seed; the verb carries no plugin
  // callbacks, so it survives the descriptor boundary.
  z.object({ verb: z.literal('createTask') }),
  // https only, opened in the real browser rather than in-app (docs/electron.md § navigation policy).
  z.object({ verb: z.literal('openUrl'), url: z.string().url() }),
  // An `overlay` surface the same manifest declares, checked below. It's in both unions because an
  // overlay covers the window and belongs to no task's layout, so it needs nothing from its click
  // site.
  z.object({ verb: z.literal('openOverlay'), overlay: z.string().min(1).max(64) }),
  // A composed pane the same manifest declares, checked below. The only verb whose effect lands inside a
  // plugin rather than on the shell. It exists for a chord the plugin can't receive: in a
  // `document-over-frame` pane, Cmd+Enter is pressed in the host's editor where the frame has no
  // keyboard. Naming the surface rather than deriving it from the keybinding keeps the command
  // palette-usable.
  z.object({ verb: z.literal('surfaceAction'), surface: z.string().min(1).max(64) }),
])

// Seconds. A fallback for data that changes with no node-side trigger; the primary freshness path is
// `ctx.events.status()`. Floored so a descriptor can't busy-loop against a remote node.
const refresh = z.number().int().min(30).max(86_400).optional()

// `createTask` needs a selected rail row and `navigate` a routed project, and a command registry row
// has neither in scope.
const contextFreeAction = z.discriminatedUnion('verb', [
  z.object({ verb: z.literal('openPane'), pane: z.string().min(1).max(64) }),
  z.object({ verb: z.literal('runNodeAction'), path: pluginRoute }),
  z.object({ verb: z.literal('openUrl'), url: z.string().url() }),
  z.object({ verb: z.literal('openOverlay'), overlay: z.string().min(1).max(64) }),
  z.object({ verb: z.literal('surfaceAction'), surface: z.string().min(1).max(64) }),
])

// What an empty rail says, and where it can send someone. One action, no markup, bounded message: this
// is the field that invites a source to grow an onboarding flow. See docs/plugins.md.
const emptyStateDescriptor = z.object({
  message: z.string().min(1).max(160),
  action: contextFreeAction.optional(),
  // Absent means the message renders alone, which is legitimate: linear's empty state points at a
  // settings page no verb in this union can reach.
  actionLabel: z.string().min(1).max(40).optional(),
})

// ── A reserved panel region ───────────────────────────────────────────────────────────────────────
//
// A plugin declares that part of one of its surfaces is a dashboard, and what a person may compose
// there. The host draws the region; the plugin's layout only reserves it. Constraints are enforced
// twice: the panel editor doesn't offer a disallowed option, and the host re-checks at render time
// because a manifest-derived roster row is untrusted wire.
// See docs/dashboards.md § Placements and docs/plugins.md § Cooperative extension points.
const panelRegion = z.object({
  // Which collections a panel here may be composed over. Absent means this plugin's own; present, it's
  // an explicit list of `<pluginId>:<collectionId>`. Not validated against a registry, so a reference
  // to a collection that isn't installed matches nothing.
  collections: z.array(z.string().min(1).max(130)).max(16).optional(),
  // Or, instead of a list, "any collection carrying a field with this role". `status` admits every
  // provider that declares a status-role field, including ones installed after this manifest.
  fieldRole: z.enum(COLLECTION_FIELD_ROLES).optional(),
  // Which views may be composed here. Absent means all of them.
  views: z.array(z.enum(PANEL_VIEW_KINDS)).min(1).max(PANEL_VIEW_KINDS.length).optional(),
  // How many panels fit. A region is a corner of somebody else's surface, so the owner sets a ceiling.
  max: z.number().int().min(1).max(12).default(4),
}).superRefine((region, ctx) => {
  // A list and a role requirement answer the same question two ways, so honouring both would mean
  // inventing an and/or the declaration doesn't state.
  if (region.collections && region.fieldRole) {
    ctx.addIssue({ code: 'custom', path: ['fieldRole'], message: 'a panel region names collections or a fieldRole, never both' })
  }
})

const sourceDescriptor = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  glyph: z.string().min(1).max(64).default('puzzle'),
  // Required, like SourceContribution.order. Rail position is declared, never derived from plugin
  // load order (registries/sources.ts).
  order: z.number().int().min(0).max(100_000),
  // Optional gate on a connected integration, same as a first-party source.
  providerId: z.string().min(1).max(64).optional(),
  // GET → { items: PluginRailItem[] }
  items: pluginRoute,
  onSelect: chromeAction.optional(),
  // Shown when the route answered with no items, not when it failed. An unreachable node has its own
  // banner, and "nothing is assigned to you" after a timeout is a lie told on the plugin's behalf.
  emptyState: emptyStateDescriptor.optional(),
  // A dashboard region beside this source's rail list, composed by the user under the constraints above.
  // Mutually exclusive with a `navigate` onSelect, checked in node-core/main/pluginManifest.ts: the
  // detail half of a master/detail browse occupies the same rectangle.
  panels: panelRegion.optional(),
  refresh,
})

const slotDescriptor = z.object({
  id: z.string().min(1).max(64),
  // Enumerated host slots, so an unknown one is a parse error rather than a contribution that never
  // appears. Short, because a slot opened is hard to close. docs/plugins.md § Descriptors for chrome,
  // frames for rectangles has the table, including every slot that was refused and why.
  slot: z.enum(['footer', 'topbar']),
  icon: z.string().min(1).max(64).optional(),
  // GET → PluginSlotBadge | null, where null hides the badge.
  data: pluginRoute,
  onClick: contextFreeAction.optional(),
  refresh,
})

// A row on a host-drawn context menu (@acorn/protocol/contextMenus.ts holds the location vocabulary and
// the facts a `when` may name). Takes the narrow `contextFreeAction` union: the thing under the cursor
// is a core resource, and the two missing verbs both need something only a rail source has.
// See docs/plugins.md § Context menus.
const contextMenuDescriptor = z.object({
  id: z.string().min(1).max(64),
  location: z.enum(CONTEXT_MENU_LOCATIONS),
  label: z.string().min(1).max(60),
  // A Lucide name or a `brand:` mark, resolved client-side, exactly as a source's `glyph` is.
  icon: z.string().min(1).max(64).optional(),
  order: z.number().int().min(0).max(100_000).default(500),
  // All-must-equal over the location's own facts. A value is a literal, not a pattern.
  when: z.record(z.string().min(1).max(32), z.union([z.string().max(64), z.boolean()])).optional(),
  action: contextFreeAction,
}).superRefine((descriptor, ctx) => {
  // A `when` naming a fact the host never supplies can never match, which is the "installs and does
  // nothing" failure that's worse than a parse error because it looks like it worked.
  for (const fact of unknownWhenFacts(descriptor.location, descriptor.when ?? {})) {
    ctx.addIssue({ code: 'custom', path: ['when', fact], message: `'${descriptor.location}' has no fact named '${fact}'` })
  }
})

// ── Cooperative cross-plugin extension ────────────────────────────────────────────────────────────
//
// A declares the point it hosts, B declares the contribution, and the host fetches B's items from B's
// own node route and draws them inside the strip A's layout reserved. What crosses is a descriptor plus
// a verb from the closed set: never a component, never a callback, never code.
// See docs/plugins.md § Cooperative extension points and @acorn/protocol/extensionPoints.ts.

const extensionPointDescriptor = z.object({
  // Namespaced by the host into `<pluginId>:<id>`, the only name anyone else may use.
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'extension point id must be lower-case alphanumeric with dashes'),
  // What the owner is opening, in the owner's words. Shown at trust time to both sides.
  label: z.string().min(1).max(80),
  location: z.enum(EXTENSION_POINT_LOCATIONS),
  // A surface this manifest declares, checked below. A point floating free of a surface would have
  // nowhere to draw.
  surface: z.string().min(1).max(64),
  // `pane.aside` only, checked in node-core/main/pluginManifest.ts. The aside's contributor is the
  // user rather than another plugin, so it needs composition constraints rather than a route to read.
  // Absent means the defaults: this plugin's own collections, every view, four panels.
  panels: panelRegion.optional(),
})

const extensionDescriptor = z.object({
  id: z.string().min(1).max(64),
  // `<ownerPluginId>:<pointId>`. Naming the owner out loud is the disclosure: an owner reading this
  // manifest at install time sees which package this one reaches into.
  point: z.string().min(1).max(130),
  // The group heading the host draws above these rows. The host stamps the plugin id beside it, so
  // this label can't pass the items off as somebody else's.
  label: z.string().min(1).max(80),
  order: z.number().int().min(0).max(100_000).default(500),
  // GET → PluginExtensionItems, on this plugin's own namespace (confined below).
  items: pluginRoute,
  // Declared once here rather than per item, so the node can check it against this plugin's declared
  // surfaces at parse time. Narrow union, because the click site is inside another plugin's pane.
  onSelect: contextFreeAction.optional(),
  refresh,
}).superRefine((descriptor, ctx) => {
  // A `point` that isn't `<owner>:<point>` can never resolve: installs and does nothing, which looks
  // like it worked.
  if (!parseExtensionPointRef(descriptor.point)) {
    ctx.addIssue({ code: 'custom', path: ['point'], message: `'${descriptor.point}' is not an extension point reference — use '<pluginId>:<pointId>'` })
  }
})

const paletteDescriptor = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  action: chromeAction,
})

const commandCategory = z.enum(['action', 'navigation', 'pane', 'task', 'terminal', 'workspace'])

const commandDescriptor = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  category: commandCategory.default('action'),
  palette: z.boolean().default(true),
  action: contextFreeAction,
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
  // Singular and plural, so a card reads "1 card stuck" rather than "1 cards stuck".
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

// A renderer URL the host matches for this plugin, handing the matched value to the surface the entry
// names. Confined to a host-minted prefix, one per plugin id, checked below, so a manifest can't claim
// core's `/p/:projectId` and take over project navigation. `item` is required, because a route on this
// tier exists to address something inside a surface rather than to decide whether it appears.
const clientRouteDescriptor = z.object({
  id: z.string().min(1).max(64),
  // Confined below, because the check needs `id`.
  path: z.string().min(1).max(256),
  // A `scope: 'project'` pane this same manifest declares, following the precedent
  // `contentLinks.openPane` and `chromeAction.openPane` set.
  surface: z.string().min(1).max(64),
  // A `:param` of `path`, and never `projectId`: that one is core's, and the host has already bound it.
  item: z.string().min(1).max(32),
  // Registration order on the Router, so a static path can be declared ahead of a parameter path that
  // would otherwise swallow it.
  order: z.number().int().min(0).max(100_000).default(500),
})

const contentLinkDescriptor = z.object({
  id: z.string().min(1).max(64),
  match: contentLinkPattern,
  // A task-scoped pane this manifest declares, checked below. Optional, because the host can instead
  // open the plugin's reference panel for the matched item, which needs no task and no pane. Which of
  // the two a click gets is the clicking surface's call, not the manifest's.
  // See docs/plugins.md § Loaded plugins: the client half.
  openPane: z.string().min(1).max(64).optional(),
  item: z.string().min(1).max(32),
})

// An entry in the agent composer's "add Acorn context" list, served by two routes on the plugin's own
// node half (@acorn/protocol/agentContext.ts holds the response schemas).
//
// `revision?()` gets no manifest form: it's a synchronous number the composer reads while assembling
// its cache key, and a descriptor answers across a fetch. The invalidation ping the rest of the chrome
// rides covers the same freshness.
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

// One batch-enrichment route, so a surface holding identifiers of this plugin's items can display them
// without importing this plugin. The host POSTs `{ identifiers }` and parses the answer against
// @acorn/protocol/refResolvers.ts. There's no single-identifier form: ask for an array of one.
// See docs/third-party/README.md § cross-plugin references.
const refResolverDescriptor = z.object({
  id: z.string().min(1).max(64),
  kind: z.string().min(1).max(64),
  // POST { identifiers } → PluginRefResolutionBody[]
  resolve: pluginRoute,
})

// A typed set of records the host draws with its own components (@acorn/protocol/collections.ts holds
// the response schema). `(id, plugin id)` is the universal reference, which is what lets a placement
// outlive the plugin being disabled and reinstalled. See docs/dashboards.md § Collections.
const collectionDescriptor = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  // GET ?<declared params> → { schema, rows }
  items: pluginRoute,
  params: collectionParamsSchema.optional(),
  // The static promise about what `items` returns, so a panel editor can offer views before any data
  // exists. Optional because a query-shaped collection, such as a saved SQL statement, can't know its
  // columns at manifest time. The response self-describes either way.
  schema: collectionSchema.optional(),
  refresh,
})

// Periodic work the node runs for this plugin, with no client open. The pair to
// `ctx.schedules.register`: two feeders, one registry, indistinguishable downstream. A manifest is also
// how the owner is told, because a schedule acts while nobody is watching. See docs/schedules.md.
const scheduleDescriptor = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  // POST { scheduleId }. Confined to the plugin's route namespace at parse and re-checked on the node
  // before each run. The response is ignored beyond ok or error.
  run: pluginRoute,
  // The plugin floor (300s) isn't spelled here. It's enforced on read from the key's owner prefix
  // (node-core/server/schedules/scheduler.ts § floorFor), so declaring under a plugin key opts in.
  cadence: cadenceSchema,
  // Seconds, and the one unit trap in this feature: the engine's DeclaredSchedule.timeoutMs is
  // milliseconds and the host converts. Absent means the engine default of 60s.
  timeout: z.number().int().min(1).max(300).optional(),
})

// A colour theme: a map of theme-token values the host validates, then generates a
// `:root[data-theme="plugin:<pluginId>:<id>"]` block from. No plugin-authored CSS reaches the shell.
// `z.strictObject` rather than `z.record` so every check happens at parse time.
// See docs/ui-design.md § Plugin themes for the token contract and what each group may declare.
const themeDescriptor = z.object({
  // Namespaced by the host into `plugin:<pluginId>:<id>`. The alphabet is bounded because the result
  // is written into a CSS attribute selector.
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'theme id must be lower-case alphanumeric with dashes'),
  label: z.string().min(1).max(80),
  // Drives `--is-dark`, `--color-scheme` and `--syntax-fg`, which is everything that asks a theme
  // whether it's dark: the terminal and editor bridges read `--is-dark`, and the diff and check logs
  // pick their syntax palette off `--syntax-fg`.
  dark: z.boolean().default(false),
  tokens: z.strictObject(Object.fromEntries(THEME_PALETTE_TOKENS.map((name) => [
    name,
    z.string().min(1).max(THEME_COLOR_VALUE_MAX).refine(
      isThemeColorValue,
      'must be a hex colour or a flat colour function — #1e1e2e, rgba(0, 0, 0, 0.42), oklch(0.7 0.15 250)',
    ),
  ]))),
})

// A check the host runs before it archives a task, and the cleanup the owner may opt into. The pair to
// `ctx.taskChecks.register`. Node-side, because the question is about a worktree and the processes
// around it. See docs/plugins.md § Task checks.
const taskCheckDescriptor = z.object({
  id: z.string().min(1).max(64),
  // GET ?taskId=… → { concern } | { concern: null }. Confined to this plugin's own namespace at parse
  // time and re-confined on every dispatch, exactly like `items` and `run`.
  check: pluginRoute,
  // POST { taskId }, run only when the concern offered an action and the owner left it ticked. Absent
  // means advisory: the host draws no checkbox even if the check's answer asks for one, because a
  // checkbox with nothing behind it is worse than none.
  apply: pluginRoute.optional(),
  // Seconds, for the check only. Absent means the host default, and the host ceiling wins either way:
  // the owner is waiting on a dialog (node-core/server/plugin/taskChecks.ts).
  timeout: z.number().int().min(1).max(10).optional(),
})

// `api` and `events` are enforced by the UI bridge (client-core/plugins/frames). `contributions` stays
// loose: a manifest written for a newer acorn should contribute less on an older one rather than fail
// to parse.
//
// The caps are product judgements, not storage limits. Eight is "as many as a plugin has rail sources"
// and four is "a handful"; a package that wants more is describing an app rather than an integration.
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
  routes: z.array(clientRouteDescriptor).max(8).default([]),
  agentContexts: z.array(agentContextDescriptor).max(4).default([]),
  refResolvers: z.array(refResolverDescriptor).max(4).default([]),
  themes: z.array(themeDescriptor).max(8).default([]),
  contextMenus: z.array(contextMenuDescriptor).max(8).default([]),
  extensionPoints: z.array(extensionPointDescriptor).max(4).default([]),
  extensions: z.array(extensionDescriptor).max(8).default([]),
  collections: z.array(collectionDescriptor).max(8).default([]),
  schedules: z.array(scheduleDescriptor).max(4).default([]),
  taskChecks: z.array(taskCheckDescriptor).max(4).default([]),
}).prefault({})


// The permissions block as a whole, named so the wire projection can be inferred from it. This is what
// the trust dialog renders and the owner consents to. `api` scopes stay unvalidated strings: an unknown
// scope is one this acorn can't grant, which the bridge denies rather than the manifest rejecting.
const manifestPermissions = z.object({
  api: z.array(z.string().min(1).max(64)).max(64).default([]),
  events: z.array(z.string().min(1).max(64).regex(/^[a-z][a-z0-9:._-]*$/i)).max(64).default([]),
  node: nodePermissions.prefault({}),
})

const manifestShape = z.object({
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
  apiVersion: z.string().min(1).max(16),
  node: entry.optional(),
  client: entry.optional(),
  // Loaded-plugin storage is host-opened and host-migrated. The same confinement rule as the code
  // entrypoints keeps its DDL chain inside the installed package.
  migrations: entry.optional(),
  permissions: manifestPermissions.prefault({}),
  contributions,
})
// `pluginManifestSchema` in node-core/main/pluginManifest.ts wraps this with the cross-field
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

/** A full-screen picker the host places. Not a pane — it belongs to no task's layout. */
export const isOverlaySurface = (frame: { target: string }): boolean => frame.target === 'overlay'

/** A replacement for a designated core surface. Not a pane and not an overlay: it has no layout key,
 *  no click site of its own and no verb that opens it. The user's arbitration is the only thing that
 *  ever puts one on screen (@acorn/protocol/extensionPoints.ts). */
export const isCoreSlotSurface = (frame: { target: string }): boolean => frame.target === 'coreSlot'

// ── The wire projection ───────────────────────────────────────────────────────────────────────────
//
// What a plugin's manifest declared, as it reaches a device inside a roster row. Not what is enforced;
// see docs/security.md § Design rules, rule 6.
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
export type PluginPaneLayout = Omit<z.infer<typeof paneLayout>, 'document'> & { document: PluginDocumentRegion }
export type PluginFrameSurface = Omit<z.infer<typeof frameSurface>, 'scope' | 'claimsKeys' | 'layout' | 'coreSlot'> & {
  scope?: 'task' | 'project'
  claimsKeys?: string[]
  layout?: PluginPaneLayout
  // Wider than the parse: the client re-checks the slot name before registering a provider.
  coreSlot?: string
}
export type PluginChromeAction = z.infer<typeof chromeAction>
// The verbs that need nothing from their click site. `createTask` depends on a selected rail row and
// `navigate` on a routed project, and a command registry row has neither in scope.
export type PluginCommandAction = z.infer<typeof contextFreeAction>
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
export type PluginPaletteDescriptor = z.infer<typeof paletteDescriptor>
export type PluginCommandCategory = z.infer<typeof commandCategory>
export type PluginCommandDescriptor = z.infer<typeof commandDescriptor>
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
// `location` is wider than the parse: the client re-checks it and every `when` key against its own
// copy of the vocabulary before registering anything.
export type PluginContextMenuDescriptor = Omit<z.infer<typeof contextMenuDescriptor>, 'location'> & {
  location: string
}
// `location` is wider than the parse, for the reason the context-menu descriptor gives above.
export type PluginExtensionPointDescriptor = Omit<z.infer<typeof extensionPointDescriptor>, 'location' | 'panels'> & {
  location: string
  panels?: PluginPanelRegion
}
export type PluginExtensionDescriptor = z.infer<typeof extensionDescriptor>
export type PluginCollectionDescriptor = z.infer<typeof collectionDescriptor>
export type PluginScheduleDescriptor = z.infer<typeof scheduleDescriptor>
export type PluginTaskCheckDescriptor = z.infer<typeof taskCheckDescriptor>

// Loose on the wire as well as in the schema: a client that doesn't know a future sibling key should
// contribute less rather than fail to parse. Every list but `frames` is optional because an older node's
// roster row won't carry it, and every reader uses `?? []`.
export type PluginContributions = {
  frames: PluginFrameSurface[]
  sources?: PluginSourceDescriptor[]
  slots?: PluginSlotDescriptor[]
  palette?: PluginPaletteDescriptor[]
  commands?: PluginCommandDescriptor[]
  keybindings?: PluginKeybindingDescriptor[]
  attention?: PluginAttentionDescriptor[]
  nodeStats?: PluginNodeStatDescriptor[]
  contentLinks?: PluginContentLinkDescriptor[]
  agentContexts?: PluginAgentContextDescriptor[]
  refResolvers?: PluginRefResolverDescriptor[]
  routes?: PluginClientRouteDescriptor[]
  themes?: PluginThemeDescriptor[]
  contextMenus?: PluginContextMenuDescriptor[]
  extensionPoints?: PluginExtensionPointDescriptor[]
  extensions?: PluginExtensionDescriptor[]
  collections?: PluginCollectionDescriptor[]
  schedules?: PluginScheduleDescriptor[]
  taskChecks?: PluginTaskCheckDescriptor[]
} & Record<string, unknown>

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
import {
  ARBITRATION_MODES,
  CORE_EXCLUSIVE_SLOTS,
  EXTENSION_POINT_KINDS,
  EXTENSION_POINT_LOCATIONS,
  HOOK_MODES,
  HOOK_PAYLOAD_TYPES,
  parseExtensionPointRef,
} from './extensionPoints.ts'
import { isNormalizedChord, isPluginKeyClaim, isPluginShortcutChord, isReservedPluginKeyClaim } from './keybindings.ts'
import { PANE_LAYOUTS, regionProblem } from './paneLayouts.ts'
import { PLUGIN_API_RANGE_RE } from './pluginApiVersion.ts'
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
  // The brand's own colour, which the mark's surfaces read as `--brand`. Six-digit hex rather than any
  // CSS colour on purpose: this string reaches a `style` attribute, and a colour slot accepts `url()`,
  // which would let a manifest make an outbound request. See docs/ui-design.md section Icons.
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'icon colour must be a six-digit hex, such as #24292f').optional(),
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

// What fills one region of a layout. Three kinds, and the difference between them is who draws the
// pixels.
//
// `'frame'` is this plugin's own bundle in a sandboxed iframe: the plugin draws, and the host sees a
// rectangle. A `remote` region is the same bundle running in a worker with no DOM, emitting a tree of
// the host's own component names, which the host draws (docs/plugins.md § The tree contract); `entry`
// is a key of the object the bundle passed to `mountTree`. A document region is host-drawn outright:
// the plugin contributes routes and a language id, no code.
//
// Two of the three run the plugin's bytes, and both are gated on an accepted bundle hash. Only the
// document region is free of that, which is why `hasFrameRegion` and `hasRemoteRegion` are asked
// separately below rather than being one "does this run code" predicate: they differ in what the
// runtime has to hand over, an iframe origin versus a worker port.
const paneRegionSource = z.union([
  z.literal('frame'),
  z.object({ kind: z.literal('remote'), entry: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('document') }).extend(documentRegion.shape),
])

const frameSurface = z.object({
  // Which registry this lands in. The shell renders them all the same way; the surrounding chrome it
  // supplies is what differs.
  //
  // `overlay` is the full-screen picker slot: the host places the rectangle and the frame draws its
  // contents. It has no click site, so `openOverlay` is the only way to open one. `coreSlot` is drawn
  // where one of core's own surfaces normally is; registering one seizes nothing, because the user
  // picks the provider in settings. See docs/plugins.md § Replacing a core surface.
  // `inline` is the rectangle a *different* plugin's point holds: the surface is never registered as
  // one of this plugin's own panes, and it appears only where an `extensions` entry places it. Nothing
  // draws it until an owner's point takes it, which is what makes "the owner consents" true of the
  // rectangle kind as well.
  target: z.enum(['pane', 'refPanel', 'settings', 'importer', 'webview', 'overlay', 'coreSlot', 'inline']),
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
  // Lets a mobile shell skip a desktop-shaped pane instead of rendering it unusably.
  formFactor: z.array(z.enum(['desktop', 'mobile'])).min(1).max(2).default(['desktop']),
  // `refPanel` and task-scoped `pane`. The client adapter checks it against the plugin id: a surface
  // may only name its own provider. On a task pane it additionally marks the pane as a linked-items
  // view, hidden on tasks with no link from that provider.
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
  // `pane` only. Absent means a plain frame fills the whole pane. Present, the host draws the
  // arrangement and fills each region from `regions` below (@acorn/protocol/paneLayouts.ts).
  layout: z.enum(PANE_LAYOUTS).optional(),
  // `pane` only, and only alongside `layout`. Keys are region names the layout has; the cross-check
  // is in the refinement below, where both fields are visible.
  regions: z.record(z.string().min(1).max(64), paneRegionSource).optional(),
  // Chords the frame may keep instead of forwarding to the shell. Runtime code may narrow this list,
  // never widen it; declaring the upper bound makes the capture visible before code runs.
  claimsKeys: z.array(z.string().min(1).max(64).superRefine((value, ctx) => {
    if (isReservedPluginKeyClaim(value)) {
      ctx.addIssue({ code: 'custom', message: `${value} is reserved by acorn and cannot be claimed` })
    } else if (!isPluginKeyClaim(value)) {
      ctx.addIssue({ code: 'custom', message: 'claimed keys must be canonical chords with meta, ctrl, or alt' })
    }
  })).max(32).default([]),
}).superRefine((surface, ctx) => {
  // The one cross-field rule a surface can check on its own: a layout has the regions it has. The
  // client repeats it over a roster row, because a manifest reaches a device as bytes a node sent
  // (client-core/plugins/frames/layouts.ts).
  if (surface.regions && !surface.layout) {
    ctx.addIssue({ code: 'custom', path: ['regions'], message: 'regions need a layout to name them' })
    return
  }
  if (!surface.layout) return
  const problem = regionProblem(surface.layout, Object.keys(surface.regions ?? {}))
  if (problem) ctx.addIssue({ code: 'custom', path: ['regions'], message: problem })
})

// ── Declarative chrome ────────────────────────────────────────────────────────────────────────────
//
// Everything below is static data or a path into the plugin's own namespace; the host draws the pixels
// from a route on the plugin's always-running node half. The confinement check lives in the
// manifest-level refinement, because it needs `id`.
// See docs/plugins.md § Descriptors for facts, trees for UI, rectangles for pixels.

// The closed verb set the host executes for a descriptor. `invoke`, an RPC into the plugin's frame,
// isn't here: it needs a headless frame lifecycle the shell doesn't have.

const chromeAction = z.discriminatedUnion('verb', [
  // A pane the same manifest declares under `frames`, checked below. The clicked row's id rides along
  // as a pane intent (client-core/registries/clientEvents.ts).
  z.object({ verb: z.literal('openPane'), pane: z.string().min(1).max(64) }),
  // Go to the task the click names and stop there, for a row whose thing IS a task. Only a dashboard
  // row carries one (@acorn/protocol/collections.ts), so elsewhere the host refuses it out loud.
  z.object({ verb: z.literal('openTask') }),
  // A project-scoped pane the same manifest declares, reached by navigating to the route declared for
  // it. Separate from `openPane` because `openPane` mutates a task's persisted layout and this changes
  // the URL, which also keeps `openPane`'s "open a task first" refusal honest.
  z.object({ verb: z.literal('navigate'), surface: z.string().min(1).max(64) }),
  z.object({ verb: z.literal('runNodeAction'), path: pluginRoute }),
  // Host-owned promotion. The selected rail row carries the seed; the verb carries no plugin
  // callbacks, so it survives the descriptor boundary.
  z.object({ verb: z.literal('createTask') }),
  // https only, opened in the real browser rather than in-app (docs/shell.md § Navigation policy).
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
  // Go to a task and stop there. Only a dashboard row carries the task it means (collections.ts), so
  // from a command or a badge this verb has nothing to aim at and the host says so.
  z.object({ verb: z.literal('openTask') }),
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
  // Does this rail read the routed project? Opt in, so an older manifest and a plugin that never
  // thought about projects both land on `false`, which is true of most of them. Declaring it turns on
  // the shell's project picker for this source and adds `?project=` to the items route
  // (client-core/plugins/chrome/ChromeSourcePanel.tsx).
  projectScoped: z.boolean().optional(),
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

// What a hook's payload is declared to hold: field name to type, in the tree's prop vocabulary. Bounded
// because a payload is a decision's subject, not a document.
const hookPayloadShape = z.record(
  z.string().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'a payload field is a plain identifier'),
  z.enum(HOOK_PAYLOAD_TYPES),
)

const extensionPointDescriptor = z.object({
  // Namespaced by the host into `<pluginId>:<id>`, the only name anyone else may use.
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'extension point id must be lower-case alphanumeric with dashes'),
  // What the owner is opening, in the owner's words. Shown at trust time to both sides.
  label: z.string().min(1).max(80),
  // Which of the five things a contributor may bring (@acorn/protocol/extensionPoints.ts). Defaults to
  // `rows`, so every manifest written before this field parses to the kind it meant.
  kind: z.enum(EXTENSION_POINT_KINDS).default('rows'),
  // `rows` and `rectangle`: where on the owner's surface, and which of the owner's surfaces. Required
  // for those two and refused for the rest, in the cross-check below — a hook has nothing to draw and
  // an annotation draws at a site the owner registered in code, so neither has a location to name.
  location: z.enum(EXTENSION_POINT_LOCATIONS).optional(),
  surface: z.string().min(1).max(64).optional(),
  // `pane.aside` only, checked in node-core/main/pluginManifest.ts. The aside's contributor is the
  // user rather than another plugin, so it needs composition constraints rather than a route to read.
  // Absent means the defaults: this plugin's own collections, every view, four panels.
  panels: panelRegion.optional(),
  // `annotation` only, and required there: what the owner's items are keyed by. The host mints a
  // lookup string from these fields in this order, so the key set is the owner's and not whatever a
  // contributor's mark happens to carry.
  key: z.record(z.string().min(1).max(64), z.enum(['string', 'number'])).optional(),
  // `remote` and `rectangle`: who fills the box when more than one contributor could
  // (@acorn/protocol/extensionPoints.ts § ARBITRATION_MODES).
  mode: z.enum(ARBITRATION_MODES).optional(),
  // `replace` only: what the owner passes as the key when it opens the box, named so the developer
  // view and the settings picker can say what the arbitration is over ('mime', 'path', 'tool').
  selector: z.string().min(1).max(64).optional(),
  // `stack` only: how many contributors fit before the host draws a disclosure instead. The owner sets
  // it because it is the owner's screen, and each occupant costs a live subtree or an iframe.
  max: z.number().int().min(1).max(12).default(4),
  // `remote` and `rectangle`: the key values this point will ever pass, for the developer view and for
  // an author checking their `matches` against something. Advisory: a contributor whose `matches` fall
  // outside it simply never wins.
  accepts: z.array(z.string().min(1).max(128)).max(32).optional(),
  // ── The hook fields (docs/plugins.md § Hooks) ──
  // Required for `kind: 'hook'` and refused elsewhere.
  payload: hookPayloadShape.optional(),
  // The subset of observe | transform | veto this owner permits. A handler asking for anything else
  // gets nothing.
  allows: z.array(z.enum(HOOK_MODES)).min(1).max(HOOK_MODES.length).optional(),
  // How long one handler may take. Beyond it a veto is treated as `onTimeout` says and everything else
  // is skipped, because a plugin that stalls must not brick a push.
  timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
  onTimeout: z.enum(['allow', 'deny']).default('allow'),
  // `priority` reads the handler's own number first, then install time; `install` ignores it. Ties are
  // stable either way.
  order: z.enum(['priority', 'install']).default('priority'),
  // Run every veto rather than stopping at the first, so the owner can show all the reasons at once.
  collect: z.boolean().default(false),
})

const extensionDescriptor = z.object({
  id: z.string().min(1).max(64),
  // `<ownerPluginId>:<pointId>`. Naming the owner out loud is the disclosure: an owner reading this
  // manifest at install time sees which package this one reaches into.
  point: z.string().min(1).max(130),
  // The group heading the host draws above these rows, and the name the developer view and the
  // settings picker call this contribution. The host stamps the plugin id beside it, so this label
  // can't pass the contribution off as somebody else's.
  label: z.string().min(1).max(80),
  order: z.number().int().min(0).max(100_000).default(500),
  // Exactly one carrier, checked below. Which one is right depends on the owner's `kind`, which this
  // manifest cannot see, so the shape rule here is "name one way in" and the match against the point's
  // kind happens where both are visible (client-core/registries/extensionPoints.ts).
  //
  //   items   `rows` and `annotation`: a route on this plugin's own namespace (confined below).
  //   remote  a key of the object this plugin's bundle passed to `mountTree`.
  //   frame   an `inline` frame this manifest declares, drawn as a sibling of the owner's.
  //   route   `hook`: a route on this plugin's own namespace the host calls with the payload.
  items: pluginRoute.optional(),
  remote: z.string().min(1).max(64).optional(),
  frame: z.string().min(1).max(64).optional(),
  route: pluginRoute.optional(),
  // `remote` and `frame`: which key values this draws. Keyed rather than a predicate, because a
  // predicate is code and the arbitration has to be decidable by the host without running any.
  // Absent means "every key", which is the ordinary answer in a `stack` slot.
  matches: z.array(z.string().min(1).max(128)).min(1).max(64).optional(),
  // `route` only: what this handler asks to do, and where it wants to sit in the chain.
  mode: z.enum(HOOK_MODES).optional(),
  priority: z.number().int().min(0).max(100_000).default(500),
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
  const carriers = (['items', 'remote', 'frame', 'route'] as const).filter((key) => descriptor[key] !== undefined)
  if (carriers.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['items'],
      message: `an extension names exactly one of items, remote, frame or route${carriers.length ? `, not ${carriers.join(' and ')}` : ''}`,
    })
  }
  // A mode belongs to a handler and nothing else. On any other carrier it would parse and never be
  // read, which is the failure this schema spends its length refusing.
  if (descriptor.mode && descriptor.route === undefined) {
    ctx.addIssue({ code: 'custom', path: ['mode'], message: 'mode is only valid on a hook handler, which names a route' })
  }
  if (descriptor.route !== undefined && !descriptor.mode) {
    ctx.addIssue({ code: 'custom', path: ['mode'], message: 'a hook handler says what it asks to do: observe, transform or veto' })
  }
  if (descriptor.matches && descriptor.remote === undefined && descriptor.frame === undefined) {
    ctx.addIssue({ code: 'custom', path: ['matches'], message: 'matches is only valid on a remote or frame contribution' })
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

// One verb this plugin will write onto the node's audit trail (docs/security.md § Audit). The host
// qualifies it as `<pluginId>:<id>`, so a package cannot file a row under a core verb or another
// plugin's, and the settings surface can still enumerate the whole vocabulary because every entry in it
// came from a parsed manifest or from core's own closed union.
//
// Declaring is what makes the trail reviewable: an action nobody can enumerate is one nobody reviews,
// which is the same argument the core union is built on. A plugin recording an action it did not
// declare here is refused.
const auditActionDescriptor = z.object({
  // Dots, not colons: the colon is the host's separator. `run.finished`, not `workflows:run.finished`.
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9.-]*$/, 'audit action id must be lower-case alphanumeric with dots and dashes'),
  // What the settings row calls it. The raw verb is honest but unreadable, and a plugin knows its own
  // wording better than a lookup table in the shell does.
  label: z.string().min(1).max(80),
})

// ── Managed agent harnesses (docs/managed-agents.md § Harnesses) ──────────────────────────────────
//
// A harness is data. The contributing plugin describes the spawn, and plugins/agents owns the child
// process, the session, and the transcript, so a data-only harness plugin needs no `exec` grant.
// docs/plugin-authoring.md § Harnesses is the authoring contract.

// A variable name, or a `PREFIX_*` glob. A bare `*` is refused here and in `brokerEnv`: it would copy
// the node's whole environment into the agent and defeat the allowlist.
const envName = z.string().min(1).max(64).regex(
  /^[A-Za-z_][A-Za-z0-9_]*\*?$/,
  'env passthrough must be a variable name or a PREFIX_* glob',
)

// Exactly one of `command` and `entry`, checked in node-core/main/pluginManifest.ts because a
// refinement here cannot name the field path inside the containing descriptor.
const harnessSpawn = z.object({
  // An executable resolved on PATH. The user installs the CLI, and the harness diagnostics report it
  // when missing.
  command: z.string().min(1).max(128).optional(),
  // A package-relative JS file, run with the node service's own binary, for an adapter in front of an
  // agent that does not speak ACP. Confined to the installed package directory at parse time.
  entry: entry.optional(),
  args: z.array(z.string().min(1).max(256)).max(16).default([]),
  // `entry` only: the CLI the adapter drives. Its resolved absolute path reaches the child as the named
  // variable.
  requires: z.object({
    command: z.string().min(1).max(128),
    env: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/, 'env must be an upper-case variable name'),
  }).optional(),
})

// What ACP does not carry, declared per harness rather than hardcoded as an id list inside acorn.
const harnessQuirks = z.object({
  // The agent implements a compaction command, so the pane may offer Compact.
  manualCompaction: z.boolean().default(false),
  // Sessions outlive the agent process and can be reloaded, so resume and the terminal handoff exist.
  sessionPersistence: z.boolean().default(false),
})

// The interactive TUI beside the managed session: the data half of an agent profile. The code half,
// `headlessArgv`, `resumeArgv`, `aiArgv` and the stream-JSON parser, has no manifest form, so a
// data-only harness works in the Agent pane and the terminal but no workflow step can name it.
const harnessTerminal = z.object({
  command: z.string().min(1).max(128),
  backendPreference: z.enum(['node-pty', 'tmux']).default('tmux'),
  launchArgs: z.array(z.string().min(1).max(4_096)).max(16).default([]),
})

const harnessDescriptor = z.object({
  // Namespaced by the host into `<pluginId>:<id>`, then persisted as a session row's `providerId` and
  // `profileId`. Renaming one breaks every session the plugin's users already have.
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  // A Lucide name or a `brand:` mark; `brand:<pluginId>` is this manifest's own `icon`.
  glyph: z.string().min(1).max(64).optional(),
  spawn: harnessSpawn,
  // Config variables carried through from the node's environment. Configuration only: the broker's base
  // allowlist omits `ANTHROPIC_*` and `OPENAI_*`, and an agent CLI authenticates through its own stored
  // login. Disclosed in the trust prompt.
  envPassthrough: z.array(envName).max(32).default([]),
  quirks: harnessQuirks.prefault({}),
  // Routes on this plugin's own node half, confined to its own namespace at parse time. `usage` answers
  // the plan-usage snapshot for the Agent pane, `auth` whether the harness's account is signed in.
  // Absent means the matching surface shows less.
  probes: z.object({
    usage: pluginRoute.optional(),
    auth: pluginRoute.optional(),
  }).optional(),
  terminal: harnessTerminal.optional(),
})

// `api` and `events` are enforced by the UI bridge (client-core/plugins/frames). `contributions` stays
// loose: a manifest written for a newer acorn should contribute less on an older one rather than fail
// to parse.
//
// The caps are product judgements, not storage limits. Eight is "as many as a plugin has rail sources"
// and four is "a handful"; a package that wants more is describing an app rather than an integration.
const contributionsShape = z.looseObject({
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
  // Raised from four and eight when the one key grew from rows to five kinds: a plugin that opens a
  // pane, a slot in it, a hook before it acts and an annotation on its rows is describing one
  // integration, not four, and the old caps were sized for rows alone.
  extensionPoints: z.array(extensionPointDescriptor).max(16).default([]),
  extensions: z.array(extensionDescriptor).max(16).default([]),
  collections: z.array(collectionDescriptor).max(8).default([]),
  schedules: z.array(scheduleDescriptor).max(4).default([]),
  taskChecks: z.array(taskCheckDescriptor).max(4).default([]),
  // Audit verbs. The ctx twin is `ctx.audit`, and both feeders land in the same registry.
  auditActions: z.array(auditActionDescriptor).max(8).default([]),
  // Managed agent harnesses. The ctx twin is the `agents.harnessRegistry` capability. See
  // docs/managed-agents.md § Harnesses.
  harnesses: z.array(harnessDescriptor).max(4).default([]),
})

// Every contribution kind a manifest may declare, as a runtime list.
//
// Derived from the schema rather than typed out beside it, so the two cannot drift. Two consumers: the
// forward-compatibility report, which needs to know which of a loose object's keys this build actually
// understands (node-core/main/pluginManifest.ts), and the contribution-kind table in
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
  emits: z.array(pluginEmitSchema).max(32).default([]),
  // A range over plugin API majors, not a single number: '3', '2 || 3', '2-4'. Held to the shape
  // here so a typo fails the manifest with a reason instead of loading nowhere (./pluginApiVersion.ts).
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
/** What one region holds. The two object kinds carry a `kind` tag so the union stays discriminated;
 *  `'frame'` is a bare string because it has nothing to say beyond its own name. */
export type PluginPaneRegion =
  | 'frame'
  | { kind: 'remote'; entry: string }
  | ({ kind: 'document' } & PluginDocumentRegion)
export type PluginFrameSurface = Omit<z.infer<typeof frameSurface>, 'scope' | 'claimsKeys' | 'layout' | 'regions' | 'coreSlot'> & {
  scope?: 'task' | 'project'
  claimsKeys?: string[]
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
export type PluginCollectionDescriptor = z.infer<typeof collectionDescriptor>
export type PluginScheduleDescriptor = z.infer<typeof scheduleDescriptor>
export type PluginTaskCheckDescriptor = z.infer<typeof taskCheckDescriptor>
export type PluginAuditActionDescriptor = z.infer<typeof auditActionDescriptor>
export type PluginHarnessDescriptor = z.infer<typeof harnessDescriptor>

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
  auditActions?: PluginAuditActionDescriptor[]
  harnesses?: PluginHarnessDescriptor[]
} & Record<string, unknown>

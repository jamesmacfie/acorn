// The `acorn-plugin.json` contract — the manifest a loaded plugin ships, declared ONCE.
//
// It lives in protocol because both sides have a stake in it and neither may import the other. The
// node parses a package's manifest off disk with this schema (node-core/main/pluginManifest.ts adds
// the cross-field rules and the reader); the client receives the parsed result inside a roster row and
// registers contributions from it. Before this file the shape was written twice — a Zod schema on the
// node and a hand-written twin in api.ts — with nothing checking that the two agreed, because the data
// crosses a process boundary as `unknown` and the compiler never sees both ends of the wire at once.
// A field added to one and forgotten in the other failed silently, and the permissions block failing
// that way meant showing an owner a security disclosure that did not match what was parsed.
//
// The wire projections are at the bottom. They are `z.infer` of these schemas, loosened in exactly the
// places where an OLDER node's parser had fewer defaults to fill — a roster row is bytes a node sent,
// and that node may be running a version of this schema that predates a field.
import { z } from 'zod'
import { compileContentLinkPattern, CONTENT_LINK_PATTERN_MAX_LENGTH } from './contentLinkPattern.ts'
import { isNormalizedChord, isPluginKeyClaim, isPluginShortcutChord, isReservedPluginKeyClaim } from './keybindings.ts'
import { LANGUAGE_IDS } from './languageIds.ts'
import { normalizeWebviewHost, WEBVIEW_HOST_MAX_COUNT, WEBVIEW_HOST_MAX_LENGTH } from './webview.ts'

// Same shape as the route registry's and the plugin database factory's id rules, plus a length
// bound, because this id becomes both the plugin's own route namespace and
// `<dataRoot>/plugins/<id>.sqlite`. The prefix itself is not spelled in this package — an
// architecture rule forbids it, and node-core/main/pluginManifest.ts is where the confining happens.
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


// The plugin's logo: one SVG path's `d` attribute, and deliberately not an SVG document.
//
// A document would mean `<script>`, `<use href>`, `<image href>`, `<foreignObject>`, `on*` handlers
// and CSS `@import` — an allowlist parser and a new trust boundary, for a logo. A `d` string has
// none of that reachable from its grammar, so the check below is the whole check. The renderer
// (client-core/ui/Icon.tsx) fills it with `currentColor`, which is why this shape themes and a
// data-URI `<img>` would not. The retired docs/future/icons.md (git history) records the alternatives.
const PATH_D_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\s+-]+$/

const brandMark = z.object({
  // Authored in a 24x24 box, as simple-icons is throughout — the renderer hardcodes that viewBox.
  d: z.string().min(1).max(4_096).regex(PATH_D_RE, 'icon must be a single SVG path `d` string'),
})

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

// A path the host will GET or POST on this plugin's behalf. Bounded here, confined in the
// manifest-level refinement (which is where `id` is visible). Declared above the frame block because
// a document region names two of them.
const pluginRoute = z.string().min(1).max(256)

// ── Host-owned document surfaces (docs/third-party/monaco.md) ──────────────────────────────────────────
//
// The one class of surface the sandbox provably cannot serve. A Monaco frame measures 7.93 MiB
// against an 8.00 MiB cap with a stub UI, and its language-service workers cannot be delivered at all:
// a plugin origin serves one file and the frame CSP has no `worker-src`. The alternative to this block
// was multi-file plugin origins plus `worker-src` — a permanent widening of the sandbox for every
// installed plugin, forever, to serve two first-party panes.
//
// So the host owns the editor and the plugin supplies the DOCUMENT: an identity, a route that reads
// it, optionally a route that writes it, and a language id from the vocabulary above. The plugin ships
// no editor code and therefore cannot get theming, save semantics, dirty state or view state wrong,
// because it never owns them.
//
// The bar for a host-owned region, and it is deliberately high: a region is host-owned only when the
// sandbox CANNOT serve its content. Common is not the bar; impossible is. Master/detail is common —
// every frame already draws its own with ordinary CSS — and the answer to "make that a region too"
// stays no, because the host rendering a plugin's list from data means designing and eternally
// versioning a widget toolkit in the wire format.
// The first language capability, and the precedent for how the rest grow: LSP-SHAPED
// REQUEST/RESPONSE ROUTES — position and text in, standard items out — never "run my code inside the
// editor". The host POSTs `{ text, position }` and maps a small subset of LSP's CompletionItem back
// onto its editor; it never learns the language. Context detection ("after FROM → tables, after
// `alias.` → that table's columns") is the PLUGIN's, on its node half, where the schema knowledge
// already lives — which is what lets a GraphQL console or a YAML config plugin reuse this with zero
// host changes. Hover and diagnostics can follow the same shape when a consumer needs them; custom
// widgets, decorations and inline UI cannot, and the test for any proposal is "is this an LSP method".
const documentCompletions = z.object({
  route: pluginRoute,
  // What re-opens the popup mid-word, beyond the editor's own identifier rule. Small and bounded:
  // this is a list of punctuation, not a grammar.
  triggerCharacters: z.array(z.string().min(1).max(2)).max(8).default([]),
})

const documentRegion = z.object({
  // From the published vocabulary, so an unknown id is a parse error rather than a document that
  // silently renders as plain text. LSP's spellings (@acorn/protocol/languageIds.ts).
  languageId: z.enum(LANGUAGE_IDS).default('plaintext'),
  // GET -> { text }. `:taskId` and `:projectId` are substituted by the host from the pane's own scope;
  // no other parameter is, because no other one is the host's to know.
  read: pluginRoute,
  // PUT { text }. ABSENT MEANS READ-ONLY, which is a real mode rather than a degenerate one — a
  // generated migration or a rendered template in a proper highlighted viewer wants exactly this.
  write: pluginRoute.optional(),
  completions: documentCompletions.optional(),
})

// Which arrangement of regions the host draws for this pane, and what goes in each.
//
// REGION-ADDRESSED FROM DAY ONE even though only the degenerate template exists, and that is the single
// one-way door in the design. Shipped whole-pane-addressed, a declaration means "this PANE is a document
// surface"; under templates it means "this REGION of a template is one". Bolting regions on later would
// change what every already-published declaration means, underneath third-party plugins we no longer
// control. Carrying the region-capable shape now costs a nested object and keeps the door open.
//
// `document-over-frame` arrived with its consumer, which is the database pane: a document above the
// plugin's own frame with a host-owned splitter between them. `frame-beside-document` (the editor
// pane's) is the next entry and lands with ITS consumer rather than ahead of it. Orientation is encoded
// in the NAME on purpose: an `orientation` field would imply the other values exist, which is the first
// knob of a layout language. The generative rule, so future entries stay in the family:
// `<host surface>` optionally arranged `<over|beside>` `frame`.
const paneLayout = z.object({
  template: z.enum(['document', 'document-over-frame']),
  document: documentRegion,
})

const frameSurface = z.object({
  // Which registry this lands in. The shell renders them all the same way; what differs is the
  // surrounding chrome it supplies.
  //
  // `overlay` is the full-screen picker slot — the one the editor's ⌘P file palette occupies as a
  // compiled contribution, and the last component slot with no manifest form. It is a rectangle the
  // HOST places (backdrop, box, close affordance), which is the same argument that makes `refPanel` a
  // frame target: the frame draws its contents, not its own position. It has no click site of its own,
  // so the only way to open one is the `openOverlay` verb below.
  target: z.enum(['pane', 'refPanel', 'settings', 'importer', 'webview', 'overlay']),
  // TASK or PROJECT, and `pane` only. A pane has always meant "a rectangle in a task's layout", which is
  // why that is the default: every manifest written before this field parses and behaves identically.
  //
  // `project` is the other scope the shell actually has. A rail Source's browse renders at
  // `/p/:projectId` with no task anywhere near it, and a project-scoped pane is the DETAIL half of the
  // one list every descriptor source draws through (client-core/plugins/chrome/ChromeSourcePanel.tsx) —
  // the place a `SourceRouteContribution` used to put a compiled plugin's issue view. It is what lets a
  // rail row click resolve outside a task instead of being refused.
  //
  // A property rather than a fifth `target`, because `target` says which registry a surface lands in and
  // `scope` says which of two things a pane IS. As a target it would have had to be added to the `panes`
  // set that `openPane`, `contentLinks` and the frame's own bridge allowlist each key on — four edits to
  // carry one bit, in exchange for nothing a reader gains.
  scope: z.enum(['task', 'project']).default('task'),
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
  // `pane` only. Absent is the shape every manifest written so far has: a plain frame filling the
  // pane, exactly what http declares today. Present, it says the HOST draws some or all of this
  // rectangle from the regions below.
  layout: paneLayout.optional(),
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
  // A project-scoped pane the SAME manifest declares, reached by NAVIGATING to the route the manifest
  // declared for it (`routes` below). The selected row's id becomes the addressed item.
  //
  // Separate from `openPane` rather than a scope-aware widening of it, because the two do different
  // things: `openPane` mutates a task's persisted layout, this changes the URL. Keeping them apart is
  // also what keeps `openPane`'s "open a task first" refusal honest — it goes on firing for a pane that
  // really does need a task, and can no longer fire for one that does not.
  z.object({ verb: z.literal('navigate'), surface: z.string().min(1).max(64) }),
  z.object({ verb: z.literal('runNodeAction'), path: pluginRoute }),
  // Host-owned promotion. The selected rail row carries the seed; the verb itself carries no plugin
  // callbacks and therefore survives the descriptor boundary.
  z.object({ verb: z.literal('createTask') }),
  // https only, and opened in the real browser — never in-app (docs/electron.md § navigation policy).
  z.object({ verb: z.literal('openUrl'), url: z.string().url() }),
  // An `overlay` surface the SAME manifest declares, checked below. This verb is in both unions rather
  // than only the narrow one: an overlay covers the window and belongs to no task's layout, so it needs
  // nothing from its click site — no row, no routed project, no task. The click site it will actually be
  // used from is a command with a keybinding, which is what ⌘P is.
  z.object({ verb: z.literal('openOverlay'), overlay: z.string().min(1).max(64) }),
  // A composed pane the SAME manifest declares, checked below. The only verb whose effect lands inside a
  // plugin rather than on the shell, and it exists because of a chord the plugin cannot receive: in a
  // `document-over-frame` pane ⌘Enter is pressed in the HOST's editor, where the frame has no keyboard at
  // all. The host resolves it against the surface-scoped keybinding, flushes the document, and posts the
  // command id over that frame's bridge.
  //
  // Naming the surface rather than deriving it from the keybinding keeps the command usable on its own —
  // from the palette, from a footer badge — instead of being a thing only a chord can reach.
  z.object({ verb: z.literal('surfaceAction'), surface: z.string().min(1).max(64) }),
])

// Seconds. A fallback for data that changes with no node-side trigger; the primary freshness path is
// `ctx.events.status()` on the existing invalidation channel. Floored so a descriptor cannot turn
// itself into a busy loop against a remote node.
const refresh = z.number().int().min(30).max(86_400).optional()

// The verbs that need NOTHING from their click site. `createTask` depends on a selected rail row and
// its host-owned promotion callback; `navigate` needs a routed project to substitute into the
// surface's path and the shell's navigator to follow it. A command registry row has none of those in
// scope, and neither does a footer badge — the badge's click handler runs with only the plugin and
// the node. A contribution that parses and can only toast is worse for an author than one the
// manifest refuses, so both surfaces take this union rather than the full `chromeAction`.
const contextFreeAction = z.discriminatedUnion('verb', [
  z.object({ verb: z.literal('openPane'), pane: z.string().min(1).max(64) }),
  z.object({ verb: z.literal('runNodeAction'), path: pluginRoute }),
  z.object({ verb: z.literal('openUrl'), url: z.string().url() }),
  z.object({ verb: z.literal('openOverlay'), overlay: z.string().min(1).max(64) }),
  z.object({ verb: z.literal('surfaceAction'), surface: z.string().min(1).max(64) }),
])

// What an empty rail says, and where it can send someone.
//
// The rail's fixed "Nothing here yet." is true and useless, and its uselessness had a cost: linear
// answered a workspace with no linked projects by showing the viewer's own assigned issues instead,
// because a wrong list looked better than a blank one. That is a rail-contract gap owed by every
// source, not a linear feature (docs/third-party/README.md § known issues).
//
// `contextFreeAction`, because an empty rail has no row in scope — the same argument a slot badge and
// a command make. Message length bounded, exactly ONE action, no markup: this is the field that
// invites a source to grow an onboarding flow, and the tier's rule is that growth stops before the
// descriptor vocabulary becomes a UI framework.
const emptyStateDescriptor = z.object({
  message: z.string().min(1).max(160),
  action: contextFreeAction.optional(),
  // The action's label. Absent means the message renders alone, which is a legitimate answer — see
  // linear, whose empty state points at a settings page no verb in this union can reach.
  actionLabel: z.string().min(1).max(40).optional(),
})

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
  // Shown when the route answered with no items. NOT when it failed — an unreachable node already has
  // its own banner, and telling someone "nothing is assigned to you" because a fetch timed out is a
  // lie the host would be telling on the plugin's behalf.
  emptyState: emptyStateDescriptor.optional(),
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
  onClick: contextFreeAction.optional(),
  refresh,
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

// A RENDERER URL the host matches on this plugin's behalf, handing the matched value to the surface the
// entry names. The manifest twin of `SourceContribution.routes` (client-core/registries/sources.ts).
//
// This had no manifest form until now, and the reason is recorded in client-core/plugins/chrome/
// register.ts: a compiled plugin writes its own pattern, so github can declare `/p/:projectId/pulls`,
// and a manifest allowed to do the same could claim `/p/:projectId`, `/settings`, or another plugin's
// path — and would find out by silently taking over project navigation for the whole shell. Confinement
// to a host-minted prefix is the answer, and it is the same answer `route()` gives for the node
// namespace: one prefix per plugin id, checked below, so a collision is a parse error and never a race
// between two loads.
//
// `item` is required. A route on this tier exists to ADDRESS something inside a surface — it does not
// decide whether the surface appears, which is the rail's job — so a route with nothing to address has no
// reason to exist. The HOST matches the URL and supplies the value; naming which capture carries it is
// the same thing `contentLinks.item` already does over a pattern's captures, and it is the only part of
// the match a manifest gets to name.
const clientRouteDescriptor = z.object({
  id: z.string().min(1).max(64),
  // Confined below, because the check needs `id`.
  path: z.string().min(1).max(256),
  // A `scope: 'project'` pane this same manifest declares — the precedent `contentLinks.openPane` and
  // `chromeAction.openPane` already set.
  surface: z.string().min(1).max(64),
  // A `:param` of `path`, and never `projectId`: that one is core's, and the host has already bound it.
  item: z.string().min(1).max(32),
  // Registration order on the Router, so a static path can be declared ahead of a parameter path that
  // would otherwise swallow it — the same job `SourceRouteContribution.order` does.
  order: z.number().int().min(0).max(100_000).default(500),
})

const contentLinkDescriptor = z.object({
  id: z.string().min(1).max(64),
  match: contentLinkPattern,
  // A TASK-scoped pane this manifest declares, checked below. OPTIONAL, and the optionality is the whole
  // point of the second destination: the host can also open the plugin's reference PANEL for the matched
  // item (client-core/registries/contentLinks.ts § openContentTarget), which needs no task and no pane.
  //
  // Not a `destination: 'pane' | 'refPanel'` enum, because it is not the manifest's call. Which of the two
  // fits depends on WHERE the link was clicked — a PR conversation wants the panel so the reader keeps
  // their place, a note wants the pane — and the manifest cannot see the click. So a plugin declares what
  // it CAN receive an item into and the clicking surface states its preference; declaring both is normal,
  // and linear does.
  //
  // A panel is not named here either. It is addressed by PROVIDER, and a `refPanel` frame's provider must
  // already equal the plugin id, so naming it again would only create a second thing to keep in step.
  openPane: z.string().min(1).max(64).optional(),
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

// One batch-enrichment route, so a surface holding identifiers of THIS plugin's items can turn them
// into something displayable without importing this plugin (docs/third-party/README.md § cross-plugin references).
// The host POSTs `{ identifiers }` and parses the answer against @acorn/protocol/refResolvers.ts.
//
// `kind` names the content-link kind these identifiers come from — `linear.issue` — so a caller that
// scanned text knows which resolver its refs belong to. It is a claim like every other id here; what
// binds the answer to a provider is the plugin the route belongs to, which the host stamps.
//
// There is no GET twin and no single-identifier form. A surface that has one identifier asks for an
// array of one, and the cache key is the identifier set either way.
const refResolverDescriptor = z.object({
  id: z.string().min(1).max(64),
  kind: z.string().min(1).max(64),
  // POST { identifiers } → PluginRefResolutionBody[]
  resolve: pluginRoute,
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
  // Eight, matching `sources`: a route addresses something inside a project-scoped surface, and a plugin
  // with more addressable surfaces than rail sources is describing an app rather than an integration.
  routes: z.array(clientRouteDescriptor).max(8).default([]),
  // Four, the same ceiling as attention and nodeStats. A composer list with more than a couple of
  // entries from one plugin is a picker inside a picker, not a richer integration.
  agentContexts: z.array(agentContextDescriptor).max(4).default([]),
  // Four. A plugin with more than a handful of resolvable item kinds is describing a whole product
  // surface, and the vocabulary a resolver answers in is deliberately one shape for all of them.
  refResolvers: z.array(refResolverDescriptor).max(4).default([]),
}).prefault({})


// The permissions block as a whole, named so the wire projection can be inferred from it: this is the
// object the trust dialog renders and the owner consents to.
//
// `api` scopes are unvalidated as strings for the same reason the node block's `core` list is: an
// unknown scope is one this acorn cannot grant, which the bridge handles by denying it
// (client-core/plugins/frames/scopes.ts), not by rejecting the manifest.
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
  // The plural feeder, for a package that is home to several brands (model-providers hosts two).
  // Keys become the suffix in `brand:<pluginId>/<key>`; the prefix is stamped by the host, so the
  // key namespace is private to the plugin and needs no global uniqueness — and `icons` can no more
  // claim another plugin's mark than `icon` can. Capped because a manifest is wire input and every
  // entry becomes a registry row.
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
// The manifest's structural schema. `pluginManifestSchema` in node-core/main/pluginManifest.ts wraps
// this with the cross-field refinements — route confinement, surface reachability, id uniqueness —
// which need `id` and the frame list and so cannot live on the fields.
export const pluginManifestShape = manifestShape
export type PluginManifestShape = z.infer<typeof manifestShape>

// The permissions block on its own, because the desktop parses it a second time. It arrives there over
// IPC and is written into the trust store, where it used to be accepted by `z.custom<...>()` — a cast
// wearing a Zod costume, which accepts anything. That is the one place where a wrong shape does not
// crash: it shows the owner a security disclosure and records their consent against it.
export const pluginPermissionsSchema = manifestPermissions

// ── Surface classification ────────────────────────────────────────────────────────────────────────
//
// Which of the three kinds a declared frame is. Both sides of the wire ask, and they must agree: the
// node's parser uses these to check that an `openPane` names a pane the manifest actually declared,
// and the client uses them to build the runtime allowlist for the same verb. A manifest that passes
// one spelling and fails the other is a surface that installs and then cannot be opened, or worse an
// allowlist wider than the set of real surfaces.
//
// `scope !== 'project'` rather than `scope === 'task'`, and the difference is not stylistic. `scope`
// is defaulted to `'task'` by the schema, so the two agree on parsed input — but the client reads
// these off a ROSTER ROW, where the field is absent whenever the node that sent it predates the
// field. Only the negative spelling is correct before defaults are applied, so it is the one both
// sides use.
export const isTaskPaneSurface = (frame: { target: string; scope?: string }): boolean =>
  frame.target === 'webview' || (frame.target === 'pane' && frame.scope !== 'project')

/** The detail half of a rail source's browse: addressed by URL, never a slot in a task's layout. */
export const isProjectPaneSurface = (frame: { target: string; scope?: string }): boolean =>
  frame.target === 'pane' && frame.scope === 'project'

/** A full-screen picker the host places. Not a pane — it belongs to no task's layout. */
export const isOverlaySurface = (frame: { target: string }): boolean => frame.target === 'overlay'

// ── The wire projection (docs/plugins.md) ─────────────────────────────────────────────────────────
//
// What a plugin's manifest DECLARED, as it reaches a device inside a roster row. Not what is enforced:
// until loaded plugins move out of process the node block is context-shaping plus disclosure
// (docs/security.md § Design rules, rule 6), so every surface that renders this says "declared" and
// flips to "enforced" with no vocabulary change when the boundary lands.
//
// ── The rule for writing one of these ──────────────────────────────────────────────────────────────
//
// `z.infer` gives the shape AFTER a parse, where every default has been filled. A roster row is not
// that: it is bytes some node sent, and that node may be running a copy of this schema that predates a
// field. So two loosenings are applied deliberately, and the test for each is "could a node this shell
// still talks to have produced a row without it":
//
//   OPTIONAL where the field was ADDED to a shape that already shipped. `scope` and `claimsKeys` were
//     added to `frameSurface`; `triggerCharacters` was optional on the wire before this schema owned
//     the projection. A field that has existed since its shape was introduced stays required — every
//     node that can send the shape at all fills its default.
//   WIDER where the value is re-checked on arrival anyway. `languageId` is one of LANGUAGE_IDS after a
//     parse and a plain string here, because believing the narrow type of a value a node asserted is
//     the mistake this whole file exists to stop making.
//
// Getting this wrong is silent in both directions: too strict and the client dereferences something an
// older node never sent, too loose and every reader grows a `??` it does not need.
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
export type PluginFrameSurface = Omit<z.infer<typeof frameSurface>, 'scope' | 'claimsKeys' | 'layout'> & {
  scope?: 'task' | 'project'
  claimsKeys?: string[]
  layout?: PluginPaneLayout
}
export type PluginChromeAction = z.infer<typeof chromeAction>
// The verbs that need nothing from their click site. `createTask` depends on a selected rail row and
// `navigate` on a routed project, and a command registry row has neither in scope.
export type PluginCommandAction = z.infer<typeof contextFreeAction>
export type PluginSourceEmptyState = z.infer<typeof emptyStateDescriptor>
export type PluginSourceDescriptor = z.infer<typeof sourceDescriptor>
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

// Still loose on the wire as well as in the schema: a client that does not know a future sibling key
// should contribute less rather than fail to parse. Every list but `frames` is optional for the same
// reason the two frame fields above are — an older node's roster row will not carry it — and every
// reader uses `?? []`. The MEMBER types are derived, so a field added to a descriptor cannot go missing
// here; only a whole new contribution key is a two-line edit, and that is a decision, not a drift.
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
} & Record<string, unknown>

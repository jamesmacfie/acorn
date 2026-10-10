
// Where one plugin may open itself to another, and where a plugin may stand in for a core surface. A
// contract both sides read, for the same reason `contextMenus.ts` is one: the node has to reject a bad
// `extensionPoints`, `extensions` or `coreSlot` entry at parse time, the client has to re-check the same
// entry when it arrives inside a roster row, and the node cannot import the client.
//
// Two shapes, one file, because they are the two halves of one decision: what it means for a plugin's
// surface to be filled by somebody else's declaration.
//
//   cooperative  plugin A declares a point it hosts; plugin B declares items for it by id. Both sides
//                are in a manifest, both are visible at install time, and the host is the only thing
//                that carries a descriptor from one to the other.
//   exclusive    a plugin declares a replacement for a designated core surface. Registering seizes
//                nothing: the user picks the provider in settings and core is the fallback.
//
// What is refused belongs on the record next to what is offered: there is no uncooperative extension.
// Nothing here lets B alter A's UI or behaviour without A's declared consent, no DOM access into another
// realm, no patching another plugin's registrations, no reading another plugin's routes. A point that A
// did not declare simply has nothing delivered into it. See docs/plugins/cooperative-extension-points.md § Cooperative extension
// points and § There is no uncooperative extension.

// These host extension props are small portable projections. The full agent event and usage models
// belong to Agents; Protocol must not import a plugin contract.
export type AgentToolCardCall = {
  id: string
  parentId?: string
  /** Stable MCP tool name, separate from the provider’s display title. */
  name?: string
  title: string
  kind?: string
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown'
  input?: string
  output?: string
  outputAppend?: boolean
  paths?: string[]
  subagentId?: string
  web?: {
    action?:
      | { type: 'search'; queries: string[]; allowedDomains?: string[]; blockedDomains?: string[] }
      | { type: 'open_page'; url?: string }
      | { type: 'find_in_page'; url?: string; pattern?: string }
      | { type: 'fetch_page'; url?: string; prompt?: string }
      | { type: 'other' }
    results?: { url: string; title?: string; domain?: string; snippet?: string }[]
    status?: { code: number; text?: string }
  }
}

export type AgentHeaderUsage = {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
  contextUsed?: number
  contextSize?: number
  cost?: { amount: number; currency: string }
}

/**
 * What a point lets somebody else bring. Five kinds, one manifest key, the same four rules
 * (docs/plugins/cooperative-extension-points.md § Cooperative extension points).
 *
 *   rows        records the host draws with its own `Row`. Shipped first, and still the default.
 *   annotation  facts pinned to items the owner already draws: a mark on a diff line, a container.
 *   remote      a tree of kit nodes the contributor's sandbox renders into a slot of the owner's.
 *   rectangle   an iframe of the contributor's, drawn as a sibling region of the owner's pane.
 *   hook        a turn in one of the owner's decisions before it happens, node-side.
 *
 * `rows` is first so an absent `kind` reads as the kind every manifest written before this one meant.
 */
export const EXTENSION_POINT_KINDS = ['rows', 'annotation', 'remote', 'rectangle', 'hook'] as const

export type ExtensionPointKind = (typeof EXTENSION_POINT_KINDS)[number]

export const isExtensionPointKind = (value: unknown): value is ExtensionPointKind =>
  typeof value === 'string' && (EXTENSION_POINT_KINDS as readonly string[]).includes(value)

/**
 * Every place the host will draw a point's contributed items. See docs/plugins/cooperative-extension-points.md § Cooperative
 * extension points for the full argument; what each contributor may put there, and why position is
 * encoded in the name rather than in an orientation knob, are covered there.
 *
 * The two `inline` names are where a rectangle point puts somebody else's iframe: a sibling region of
 * the owner's pane, below it or beside it. Same rule as the layout template family — the name says
 * where, so there is nothing to get the wrong way round at runtime.
 */
export const EXTENSION_POINT_LOCATIONS = ['pane.footer', 'pane.aside', 'pane.inline-below', 'pane.inline-beside'] as const

/** Does this location take rows from other plugins, or panels from the user? One predicate rather than a
 *  second list, so a location added below cannot forget to answer the question. */
export const takesPluginExtensions = (location: ExtensionPointLocation): boolean => location === 'pane.footer'

/** Does this location hold somebody else's rectangle beside the owner's own? */
export const isInlineLocation = (location: ExtensionPointLocation): boolean =>
  location === 'pane.inline-below' || location === 'pane.inline-beside'

/** Which kinds hang off a named location of a named surface, and so must name both. An annotation
 *  draws at whichever site the owner registered in code, a remote slot is a node in the owner's own
 *  tree, and a hook draws nothing at all: none of the three has a location to name. */
export const kindNeedsLocation = (kind: ExtensionPointKind): boolean => kind === 'rows' || kind === 'rectangle'

/**
 * Who fills a box when more than one contributor could.
 *
 *   stack    the owner's default plus every match, up to the owner's `max`.
 *   replace  exactly one: the best match for the key the owner passed, else the owner's default.
 *
 * Applies to `remote` and `rectangle`. Rows already stack by construction, an annotation is a fact
 * rather than a seat, and a hook is a chain. See docs/plugins/cooperative-extension-points.md § Arbitration.
 */
export const ARBITRATION_MODES = ['stack', 'replace'] as const

export type ArbitrationMode = (typeof ARBITRATION_MODES)[number]

export type ExtensionPointLocation = (typeof EXTENSION_POINT_LOCATIONS)[number]

export const isExtensionPointLocation = (value: unknown): value is ExtensionPointLocation =>
  typeof value === 'string' && (EXTENSION_POINT_LOCATIONS as readonly string[]).includes(value)

// A point is addressed as `<ownerPluginId>:<pointId>`, so B's manifest names A out loud. The owner half
// is a plugin id and the point half is a contribution id; both alphabets are the manifest's own.
const POINT_REF_RE = /^([a-z][a-z0-9-]{1,31}):([a-z0-9][a-z0-9-]{0,63})$/

/** The id a point is known by everywhere outside its owner's manifest. Minted by the host from the
 *  plugin id, never read off a descriptor, the same rule a plugin theme's id and a content link's
 *  `providerId` follow, and for the same reason: a manifest that could state it could claim somebody
 *  else's. */
export const qualifiedExtensionPointId = (pluginId: string, pointId: string): string => `${pluginId}:${pointId}`

/** The owner and point halves of a reference, or `null` for anything that is not one. `null` is a no-op
 *  at every call site rather than an error: an unresolvable point is the same outcome as a point whose
 *  owner is not installed. */
export function parseExtensionPointRef(value: string): { owner: string; point: string } | null {
  const match = POINT_REF_RE.exec(value)
  return match ? { owner: match[1]!, point: match[2]! } : null
}

/**
 * Node-side points a loaded plugin must name in its manifest's `extensions` before it may file into
 * them, with the sentence the trust prompt shows for that grant. A node point otherwise has no manifest
 * form, so without this a plugin could reach one the owner never consented to. The copy is the host's,
 * fixed per point, and always high: each of these spends something of the owner's.
 */
export const DISCLOSED_NODE_POINTS: Readonly<Record<string, string>> = {
  'agents:session-messenger': 'Send notes to your agent sessions, which starts a turn on your agent provider',
  'agents:turn-follow-up': 'Review your workflow and delegated agents’ finished turns before they report, which can hold their results and add turns on your agent provider',
}

/**
 * One row a contribution's route answers with. Host-defined, like every other descriptor body: the host
 * is the one rendering these, so the shape is its contract and not the plugin's.
 *
 * Display strings only. There is no `action` here: the verb is declared once on the
 * contribution in the manifest, where the node can check it against that plugin's own surfaces, exactly
 * as a rail source's `onSelect` is. A per-item verb would be an unchecked action arriving over a route.
 */
export type PluginExtensionItem = {
  id: string
  title: string
  subtitle?: string
  // A Lucide name or a `brand:` mark, resolved client-side.
  icon?: string
  badge?: string
}

export type PluginExtensionItems = { items: PluginExtensionItem[] }

// ── The annotation half ───────────────────────────────────────────────────────────────────────────
//
// Rows answer "what is related to this pane". Annotations answer "what do you know about this line".
// The owner declares what its items are keyed by, the host collects the keys on screen and asks each
// contributor in one request, and the marks come back for the host to draw at the owner's site.

/** One item the owner draws, as the owner's declared key fields name it. Values are scalars because a
 *  key is a lookup, not a payload: `{ file: 'src/auth.ts', line: 42, side: 'new' }`. */
export type PluginAnnotationKey = Record<string, string | number>

export const ANNOTATION_SEVERITIES = ['info', 'warn', 'danger'] as const

export type AnnotationSeverity = (typeof ANNOTATION_SEVERITIES)[number]

export const isAnnotationSeverity = (value: unknown): value is AnnotationSeverity =>
  typeof value === 'string' && (ANNOTATION_SEVERITIES as readonly string[]).includes(value)

/**
 * One mark a contributor's route answers with. Host-defined for the same reason `PluginExtensionItem`
 * is: the host draws these, so the shape is its contract.
 *
 * Display strings only, and no verb per mark. What a click does is declared once on the contribution,
 * where the node can check it against that plugin's own surfaces.
 */
export type PluginAnnotationMark = {
  key: PluginAnnotationKey
  severity: AnnotationSeverity
  text: string
  // A Lucide name or a `brand:` mark, resolved client-side.
  icon?: string
}

/**
 * The most raw rows a host inspects from one annotation response.
 *
 * Diff annotation batches may legitimately cover 2,000 visible keys, so this generic transport
 * guard stays above that contract. Point owners may apply a smaller accepted-mark limit after each
 * row has been validated; `core:task` does so for its compact rail surface.
 */
export const MAX_RAW_ANNOTATION_ROWS = 4_096

export type PluginAnnotationMarks = { items: PluginAnnotationMark[] }

/**
 * One key as a lookup string, in the field order the owner declared.
 *
 * Minted from the owner's declared fields rather than from whatever keys a mark happens to carry, so a
 * contributor cannot widen its own match by inventing a field, and two marks agreeing on the declared
 * fields land on the same item however else they differ.
 */
export const annotationKeyOf = (fields: readonly string[], key: PluginAnnotationKey): string =>
  fields.map((field) => String(key[field] ?? '')).join('\0')

// ── The hook half ─────────────────────────────────────────────────────────────────────────────────
//
// A turn in a decision before it happens (docs/plugins/hooks.md § Hooks). Node-side: the owner declares the
// moment and what is allowed at it, contributors register a handler, the host runs the chain and hands
// the owner a verdict.

/** What a handler asks to do. The owner's `allows` is the subset it permits; a handler asking for a
 *  mode the owner did not list is never called. `ask` holds the decision for the person instead of
 *  refusing it outright, so only a point whose owner can put a question to somebody allows it. */
export const HOOK_MODES = ['observe', 'transform', 'veto', 'ask'] as const

export type HookMode = (typeof HOOK_MODES)[number]

export const isHookMode = (value: unknown): value is HookMode =>
  typeof value === 'string' && (HOOK_MODES as readonly string[]).includes(value)

/**
 * The vocabulary a payload is declared in — the tree's prop vocabulary, so a terminal or PWA client
 * sends and receives the same shapes as this one.
 *
 * Scalars and arrays of scalars, and nothing else. A transform's answer is checked against the same
 * declaration as its input, so a handler cannot turn a payload into something the owner never declared.
 */
export const HOOK_PAYLOAD_TYPES = ['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'] as const

export type HookPayloadType = (typeof HOOK_PAYLOAD_TYPES)[number]

/** `{ branch: 'string', commits: 'string[]' }`. */
export type HookPayloadShape = Record<string, HookPayloadType>

export type HookPayload = Record<string, unknown>

const matchesType = (type: HookPayloadType, value: unknown): boolean => {
  if (type.endsWith('[]')) {
    const member = type.slice(0, -2) as 'string' | 'number' | 'boolean'
    return Array.isArray(value) && value.every((entry) => typeof entry === member)
  }
  return typeof value === type
}

/**
 * Is this a payload the owner declared? Exact: every declared field present and of its type, and no
 * field the owner did not declare.
 *
 * Both halves matter. A missing field would reach the owner's own code as `undefined` where it had
 * declared a string; an extra one is a handler smuggling a value past the declaration the trust prompt
 * was written from. Either answer is "this is not a transform", which the runner records and ignores.
 */
export function matchesHookPayload(shape: HookPayloadShape, value: unknown): value is HookPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  const declared = Object.keys(shape)
  if (Object.keys(payload).length !== declared.length) return false
  return declared.every((field) => matchesType(shape[field]!, payload[field]))
}

/** What the owner gets back. `payload` is the value as the chain left it, transformed or not, so an
 *  owner has one thing to act on and never has to ask whether anybody changed anything. */
export type HookVerdict<T extends HookPayload = HookPayload> = {
  ok: boolean
  payload: T
  /** Display text from the vetoing handler, capped by the host. Absent when nothing objected. */
  reason?: string
  /** The contributing plugin, stamped by the host. Never read off a handler's answer. */
  by?: string
  /** Every reason, when the owner declared `collect`. `reason` and `by` are the first of these. */
  reasons?: { reason: string; by: string }[]
  /** The first `ask` handler that wants the person to decide, when nothing vetoed. The owner holds its
   *  decision until the person answers. */
  ask?: { reason: string; by: string }
}

/**
 * The hooks core itself owns, as opposed to the ones a plugin declares.
 *
 * Core has no manifest, so its points are named here and the runner treats this list as their
 * declaration. Same shape as `CORE_EXCLUSIVE_SLOTS` below and for the same reason: a designated list
 * a plugin may name but not extend.
 */
export const CORE_HOOK_POINTS = ['core:worktree-created', 'core:task-archiving', 'core:task-deleted', 'core:before-tool-call', 'core:before-snapshot'] as const

export type CoreHookPoint = (typeof CORE_HOOK_POINTS)[number]

export const isCoreHookPoint = (value: unknown): value is CoreHookPoint =>
  typeof value === 'string' && (CORE_HOOK_POINTS as readonly string[]).includes(value)

/**
 * The one annotation point core owns, and the reason it is here rather than in a manifest.
 *
 * A task row on the rail is an item core draws, and what another plugin knows about a task — a
 * deploy is live, an incident is open, a ticket moved — is a fact pinned to it. That is an
 * annotation, not a rail-specific contribution. docs/plugins/cooperative-extension-points.md
 * § Task annotations defines why one mechanism serves task rows and other keyed owner surfaces.
 *
 * Keyed by task id alone. A row is one task and there is nothing else to disambiguate.
 *
 * The rail is 52 pixels wide, so a mark is drawn as a status marker rather than as a line of text:
 * the icon takes a free corner and the words go in the hover legend (client-core
 * tasks/taskAnnotations.ts). That is the host's decision about its own surface, and it is why the
 * mark shape carries a severity and an icon and no geometry.
 */
export const CORE_TASK_POINT = 'core:task'

/** The field order `annotationKeyOf` mints `core:task` lookups in. One field, declared as a list for
 *  the same reason every other point's is: the order is the contract. */
export const CORE_TASK_KEY = ['task'] as const

/**
 * Core's annotation points for a rail source icon and a task pane button.
 *
 * Unlike `core:task`, these need the owner's consent: a source or task pane declares
 * `statusAnnotations: true`, and the host asks only about the consenting ones it is drawing. A
 * source's `projectId` is the routed project, or `''` for a source that is not project-scoped. The
 * Node is part of the host's batch identity and never a key field, so the same ids on two Nodes stay
 * apart. Drawn as rail markers, like `core:task` (client-core annotations/statusAnnotations.ts).
 */
export const CORE_SOURCE_POINT = 'core:source'

export const CORE_SOURCE_KEY = ['sourceId', 'projectId'] as const

export const CORE_PANE_POINT = 'core:pane'

export const CORE_PANE_KEY = ['paneId', 'taskId'] as const

// ── The exclusive half ────────────────────────────────────────────────────────────────────────────

/**
 * The core surfaces a plugin may offer to replace. See docs/plugins/replacing-core-surfaces.md § Replacing a core surface.
 *
 * One member, and it stays one until a second surface has both a reason and a fallback worth writing.
 */
export const CORE_EXCLUSIVE_SLOTS = ['rail.taskList', 'pane.switcher', 'rail', 'topbar'] as const

export type CoreExclusiveSlot = (typeof CORE_EXCLUSIVE_SLOTS)[number]

export const isCoreExclusiveSlot = (value: unknown): value is CoreExclusiveSlot =>
  typeof value === 'string' && (CORE_EXCLUSIVE_SLOTS as readonly string[]).includes(value)

/** What the user's arbitration means. `core` is not merely the default: it is the answer a slot falls
 *  back to whenever the chosen provider is absent, disabled, untrusted or has thrown. */
export const CORE_SLOT_PROVIDER = 'core'

// ── The remote half ───────────────────────────────────────────────────────────────────────────────
//
// Phase 3 shipped one hard-coded target, `agentToolRenderer`, so the worker and the tree renderer
// could be proven on a real surface. There is no target list any more: a remote contribution names a
// point like every other kind, and the agents transcript's tool card is `agents:tool-card`, an
// ordinary `remote` point in `replace` mode keyed by tool name.

/** The first remote points, named here only so the host's own consumers can say them out loud without
 *  a literal per call site. A plugin's point never appears in this list; it is minted from its
 *  manifest like any other. */
export const AGENT_TOOL_CARD_POINT = 'agents:tool-card'

/** A section on Settings > Storage and memory. A core-owned `remote` point in `stack` mode, so a plugin
 *  that holds memory or disk on the node shows its own numbers on that page beside core's. The page is
 *  core's and the numbers are the plugin's, which is why it is a point rather than a page of either.
 *  A contributor gets `nodeId`, the node the page is showing. */
export const CORE_STORAGE_POINT = 'core:storage'

/** A section on Settings > Security and backup, shaped like `core:storage`: a plugin draws the switch
 *  for a check it runs on the node. Agents draws its instruction file check. A contributor gets `nodeId`. */
export const CORE_SECURITY_POINT = 'core:security'

/** A section on one plugin's page in Settings > Plugins, a core-owned `remote` point in `stack` mode, so
 *  a plugin that another plugin's contributions reach into can say what they reach. Agents uses it to show
 *  which harnesses a plugin's tool hooks cover. A contributor gets `pluginId`, the plugin the page shows,
 *  and `nodeId`, the node it is shown for. */
export const CORE_PLUGIN_PAGE_POINT = 'core:plugin-page'

/**
 * Where a loaded owner may mount one of its own `remote` points: above or below one of its own detail
 * views, outside the owner's tree (docs/plugins/detail-regions.md). The host draws both, so a worker
 * never opens a slot inside another worker's tree.
 */
export const DETAIL_REGIONS = ['header', 'footer'] as const

export type DetailRegion = (typeof DETAIL_REGIONS)[number]

/** How many placements one point's `mounts` may list. */
export const MAX_DETAIL_MOUNTS = 8

/** What a contributor in a detail region is mounted with. `item` is the resource the owning surface
 *  is showing, and `refId` is set on a reference panel, where it is the same reference. No provider
 *  facts and no grants: a contributor reads its own data through its own routes. */
export type DetailRegionProps = {
  taskId?: string
  projectId?: string
  item?: string
  refId?: string
  /** The owner's surface id, so one contributor can tell a project view from a reference panel. */
  surface: string
}

/** What a contributor to `agents:tool-card` is handed. JSON, because the same props reach a compiled
 *  component in this realm and a worker's tree over a port, and the two must be handed the same thing.
 *  That is why there is no "the reader toggled me" callback here: `defaultOpen` seeds the disclosure
 *  and the owner's own card is the one that teaches the setting. */
export type AgentToolCardProps = {
  tool: AgentToolCardCall
  taskId: string
  /** Recorded changes made by this call, matched by turn and tool id. These are historical patches,
   *  independent of the working tree the Changes pane reads. */
  fileChanges?: readonly AgentToolFileChange[]
  /** Whether this card's disclosure should start open, resolved from the reader's setting. Seed a
   *  signal with it and leave it alone: read reactively, it would shut a card the moment its call
   *  finished, which is when somebody is most likely to be reading it. */
  defaultOpen: boolean
}

export type AgentToolFileChange = {
  path: string
  patch?: string
  /** Excerpt coordinates are not file line numbers. */
  snippet?: boolean
  /** Oversized patches remain available as artifacts rather than inline text. */
  patchArtifactId?: string
}

/** Room in the agent composer's own action bar, beside Attach and the two pickers. A `stack` point,
 *  because "everyone with something to offer this draft" is a real answer for a toolbar. */
export const AGENT_COMPOSER_ACTIONS_POINT = 'agents:composer-actions'

/** A note inside a request card that is waiting on the person, below the card's own controls. A
 *  `stack` point, up to two. It decorates the card and never replaces it: no contributor draws or
 *  presses the answer, so approval stays with the person (docs/plugins/remote-points.md). */
export const AGENT_REQUEST_CARD_POINT = 'agents:request-card'

export type AgentRequestCardProps = {
  taskId: string
  sessionId: string
  /** The provider's request id, the one `agents.requests` and `agents:before-permission` name. */
  requestId: string
  kind: string
  title: string
}

/** A compact contribution immediately after the managed session title. Agents projects its private
 *  ledger into these bounded, JSON-safe facts; contributors decide what those facts mean and draw.
 *  This is intentionally not a cost contract: a token counter, budget warning or provider badge can
 *  consume the same point without inheriting another contributor's product decision. */
export const AGENT_SESSION_HEADER_POINT = 'agents:session-header'

export type AgentSessionTokenPrice = {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export type AgentSessionHeaderTurn = {
  turnId: string
  model: string | null
  usage: AgentHeaderUsage
  /** The owner's configured USD price per million tokens for this turn's model. `null` keeps an
   *  unknown or privately-priced model explicit instead of turning it into a plausible zero. */
  price: AgentSessionTokenPrice | null
}

export type AgentSessionHeaderProps = {
  taskId: string
  sessionId: string
  providerId: string
  /** Whether each turn's counters stand alone or include all preceding turns in the session. */
  tokenAccounting: 'per-turn' | 'cumulative'
  /** Whether successive provider cost reports stand alone or replace the previous session total. */
  costAccounting: 'per-turn' | 'cumulative'
  turns: AgentSessionHeaderTurn[]
}

/** How one attachment on an unsent turn is drawn, keyed by its media type. `replace`, because a chip
 *  is one thing and two plugins drawing the same file would be two chips for one attachment. */
export const AGENT_ATTACHMENT_POINT = 'agents:attachment'

/** Another plugin's view of the file open in the editor, keyed by the file's lowercased basename
 *  (`readme.md`, `*.csv`, `dockerfile`). `replace`, because the document area holds one view; the
 *  editor's own text or image view is the default and stays one Source toggle away
 *  (docs/editor/file-renderers.md). */
export const EDITOR_DOCUMENT_POINT = 'editor:document'

export type EditorDocumentProps = {
  taskId: string
  /** The worktree-relative path the editor reads. Pass it back unchanged to `editor.files`. */
  path: string
  /** The editor's buffer when the file is UTF-8 text, which can include unsaved edits. Absent for a
   *  binary file or a failed read. */
  text?: string
  /** Rises each time this document is handed over again: a disk change, a focus reread, or a return
   *  from Source. Work started for a lower revision is stale. */
  revision: number
}

/** A preview of an HTTPS link in rendered content: an agent's reply, a pull request body, a link in a
 *  plugin's tree. Core owns it because the links live in everybody's content. `replace`, keyed by the
 *  URL `linkPreviewKey` returns, so `matches: ["https://docs.example.com/*"]` claims one site. With no
 *  contributor the host draws the label, the URL and Open, and fetches nothing
 *  (docs/plugins/link-previews.md § Link previews). */
export const CORE_LINK_PREVIEW_POINT = 'core:link-preview'

export type LinkPreviewProps = {
  /** The normalized URL, the same string the point is keyed by. */
  url: string
  /** The link's text, when it has any. */
  label?: string
  taskId?: string
  projectId?: string
  /** What an in-app recogniser already made of the URL, such as `{ kind: 'linear.issue', id: 'ENG-1' }`.
   *  Never provider HTML. */
  ref?: { kind: string; id: string }
}

export const MAX_LINK_PREVIEW_URL = 4_096

/**
 * The key a link previews under, or `null` for a link that gets no preview.
 *
 * `URL` parsing only: the host is lowercased and the path, query and fragment are kept as written.
 * Removing tracking parameters or following redirects would be the host guessing what a site means.
 * A URL carrying a user name or password never previews, so a contributor is never handed one.
 */
export function linkPreviewKey(href: string): string | null {
  if (href.length > MAX_LINK_PREVIEW_URL) return null
  try {
    const url = new URL(href)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    return url.href.length > MAX_LINK_PREVIEW_URL ? null : url.href
  } catch {
    return null
  }
}

/** A viewer for a completed code fence in host-owned Markdown: an agent's reply, or a loaded pane's own
 *  `Markdown` node. Core owns it because the fences live in everybody's content. `replace`, keyed by
 *  the fence's lowercased language hint (`json`, `csv`). The owner keeps Source, Preview and Copy
 *  outside the viewer, and a fence with no hint, an unfinished one, or one over
 *  `MAX_MARKDOWN_FENCE_BYTES` is drawn as source (docs/plugins/markdown-fences.md). */
export const CORE_MARKDOWN_FENCE_POINT = 'core:markdown-fence'

export type MarkdownFenceProps = {
  /** This fence's identity in its owner. A fence whose text changes is a new block with a new id. */
  blockId: string
  /** The hint as written, case kept. The key is its lowercase. */
  language: string
  /** The fence's source, without its opening and closing lines. */
  text: string
  /** The owner's render count when this block appeared. A later block in the same owner has a higher one. */
  revision: number
  taskId?: string
  projectId?: string
}

export const MAX_MARKDOWN_FENCE_BYTES = 256 * 1024

/** The key a fence is viewed under, or `null` for a fence that gets no viewer: no hint, or text over
 *  the cap in UTF-8. */
export function markdownFenceKey(fence: { language: string; text: string }): string | null {
  if (!fence.language) return null
  // A UTF-16 unit is at most three UTF-8 bytes, so most fences skip the encoder.
  if (fence.text.length * 3 > MAX_MARKDOWN_FENCE_BYTES
    && new TextEncoder().encode(fence.text).length > MAX_MARKDOWN_FENCE_BYTES) return null
  return fence.language.toLowerCase()
}

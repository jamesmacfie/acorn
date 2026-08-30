
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
// did not declare simply has nothing delivered into it. See docs/plugins.md § Cooperative extension
// points and § There is no uncooperative extension.

import type { AgentToolCall } from './managedAgents'

/**
 * What a point lets somebody else bring. Five kinds, one manifest key, the same four rules
 * (docs/plugins.md § Cooperative extension points).
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
 * Every place the host will draw a point's contributed items. See docs/plugins.md § Cooperative
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
 * rather than a seat, and a hook is a chain. See docs/plugins.md § Arbitration.
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
// A turn in a decision before it happens (docs/plugins.md § Hooks). Node-side: the owner declares the
// moment and what is allowed at it, contributors register a handler, the host runs the chain and hands
// the owner a verdict.

/** What a handler asks to do. The owner's `allows` is the subset it permits; a handler asking for a
 *  mode the owner did not list is never called. */
export const HOOK_MODES = ['observe', 'transform', 'veto'] as const

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
}

/**
 * The hooks core itself owns, as opposed to the ones a plugin declares.
 *
 * Core has no manifest, so its points are named here and the runner treats this list as their
 * declaration. Same shape as `CORE_EXCLUSIVE_SLOTS` below and for the same reason: a designated list
 * a plugin may name but not extend.
 */
export const CORE_HOOK_POINTS = ['core:worktree-created', 'core:before-tool-call', 'core:before-snapshot'] as const

export type CoreHookPoint = (typeof CORE_HOOK_POINTS)[number]

export const isCoreHookPoint = (value: unknown): value is CoreHookPoint =>
  typeof value === 'string' && (CORE_HOOK_POINTS as readonly string[]).includes(value)

/**
 * The one annotation point core owns, and the reason it is here rather than in a manifest.
 *
 * A task row on the rail is an item core draws, and what another plugin knows about a task — a
 * deploy is live, an incident is open, a ticket moved — is a fact pinned to it. That is an
 * annotation, not a rail-specific contribution: docs/future/rail-tab.md § Slice 3 says why one
 * mechanism serves a rail row, a diff line and an editor gutter, and why three would not.
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

// ── The exclusive half ────────────────────────────────────────────────────────────────────────────

/**
 * The core surfaces a plugin may offer to replace. See docs/plugins.md § Replacing a core surface.
 *
 * One member, and it stays one until a second surface has both a reason and a fallback worth writing.
 */
export const CORE_EXCLUSIVE_SLOTS = ['rail.taskList'] as const

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

/** What a contributor to `agents:tool-card` is handed. JSON, because the same props reach a compiled
 *  component in this realm and a worker's tree over a port, and the two must be handed the same thing.
 *  That is why there is no "the reader toggled me" callback here: `defaultOpen` seeds the disclosure
 *  and the owner's own card is the one that teaches the setting. */
export type AgentToolCardProps = {
  tool: AgentToolCall
  taskId: string
  /** Whether this card's disclosure should start open, resolved from the reader's setting. Seed a
   *  signal with it and leave it alone: read reactively, it would shut a card the moment its call
   *  finished, which is when somebody is most likely to be reading it. */
  defaultOpen: boolean
}

/** Room in the agent composer's own action bar, beside Attach and the two pickers. A `stack` point,
 *  because "everyone with something to offer this draft" is a real answer for a toolbar. */
export const AGENT_COMPOSER_ACTIONS_POINT = 'agents:composer-actions'

/** How one attachment on an unsent turn is drawn, keyed by its media type. `replace`, because a chip
 *  is one thing and two plugins drawing the same file would be two chips for one attachment. */
export const AGENT_ATTACHMENT_POINT = 'agents:attachment'

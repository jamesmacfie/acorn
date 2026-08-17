// Where one plugin may open itself to another, and where a plugin may stand in for a core surface — a
// contract both sides read, for the same reason `contextMenus.ts` is one: the node has to reject a bad
// `extensionPoints` / `extensions` / `coreSlot` entry at parse time, the client has to re-check the same
// entry when it arrives inside a roster row, and the node cannot import the client.
//
// TWO SHAPES, ONE FILE, because they are the two halves of one decision: what it means for a plugin's
// surface to be filled by somebody else's declaration.
//
//   COOPERATIVE  plugin A declares a point it HOSTS; plugin B declares items for it BY ID. Both sides are
//                in a manifest, both are visible at install time, and the host is the only thing that
//                carries a descriptor from one to the other.
//   EXCLUSIVE    a plugin declares a replacement for a designated CORE surface. Registering seizes
//                nothing — the user picks the provider in settings and core is the fallback.
//
// WHAT IS REFUSED, and it belongs on the record next to what is offered: there is no uncooperative
// extension. Nothing here lets B alter A's UI or behaviour without A's declared consent — no DOM access
// into another realm, no patching another plugin's registrations, no reading another plugin's routes. A
// point that A did not declare simply has nothing delivered into it. If a real need surfaces that these
// descriptors cannot express, the answer is to widen the descriptor vocabulary, not to open the realm.

// ── The cooperative half ──────────────────────────────────────────────────────────────────────────

/**
 * Every place the host will draw a point's contributed items.
 *
 * THE VOCABULARY GROWS WITH ITS HOSTS, never ahead of them — the same rule the context-menu location
 * list and the manifest slot enum follow. A location listed here that no surface actually renders would
 * be a contribution that parses and then silently never appears.
 *
 * `pane.footer` is a strip the HOST draws underneath a plugin pane's frame. That placement is the whole
 * argument for the seam: the pane above it is a sandboxed document owned by A, the strip below it is the
 * host's own markup drawn from B's descriptor, and no code crosses between them in either direction.
 *
 * `pane.aside` is a COLUMN beside that frame, and it is the same seam with THE USER in the contributor's
 * seat: what the host draws there is a dashboard the person composed, under constraints the owner
 * declared (docs/future/dashboards/placements.md). It is a location rather than a parallel mechanism
 * because every word of the footer's contract already holds — two-sided, declarative, host-mediated —
 * and only the identity of the contributor changes.
 *
 * POSITION IS ENCODED IN THE NAME, the same rule the frame `layout` template family follows: an
 * `orientation` field alongside a single location would imply the other values exist, which is the first
 * knob of a layout language. A second position lands with its consumer.
 *
 * Which side takes which contributor is not a knob either: a plugin's `extensions` are delivered into
 * footers only. An `extensions` entry aimed at an aside draws nothing, which is the same silent nothing
 * every unmatched contribution already gets.
 */
export const EXTENSION_POINT_LOCATIONS = ['pane.footer', 'pane.aside'] as const

/** Does this location take rows from OTHER PLUGINS, or panels from the user? One predicate rather than a
 *  second list, so a location added below cannot forget to answer the question. */
export const takesPluginExtensions = (location: ExtensionPointLocation): boolean => location === 'pane.footer'

export type ExtensionPointLocation = (typeof EXTENSION_POINT_LOCATIONS)[number]

export const isExtensionPointLocation = (value: unknown): value is ExtensionPointLocation =>
  typeof value === 'string' && (EXTENSION_POINT_LOCATIONS as readonly string[]).includes(value)

// A point is addressed as `<ownerPluginId>:<pointId>`, so B's manifest names A out loud. The owner half
// is a plugin id and the point half is a contribution id; both alphabets are the manifest's own.
const POINT_REF_RE = /^([a-z][a-z0-9-]{1,31}):([a-z0-9][a-z0-9-]{0,63})$/

/** The id a point is known by everywhere outside its owner's manifest. Minted by the HOST from the
 *  plugin id, never read off a descriptor — the same rule a plugin theme's id and a content link's
 *  `providerId` follow, and for the same reason: a manifest that could state it could claim somebody
 *  else's. */
export const qualifiedExtensionPointId = (pluginId: string, pointId: string): string => `${pluginId}:${pointId}`

/** The owner and point halves of a reference, or `null` for anything that is not one. `null` is a
 *  no-op at every call site rather than an error: an unresolvable point is the same outcome as a point
 *  whose owner is not installed. */
export function parseExtensionPointRef(value: string): { owner: string; point: string } | null {
  const match = POINT_REF_RE.exec(value)
  return match ? { owner: match[1]!, point: match[2]! } : null
}

/**
 * One row a contribution's route answers with. HOST-defined, like every other descriptor body: the host
 * is the one rendering these, so the shape is its contract and not the plugin's.
 *
 * Display strings only. There is no `action` here on purpose — the verb is declared ONCE on the
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

// ── The exclusive half ────────────────────────────────────────────────────────────────────────────

/**
 * The core surfaces a plugin may offer to replace.
 *
 * ONE MEMBER, and it stays one until a second surface has both a reason and a fallback worth writing.
 * The same rule the location list above states: a designated slot with no host is a claim that parses
 * and never lands. `rail.taskList` is the tab rail's list of open tasks — the surface bb's own exclusive
 * slot replaces, and the one where "I want a different list" is a thing people actually say.
 */
export const CORE_EXCLUSIVE_SLOTS = ['rail.taskList'] as const

export type CoreExclusiveSlot = (typeof CORE_EXCLUSIVE_SLOTS)[number]

export const isCoreExclusiveSlot = (value: unknown): value is CoreExclusiveSlot =>
  typeof value === 'string' && (CORE_EXCLUSIVE_SLOTS as readonly string[]).includes(value)

/** What the user's arbitration means. `core` is not merely the default — it is the answer a slot falls
 *  back to whenever the chosen provider is absent, disabled, untrusted or has thrown. */
export const CORE_SLOT_PROVIDER = 'core'

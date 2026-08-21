
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

/**
 * Every place the host will draw a point's contributed items. See docs/plugins.md § Cooperative
 * extension points for the full argument; `pane.footer` and `pane.aside`, what each contributor may put
 * there, and why position is encoded in the name are all covered there.
 */
export const EXTENSION_POINT_LOCATIONS = ['pane.footer', 'pane.aside'] as const

/** Does this location take rows from other plugins, or panels from the user? One predicate rather than a
 *  second list, so a location added below cannot forget to answer the question. */
export const takesPluginExtensions = (location: ExtensionPointLocation): boolean => location === 'pane.footer'

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

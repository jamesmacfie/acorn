// The cooperative cross-plugin seam: plugin A opens a point, plugin B fills it, and the HOST is the only
// thing that carries anything between them (@acorn/protocol/extensionPoints.ts holds the vocabulary).
//
// JSX-free on purpose, exactly as ./slots.ts and ./contextMenus.ts are: the host that draws these lives
// in plugins/chrome/ExtensionPointHost.tsx, and this repo's vitest runs in a bare Node environment with
// no Solid transform, so a module that reaches a JSX file cannot be imported by a test at all. Everything
// worth pinning — the two-registry split, the resolution rule, the gates, the ordering — is therefore
// here, and the `.tsx` is a `<For>` over `extensionDeliveries()`.
//
// TWO REGISTRIES, NOT ONE, and that is the whole mechanism rather than tidiness. A point and a
// contribution to it come from two DIFFERENT manifests, registered by two independent passes in an order
// nobody controls — B's plugin id may sort before A's, A may be installed on a node B is not, A may be
// removed while B stays. So a contribution never looks its point up at registration time and never fails
// when the point is missing. It registers, and DELIVERY is resolved at read time.
//
// That is what makes the required behaviour fall out instead of being coded: a contribution to a point
// that does not exist — because A is not installed, is disabled on this node, was never trusted, or
// dropped the point in an update — delivers nothing, silently, with no error and nothing to crash.
import {
  parseExtensionPointRef,
  takesPluginExtensions,
  type ExtensionPointLocation,
  type PluginExtensionItem,
} from '@acorn/protocol/extensionPoints.ts'
import { Registry } from './registry'

export type { ExtensionPointLocation }

/** A point plugin A hosts. `id` is the QUALIFIED `<ownerId>:<pointId>` the host minted; nothing else in
 *  the app addresses a point by any other name. */
export type ExtensionPointContribution = {
  id: string
  /** The plugin that opened the point. Stamped by the host from the manifest it read, never from a
   *  descriptor field — the same rule a content link's `providerId` follows. */
  ownerId: string
  label: string
  location: ExtensionPointLocation
  /** The owner's own surface the strip hangs off. */
  surface: string
  /** Is the owning plugin running on the node being looked at? A point whose owner is not there has no
   *  surface on screen, so it has nothing to deliver into. */
  when?: () => boolean
}

/** One plugin's rows for one point. `fetch` and `run` are closures the chrome pass built over a route
 *  and a verb; nothing a plugin wrote reaches this registry as code. */
export type ExtensionContribution = {
  id: string
  /** The CONTRIBUTING plugin. Provenance, stamped host-side and rendered beside the rows, so a group of
   *  items inside somebody else's pane always says whose they are. */
  pluginId: string
  /** The qualified point this fills. */
  point: string
  label: string
  order: number
  when?: () => boolean
  fetch: (signal: AbortSignal) => Promise<PluginExtensionItem[]>
  /** Absent when the contribution declared no verb — a read-only list, which is a real answer. */
  run?: (item: PluginExtensionItem) => void
}

export const extensionPointRegistry = new Registry<ExtensionPointContribution>('extension-point')
export const extensionRegistry = new Registry<ExtensionContribution>('extension')

/** The point drawn at this location of this plugin's surface, or `undefined`. Keyed on all three because
 *  `surface` ids are un-namespaced across plugins by design. */
export const extensionPointFor = (
  ownerId: string,
  surface: string,
  location: ExtensionPointLocation,
): ExtensionPointContribution | undefined =>
  extensionPointRegistry.entries().find((point) =>
    point.ownerId === ownerId && point.surface === surface && point.location === location)

/**
 * What the host should draw in this point right now, in declared order.
 *
 * The EMPTY ANSWER is the interesting one, and there are five ways to get it — the point was never
 * registered, its owner is not running on the node being looked at, no plugin contributes to it, the
 * contributors are not running either, or the point's location does not take plugin rows at all. All
 * five are the same silent nothing, because every one of them means the same thing: there is nobody on
 * both ends of this pipe today.
 *
 * That last one is `pane.aside`, whose contributor is THE USER: the host draws a panel region there
 * rather than descriptor rows (dashboards/region.ts). Nothing renders an aside through this function
 * today, so the guard is belt to the braces — but "who may fill this location" is a property of the
 * location, and this is the one place it can be stated where a test can reach it.
 *
 * Ties break on id so two contributions at the same order are stable rather than dependent on plugin
 * registration sequence — the same rule the slot hosts and the context menu apply.
 */
export function extensionDeliveries(pointId: string): ExtensionContribution[] {
  const point = extensionPointRegistry.get(pointId)
  if (!point || !takesPluginExtensions(point.location) || !(point.when?.() ?? true)) return []
  return extensionRegistry.entries()
    .filter((entry) => entry.point === pointId && (entry.when?.() ?? true))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** Which packages a plugin's manifest says it reaches into, for the disclosure surfaces. `null` refs are
 *  dropped rather than reported: the node refused them at parse and the client re-checks, so anything
 *  unparseable here is already a contribution that will never deliver. */
export const extensionPointOwners = (points: readonly { point: string }[]): string[] =>
  [...new Set(points.flatMap((entry) => {
    const ref = parseExtensionPointRef(entry.point)
    return ref ? [ref.owner] : []
  }))].sort()

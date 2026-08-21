// The cooperative cross-plugin seam: plugin A opens a point, plugin B fills it, and the host is the
// only thing that carries anything between them (docs/plugins.md § Cooperative extension points).
//
// This module holds no JSX import (docs/frontend.md § Registries and plugins): the host that draws
// these deliveries lives in `plugins/chrome/ExtensionPointHost.tsx`, a `<For>` over
// `extensionDeliveries()`.
import {
  parseExtensionPointRef,
  takesPluginExtensions,
  type ExtensionPointLocation,
  type PluginExtensionItem,
} from '@acorn/protocol/extensionPoints.ts'
import { Registry } from './registry'

export type { ExtensionPointLocation }

/** A point plugin A hosts. `id` is the qualified `<ownerId>:<pointId>` the host minted
 *  (docs/plugins.md § Cooperative extension points); nothing else in the app addresses a point by any
 *  other name. */
export type ExtensionPointContribution = {
  id: string
  /** The plugin that opened the point, stamped by the host (docs/plugins.md § Cooperative extension
   *  points). */
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
  /** The contributing plugin, stamped host-side and rendered beside the rows (docs/plugins.md §
   *  Cooperative extension points, "what the host binds"). */
  pluginId: string
  /** The qualified point this fills. */
  point: string
  label: string
  order: number
  when?: () => boolean
  fetch: (signal: AbortSignal) => Promise<PluginExtensionItem[]>
  /** Absent when the contribution declared no verb, a read-only list, which is a real answer. */
  run?: (item: PluginExtensionItem) => void
}

export const extensionPointRegistry = new Registry<ExtensionPointContribution>('extension-point')
export const extensionRegistry = new Registry<ExtensionContribution>('extension')

/** The point drawn at this location of this plugin's surface, or `undefined`. Keyed on all three
 *  because `surface` ids are un-namespaced across plugins. */
export const extensionPointFor = (
  ownerId: string,
  surface: string,
  location: ExtensionPointLocation,
): ExtensionPointContribution | undefined =>
  extensionPointRegistry.entries().find((point) =>
    point.ownerId === ownerId && point.surface === surface && point.location === location)

/**
/**
 * What the host should draw in this point right now, in declared order
 * (docs/plugins.md § Cooperative extension points, "an unmatched contribution is silent").
 *
 * `pane.aside` is the one location filled by the user rather than by a plugin's `extensions`
 * (dashboards/region.ts). Nothing renders an aside through this function today; "who may fill this
 * location" is a property of the location, and this is the one place it can be stated where a test
 * can reach it.
 *
 * Ties break on id so two contributions at the same order are stable rather than dependent on plugin
 * registration sequence, the same rule the slot hosts and the context menu apply.
 */
export function extensionDeliveries(pointId: string): ExtensionContribution[] {
  const point = extensionPointRegistry.get(pointId)
  if (!point || !takesPluginExtensions(point.location) || !(point.when?.() ?? true)) return []
  return extensionRegistry.entries()
    .filter((entry) => entry.point === pointId && (entry.when?.() ?? true))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** Which packages a plugin's manifest says it reaches into, for the disclosure surfaces. `null` refs
 *  are dropped rather than reported: the node refused them at parse and the client re-checks, so
 *  anything unparseable here is already a contribution that will never deliver. */
export const extensionPointOwners = (points: readonly { point: string }[]): string[] =>
  [...new Set(points.flatMap((entry) => {
    const ref = parseExtensionPointRef(entry.point)
    return ref ? [ref.owner] : []
  }))].sort()

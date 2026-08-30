// The node-side twin of the client's extension points
// (packages/client-core/src/host/registries/extensionPoints/extensionPoints.ts, docs/plugins.md § Cooperative extension
// points), and the node's only many-to-many seam between plugins.
//
// Capabilities are the other one and they are deliberately single-provider: one named typed function,
// one owner, a duplicate is a programming error. That is the wrong shape for "many plugins each add a
// workflow step kind", and every private registry a plugin hand-rolls to get around it gets the
// lifecycle slightly different (2026-08-27 extensibility review, finding 4).
//
// Same rules as the client's: the owner declares a point in its own namespace, contributions are
// ordered, a plugin cannot file two entries under one id, and everything goes when the plugin does.
//
// Reached only through `ctx.extensionPoints`. A loaded plugin's bundle inlines every @acorn/* import
// it makes, so a plugin that imported this module directly would get its own private copy of the maps
// below and contribute into nothing.
import { parseExtensionPointRef } from '@acorn/protocol/extensionPoints.ts'
import type { Disposable } from './capabilities'

// The id and its brand live in @acorn/protocol so a plugin's contract/ can mint one without importing
// this package. The owner's contract/ entrypoint exports the constant, and that is the only thing a
// contributor imports.
import { type ExtensionPointId } from '@acorn/protocol/pluginIds.ts'
export { extensionPointId, type ExtensionPointId } from '@acorn/protocol/pluginIds.ts'

export type ExtensionPoint = {
  id: string
  ownerId: string
  label: string
}

export type Extension<T> = {
  /** `<pluginId>:<entryId>`, minted here from the contributing plugin. */
  id: string
  pluginId: string
  order: number
  value: T
}

// Module singletons, like the route, tool, collection and node-action registries beside them, with the
// same lifecycle answer: the host clears a plugin's entries before re-registering them
// (./host.ts § clearRegistrations).
const points = new Map<string, ExtensionPoint>()
const extensions = new Map<string, Extension<unknown>[]>()

/** Declare a point this plugin hosts. `ownerId` is bound by the host, never passed by the plugin. */
export function openExtensionPoint(ownerId: string, id: ExtensionPointId<unknown>, label: string): Disposable {
  const ref = parseExtensionPointRef(id)
  if (!ref) throw new Error(`Extension point '${id}' is not a '<pluginId>:<pointId>' id.`)
  if (ref.owner !== ownerId) throw new Error(`Plugin '${ownerId}' may only open points under '${ownerId}:', not '${id}'.`)
  if (points.has(id)) throw new Error(`Extension point already open: ${id}`)
  points.set(id, { id, ownerId, label })
  return { dispose: () => void points.delete(id) }
}

/** Contribute one entry to somebody else's point (or your own). Registering before the point is open
 *  is fine and expected: plugin init order is not a dependency contract, so the entry simply waits and
 *  is read once the owner declares the point. */
export function contributeExtension<T>(
  pluginId: string,
  point: ExtensionPointId<T>,
  entry: { id: string; order?: number; value: T },
): Disposable {
  const id = `${pluginId}:${entry.id}`
  const list = extensions.get(point) ?? []
  if (list.some((existing) => existing.id === id)) throw new Error(`Duplicate extension '${id}' on point '${point}'.`)
  const contribution: Extension<unknown> = { id, pluginId, order: entry.order ?? 0, value: entry.value }
  extensions.set(point, [...list, contribution])
  return {
    dispose: () => {
      const current = extensions.get(point)
      if (current) extensions.set(point, current.filter((existing) => existing !== contribution))
    },
  }
}

/** What the owner should act on right now, in declared order. Ties break on id, so two entries at the
 *  same order are stable rather than dependent on plugin init sequence — same rule as the client's
 *  deliveries. An unopened point reads as empty: a contribution nobody declared a point for has no
 *  owner to hand it to. */
export function extensionsFor<T>(point: ExtensionPointId<T>): Extension<T>[] {
  if (!points.has(point)) return []
  return [...(extensions.get(point) ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) as Extension<T>[]
}

/** Every point open on this node, for the disclosure surfaces and for tests. */
export const openExtensionPoints = (): ExtensionPoint[] => [...points.values()].sort((a, b) => a.id.localeCompare(b.id))

/** Drop everything this plugin opened and everything it contributed. Both halves, because a plugin
 *  that goes away leaves neither a point nothing owns nor an entry nothing can dispose. */
export function clearExtensionPoints(pluginId: string): void {
  for (const [id, point] of points) if (point.ownerId === pluginId) points.delete(id)
  for (const [point, list] of extensions) {
    const kept = list.filter((entry) => entry.pluginId !== pluginId)
    if (kept.length) extensions.set(point, kept)
    else extensions.delete(point)
  }
}

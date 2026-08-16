import type { PluginCollectionSchema } from '@acorn/protocol/collections.ts'
import { viewsForSchema, type PanelViewKind } from './model'

// The derivations behind the add/remove/reorder chrome (docs/dashboards.md § On Home).
// Everything here is pure and takes its inputs as arguments rather than reading the
// registry or the store, because the components that use it cannot be rendered in a test — vitest
// runs in node with no Solid plugin — so this is where the parts that can actually be wrong live.

/** The picker's identity for a collection. `(pluginId, collectionId)` is how the world addresses one;
 *  a registry's own `id` is a host-minted convenience.
 *
 *  Spelled STRUCTURALLY rather than as a `Pick` of the client registry's contribution type, because
 *  this package sits below both runtimes and cannot name a client registry. Every call site still
 *  passes the real contribution — these three strings are the same by construction, and the registry
 *  is where they are minted. */
type CollectionRef = { pluginId: string; collectionId: string; name: string }

/** The other half of the registry's shape this file reads: the static schema promise, absent for a
 *  collection that only describes itself in its answer. */
type CollectionSchemaRef = { schema?: PluginCollectionSchema }

/** A collection that declares no static schema describes itself in its answer, so there is nothing to
 *  gate a view on before the first read. An empty schema is the honest stand-in rather than a special
 *  case: every gate that asks a question of the fields answers no, and only the views that ask
 *  nothing are offered — which is exactly the promise the editor makes. */
const EMPTY_SCHEMA: PluginCollectionSchema = { fields: [] }

export const viewsForCollection = (entry: CollectionSchemaRef): PanelViewKind[] =>
  viewsForSchema(entry.schema ?? EMPTY_SCHEMA)

/** The view to preselect when a collection is chosen, keeping the current one if it survives the
 *  swap. Never returns a kind the schema cannot support — the editor offers no invalid choice, so
 *  there is nothing to validate later (docs/dashboards.md § The generated editor). */
export const viewForCollection = (entry: CollectionSchemaRef, current: PanelViewKind | undefined): PanelViewKind => {
  const offered = viewsForCollection(entry)
  return current && offered.includes(current) ? current : (offered[0] ?? 'list')
}

/** Ordered by plugin, then name: the picker groups by plugin without needing group headers, and a
 *  filter narrows within that order.
 *
 *  Ordering IS the grouping. Picker draws a flat filtered list and the plugin rides along as
 *  each row's description; a real group header is a Picker feature, and one call site is not enough to
 *  ask for one. Upgrade path: a `groupBy` on Picker the day a second surface wants the same list. */
export function collectionsForPicker<T extends CollectionRef>(entries: readonly T[], query = ''): T[] {
  const needle = query.trim().toLowerCase()
  return entries
    .filter((entry) => !needle
      || entry.name.toLowerCase().includes(needle)
      || entry.pluginId.toLowerCase().includes(needle)
      || entry.collectionId.toLowerCase().includes(needle))
    .sort((a, b) =>
      a.pluginId.localeCompare(b.pluginId)
      || a.name.localeCompare(b.name)
      || a.collectionId.localeCompare(b.collectionId))
}

/** The title a new panel starts with. The collection's own name, qualified by its plugin only when
 *  another registered collection answers to the same one — two plugins both calling their collection
 *  "Issues" is the expected case, not an exotic one, and a board with two panels titled "Issues" is
 *  the failure this prevents. The user may still type anything. */
export function defaultPanelTitle<T extends CollectionRef>(entry: T, entries: readonly T[]): string {
  const ambiguous = entries.some((candidate) =>
    candidate.name === entry.name
    && (candidate.pluginId !== entry.pluginId || candidate.collectionId !== entry.collectionId))
  return ambiguous ? `${entry.name} (${entry.pluginId})` : entry.name
}

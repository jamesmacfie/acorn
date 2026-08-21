import { COLLECTION_FIELD_ROLES, PANEL_VIEW_KINDS, type PluginCollectionFieldRole } from '@acorn/protocol/collections.ts'
import type { PluginPanelRegion } from '@acorn/protocol/pluginContract.ts'
import { collectionKey, type CollectionContribution } from '../registries/collections'
import type { PanelDefinition, PanelViewKind } from './model'
import type { PlacementScope } from './persist'

// A panel region: a rectangle a plugin reserved in one of its own surfaces for panels the user composes.
// What an owner may declare, and why it is enforced twice, are in docs/dashboards.md § Placements. Two
// surfaces feed this today, a rail source's side panel and a pane's `pane.aside` extension point.
// Neither has any code here; both hand over the same declaration.
//
// JSX-free, exactly as registries/extensionPoints.ts is, and for the same reason: vitest in this repo
// runs in a bare Node environment with no Solid transform, so every rule worth pinning has to live
// somewhere a test can import. What is left in the components is a `<PanelGrid scope=… region=…>`.
//
// The host binds `pluginId`, always, from the manifest it read, and never from a descriptor field. It is
// what "own-plugin collections only" means, so a manifest able to state it could claim another package's
// data as its own default.

export type PanelRegion = {
  /** The plugin whose surface this region sits in. Host-bound. */
  pluginId: string
  /** Explicit `<pluginId>:<collectionId>` references, or absent for this plugin's own. */
  collections?: readonly string[]
  /** Any collection carrying a field with this role. The alternative to a list, never both. */
  fieldRole?: PluginCollectionFieldRole
  /** Absent means every view this build draws. */
  views?: readonly PanelViewKind[]
  max: number
}

/** The default a surface gets by declaring the key and nothing inside it: own collections, every view,
 *  four panels. Spelled once so the manifest's `max` default and this cannot drift. The schema fills
 *  `max` on parse, and this is the answer for a roster row from a node that predates the field. */
const DEFAULT_MAX = 4

const isFieldRole = (value: string): value is PluginCollectionFieldRole =>
  (COLLECTION_FIELD_ROLES as readonly string[]).includes(value)

const isViewKind = (value: string): value is PanelViewKind =>
  (PANEL_VIEW_KINDS as readonly string[]).includes(value)

/**
 * The host's own reading of what a manifest declared. Every closed vocabulary is intersected with this
 * build's, never trusted: a newer node can name a view kind or a field role this shell has no renderer
 * for, and the honest answer is a narrower offer rather than a refusal, the same posture chrome/data.ts
 * takes toward everything a roster row claims.
 *
 * `views` intersecting to nothing falls back to every kind. A region whose entire allow-list is unknown
 * to this build has told this build nothing, and offering nothing would strand a person in front of a
 * picker with no options and no reason given.
 */
export function panelRegion(pluginId: string, declared: PluginPanelRegion | undefined): PanelRegion {
  const views = (declared?.views ?? []).filter(isViewKind)
  const fieldRole = declared?.fieldRole
  return {
    pluginId,
    ...(declared?.collections ? { collections: declared.collections } : {}),
    ...(fieldRole && isFieldRole(fieldRole) ? { fieldRole } : {}),
    ...(views.length ? { views } : {}),
    max: declared?.max ?? DEFAULT_MAX,
  }
}

/** Where a region's panels are stored. `plugin-region` was in the scope union before anything drew one
 *  (persist.ts), so this is a constant and not a key format. */
export const regionScope = (ownerId: string): PlacementScope => ({ surface: 'plugin-region', ownerId })

/** The owner id of a rail source's side panel, and of a pane's aside, which is the qualified extension
 *  point id and already `<pluginId>:<pointId>`. Both are `<pluginId>:<somethingId>`, which is why
 *  `placementScopeKey` percent-encodes its segments. */
export const sourceRegionOwner = (pluginId: string, sourceId: string): string => `${pluginId}:${sourceId}`

/** True when this collection may be composed into this region. The one predicate the other three
 *  functions are phrased in terms of, so edit time and render time cannot disagree. */
export const regionAdmits = (region: PanelRegion, entry: CollectionContribution): boolean => {
  if (region.collections) return region.collections.includes(collectionKey(entry.pluginId, entry.collectionId))
  if (region.fieldRole) return !!entry.schema?.fields.some((field) => field.role === region.fieldRole)
  return entry.pluginId === region.pluginId
}

/** What the panel editor may offer here, the edit-time half. A region declaring a `fieldRole` over a
 *  self-describing collection offers nothing, and that is correct: the host has never seen that
 *  collection's fields, so admitting it would be a claim nobody has checked. */
export const regionCollections = (
  region: PanelRegion,
  all: readonly CollectionContribution[],
): CollectionContribution[] => all.filter((entry) => regionAdmits(region, entry))

/** The view kinds this region allows, before the schema's own gates narrow them further. */
export const regionViews = (region: PanelRegion): readonly PanelViewKind[] => region.views ?? PANEL_VIEW_KINDS

/**
 * The render-time half: may this already-composed panel be drawn here?
 *
 * Every query must be admitted, not merely one. A panel unions the rows of several collections and the
 * region's allowance is about what a person may see in this rectangle, so one disallowed source is a
 * disallowed panel.
 *
 * A panel refused here is not drawn, and nothing is deleted: its definition survives in the library and
 * on every other surface it is placed in, which is the point of the placement split. That is the one
 * place this differs from an unresolvable panel, which draws inert. "The plugin that owns this rectangle
 * no longer allows it" is a statement about the rectangle, and an inert box explaining somebody else's
 * policy inside somebody else's pane helps nobody.
 */
export const regionAllows = (
  region: PanelRegion,
  panel: PanelDefinition,
  lookup: (pluginId: string, collectionId: string) => CollectionContribution | undefined,
): boolean => {
  if (!regionViews(region).includes(panel.view.kind as PanelViewKind)) return false
  return panel.queries.every((query) => {
    const entry = lookup(query.pluginId, query.collectionId)
    // An unresolved collection is admitted. The panel then draws as the inert "source unavailable" body
    // it already draws everywhere else, which is a plugin-lifecycle answer. Turning it into "not allowed
    // here" would make a disabled plugin look like a policy refusal.
    return !entry || regionAdmits(region, entry)
  })
}

/** Is there room for another? The cap is the owner's, and the affordance goes away rather than failing on
 *  click, the same rule `PanelGrid` applies to "no plugin provides a collection". */
export const regionHasRoom = (region: PanelRegion, placed: number): boolean => placed < region.max

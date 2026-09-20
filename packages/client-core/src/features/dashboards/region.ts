import { dashboardViewKinds } from '@acorn/protocol/dashboardViews.ts'
import type { PluginPanelRegion } from '@acorn/protocol/plugin/contract.ts'
import type { PanelDefinition, PanelViewKind } from './model'
import type { PlacementScope } from './persist'

export type PanelRegion = {
  pluginId: string
  sources?: readonly string[]
  fieldRole?: 'title' | 'status' | 'assignee' | 'url' | 'updated'
  views?: readonly PanelViewKind[]
  max: number
}

const DEFAULT_MAX = 4
const fieldRoles = ['title', 'status', 'assignee', 'url', 'updated'] as const
const isFieldRole = (value: string): value is NonNullable<PanelRegion['fieldRole']> =>
  (fieldRoles as readonly string[]).includes(value)
const isViewKind = (value: string): value is PanelViewKind =>
  (dashboardViewKinds as readonly string[]).includes(value)

/** Bind the declaring plugin to its region and intersect newer vocabularies with this client. */
export function panelRegion(pluginId: string, declared: PluginPanelRegion | undefined): PanelRegion {
  const views = (declared?.views ?? []).filter(isViewKind)
  const fieldRole = declared?.fieldRole
  return {
    pluginId,
    ...(declared?.sources ? { sources: declared.sources } : {}),
    ...(fieldRole && isFieldRole(fieldRole) ? { fieldRole } : {}),
    ...(views.length ? { views } : {}),
    max: declared?.max ?? DEFAULT_MAX,
  }
}

export const regionScope = (ownerId: string): PlacementScope => ({ surface: 'plugin-region', ownerId })
export const sourceRegionOwner = (pluginId: string, sourceId: string): string => `${pluginId}:${sourceId}`
export const regionViews = (region: PanelRegion): readonly PanelViewKind[] => region.views ?? dashboardViewKinds

/** Published metadata is advisory only when its source is unavailable, so an empty source list remains
 * visible and inert. A known source set must satisfy the region's entire constraint. */
export const regionAllows = (region: PanelRegion, panel: PanelDefinition): boolean => {
  if (!regionViews(region).includes(panel.view.kind as PanelViewKind)) return false
  const publication = panel.publication
  if (!publication) return false
  const sources = publication.sources ?? []
  if (region.sources && sources.length) return sources.every(source => region.sources!.includes(source))
  if (region.fieldRole && publication.fieldRoles?.length) return publication.fieldRoles.includes(region.fieldRole)
  if (!region.sources && !region.fieldRole && sources.length) {
    return sources.every(source => source.startsWith(`${region.pluginId}:`))
  }
  return true
}

export const regionHasRoom = (region: PanelRegion, placed: number): boolean => placed < region.max

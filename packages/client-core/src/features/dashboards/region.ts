import { dashboardViewKinds } from '@acorn/protocol/dashboardViews.ts'
import { VIEW_LABELS } from '@acorn/dashboards-core/labels.ts'
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

/** Why a region refuses a panel with this view and published metadata, or undefined when it allows it.
 * Metadata is advisory only when its source is unavailable, so an empty source list stays allowed. A
 * known source set must satisfy the region's entire constraint. */
export function regionRefusal(region: PanelRegion, view: string, publication: { sources?: readonly string[]; fieldRoles?: readonly string[] }): string | undefined {
  const views = regionViews(region)
  if (!views.includes(view as PanelViewKind)) return `This area only shows ${listWords(views.map(kind => VIEW_LABELS[kind]))} panels.`
  const sources = publication.sources ?? []
  if (region.sources && sources.length) {
    return sources.every(source => region.sources!.includes(source)) ? undefined : 'This area only shows panels built from its own sources.'
  }
  if (region.fieldRole && publication.fieldRoles?.length) {
    return publication.fieldRoles.includes(region.fieldRole) ? undefined : `This area only shows panels with a ${region.fieldRole} field.`
  }
  if (!region.sources && !region.fieldRole && sources.length && !sources.every(source => source.startsWith(`${region.pluginId}:`))) {
    return "This area only shows panels built from its plugin's sources."
  }
  return undefined
}

/** Whether a panel in this region may read the source, given as `pluginId:sourceId`. The same rule as
 *  `regionRefusal`: the region's own list when it has one, any source when it asks only for a field
 *  role, and its plugin's sources otherwise. */
export const regionAllowsSource = (region: PanelRegion, source: string): boolean =>
  region.sources ? region.sources.includes(source) : !!region.fieldRole || source.startsWith(`${region.pluginId}:`)

export const regionAllows = (region: PanelRegion, panel: PanelDefinition): boolean =>
  !!panel.publication && !regionRefusal(region, panel.view.kind, panel.publication)

const listWords = (words: readonly string[]): string => words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`

export const regionHasRoom = (region: PanelRegion, placed: number): boolean => placed < region.max

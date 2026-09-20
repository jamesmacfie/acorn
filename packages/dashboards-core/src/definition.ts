import { dashboardViewSchema } from '@acorn/protocol/dashboardViews.ts'
import type { PanelDefinition } from './model'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  : []

/** Parse only the dashboard-v2 publication marker. Legacy flat panel definitions are
 * intentionally not admitted after the versioned development-state transition. */
export function parsePanelDefinition(raw: unknown): PanelDefinition | undefined {
  if (!isRecord(raw) || !isRecord(raw.publication)) return undefined
  const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined
  const dashboardId = typeof raw.publication.dashboardId === 'string' && raw.publication.dashboardId
    ? raw.publication.dashboardId
    : undefined
  if (!id || !dashboardId) return undefined
  const view = dashboardViewSchema.safeParse(raw.view)
  const sources = strings(raw.publication.sources)
  const fieldRoles = strings(raw.publication.fieldRoles)
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    shaping: {},
    view: view.success ? view.data : { kind: 'list' },
    publication: {
      dashboardId,
      ...(sources.length ? { sources } : {}),
      ...(fieldRoles.length ? { fieldRoles } : {}),
    },
  }
}

/** Definitions and placements only, not geometry: everything the sampler needs from preferences. */
export function parsePanels(value: unknown): {
  panels: Record<string, PanelDefinition>
  placements: Record<string, string[]>
} {
  if (!isRecord(value) || value.version !== 2) return { panels: {}, placements: {} }
  const panels: Record<string, PanelDefinition> = {}
  if (isRecord(value.panels)) {
    for (const [id, entry] of Object.entries(value.panels)) {
      const panel = parsePanelDefinition(entry)
      if (panel) panels[id] = { ...panel, id }
    }
  }
  const placements: Record<string, string[]> = {}
  if (isRecord(value.placements)) {
    for (const [key, entry] of Object.entries(value.placements)) {
      if (Array.isArray(entry)) placements[key] = strings(entry)
    }
  }
  return { panels, placements }
}

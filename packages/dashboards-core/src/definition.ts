import { dashboardViewKinds, dashboardViewSchema } from '@acorn/protocol/dashboardViews.ts'
import type { PanelDefinition } from './model'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : []

/** Parse one stored panel definition: a published panel, or a definition this build can't draw. Flat
 *  panel definitions, with no publication and a plan view, are refused. */
export function parsePanelDefinition(raw: unknown): PanelDefinition | undefined {
  if (!isRecord(raw)) return undefined
  if (!isRecord(raw.publication)) return parseUnknownDefinition(raw)
  const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined
  const dashboardId =
    typeof raw.publication.dashboardId === 'string' && raw.publication.dashboardId
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

/** A definition with no publication and a view kind that isn't a plan's, kept as written. It's a kind
 *  a newer build added, so a client that can't draw it draws it inert, and a save writes it back
 *  unchanged rather than deleting it for every client (docs/dashboards.md § Persistence). */
function parseUnknownDefinition(raw: Record<string, unknown>): PanelDefinition | undefined {
  const view = isRecord(raw.view) ? raw.view : {}
  const kind = typeof view.kind === 'string' ? view.kind : undefined
  if (typeof raw.id !== 'string' || !raw.id || !kind || (dashboardViewKinds as readonly string[]).includes(kind))
    return undefined
  // A malformed publication must not reach code that reads one as published.
  const { publication: _malformed, ...fields } = raw
  return {
    ...fields,
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '',
    shaping: {},
    view: { ...view, kind },
  }
}

/** Definitions and placements only, not geometry: everything the sampler needs from preferences. */
export function parsePanels(value: unknown): {
  panels: Record<string, PanelDefinition>
  placements: Record<string, string[]>
} {
  if (!isRecord(value) || value.version !== 1) return { panels: {}, placements: {} }
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

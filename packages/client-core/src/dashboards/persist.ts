import { createSignal } from 'solid-js'
import { PrefKeys } from '../persistence/prefKeys'
import { appStateBinding, parseJson, type PersistedStateSlice } from '../persistence/persistedState'
import { COLLECTION_FIELD_TYPES, type PluginCollectionFieldType } from '@acorn/protocol/collections.ts'
import { COLS, normalize, readingOrder, sizeFor, type PanelLayout, type Rect } from './layout'
import type {
  PanelDefinition,
  PanelFieldDef,
  PanelFilter,
  PanelFilterOp,
  PanelId,
  PanelMapping,
  PanelMappingColumn,
  PanelMappingColumnDef,
  PanelQuery,
  PanelShaping,
  PanelSort,
  PanelTone,
  PanelView,
} from './model'

// The persisted dashboard model (docs/dashboards.md § Persistence).
//
// Three decisions, all of them the expensive-later kind:
//
//   NODE PREFS, NOT DEVICE STORAGE. Panel definitions describe a node's resources, so they follow
//   the resource (docs/state.md § Scope rules). A person builds a board once and every client paired
//   with that node renders it; the device's query cache stays the offline read fallback, as it is
//   for every other node-backed read. This rides the ordinary persisted-state machinery, which
//   writes through `savePref` to `/v2/core/prefs`.
//
//   PANEL DEFINITIONS PERSIST INDEPENDENTLY OF ANY SURFACE; PLACEMENTS REFERENCE THEM BY ID. The
//   Perses split. Embedding panel config inside a "home dashboard" blob works right up until panels
//   need to live in a second place (placements.md), and then it is a migration. One slice holding
//   two maps is the cheap way to have the split — the requirement is reference-by-id, not two
//   preference keys.
//
//   UNKNOWN IDS SURVIVE. Parsing answers "is this shaped like a panel?", never "is that collection
//   registered in this build?" — the pane-layout rule verbatim (tasks/layout.ts): the registry
//   lookup happens at RENDER time and an unresolved panel draws as inert rather than disappearing.
//   A person's composition is never collateral damage of switching a plugin off.

/** `(surface, ownerId, projectId?)`, per placements.md. Only `home` is drawn today; the other two
 *  are named here so a later phase adds a renderer rather than a key format. */
export type PlacementSurface = 'home' | 'pane' | 'plugin-region'

export type PlacementScope = {
  surface: PlacementSurface
  /** The pane id, or `pluginId:regionId`. Absent for `home`, which has one of itself. */
  ownerId?: string
  projectId?: string
}

export const HOME_PLACEMENT: PlacementScope = { surface: 'home' }

/** Segments are encoded so an owner id containing the separator — `pluginId:regionId` is one — can
 *  never be read as two, and trailing empties are dropped so home's key is just `home`. */
export const placementScopeKey = (scope: PlacementScope): string => {
  const segments = [scope.surface, scope.ownerId ?? '', scope.projectId ?? ''].map(encodeURIComponent)
  while (segments.length > 1 && segments[segments.length - 1] === '') segments.pop()
  return segments.join('/')
}

export type DashboardState = {
  panels: Record<PanelId, PanelDefinition>
  /** Placement scope key → the panels placed there, in render order. */
  placements: Record<string, PanelId[]>
  /** Placement scope key → panel id → its rect on that surface (layout.ts).
   *
   *  A SIBLING KEY rather than turning the `placements` entries into `{ id, x, y, w, h }` objects,
   *  which would be tidier. These blobs are node-owned and shared by every client paired with the
   *  node (docs/state.md), and the shipped parser keeps only STRING entries from a placement array —
   *  object entries would parse to an empty placement and the board would vanish on an old client. A
   *  sibling key is invisible to an old parser: it renders the order-only grid it always did.
   *
   *  THE HONEST CEILING, on the record: an old client that WRITES the slice serialises only what it
   *  parsed, so a write from one drops `layouts` — geometry resets to auto-placement while the
   *  panels, their definitions and their order all survive. Losing arrangement and keeping
   *  composition is the right way round, and it is the best available under the slice model, which
   *  does not round-trip unknown top-level keys.
   *
   *  Geometry is per (scope, panel), never on the definition: the same panel placed on Home and in a
   *  task pane has two rects. That is the Perses layouts-reference-panels split already in force. */
  layouts: Record<string, Record<PanelId, Rect>>
}

export const emptyDashboards = (): DashboardState => ({ panels: {}, placements: {}, layouts: {} })

// ── Codec ─────────────────────────────────────────────────────────────────────────────────────
//
// Hand-written rather than a Zod schema, matching every other slice here: a codec must TOLERATE
// malformed input and never throw (the conformance suite calls it with `'{not-json'` and with a
// string the size of the whole budget), and the shapes are shallow enough that a parser is shorter
// than a schema plus its error handling.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)

const stringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) if (typeof entry === 'string') out[key] = entry
  return out
}

const FILTER_OPS: readonly PanelFilterOp[] = ['eq', 'ne', 'contains', 'gt', 'lt', 'is-empty', 'is-not-empty']

const parseQuery = (raw: unknown): PanelQuery | undefined => {
  if (!isRecord(raw)) return undefined
  const pluginId = str(raw.pluginId)
  const collectionId = str(raw.collectionId)
  // The pair IS the address. A query missing either half names nothing, which is a different case
  // from naming something this build cannot resolve — that one is kept.
  if (!pluginId || !collectionId) return undefined
  const params = stringRecord(raw.params)
  return { pluginId, collectionId, ...(params && Object.keys(params).length ? { params } : {}) }
}

const parseFilter = (raw: unknown): PanelFilter | undefined => {
  if (!isRecord(raw)) return undefined
  const field = str(raw.field)
  const op = FILTER_OPS.find((candidate) => candidate === raw.op)
  if (!field || !op) return undefined
  const value = raw.value
  const usable = value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  return { field, op, ...(usable ? { value } : {}) }
}

const parseSort = (raw: unknown): PanelSort | undefined => {
  if (!isRecord(raw)) return undefined
  const field = str(raw.field)
  if (!field) return undefined
  return { field, direction: raw.direction === 'desc' ? 'desc' : 'asc' }
}

const list = <T>(raw: unknown, parse: (entry: unknown) => T | undefined): T[] =>
  Array.isArray(raw) ? raw.flatMap((entry) => { const parsed = parse(entry); return parsed ? [parsed] : [] }) : []

const parseShaping = (raw: unknown): PanelShaping => {
  if (!isRecord(raw)) return {}
  const filters = list(raw.filters, parseFilter)
  const sort = list(raw.sort, parseSort)
  const fields = Array.isArray(raw.fields) ? raw.fields.filter((entry): entry is string => typeof entry === 'string') : []
  const limit = typeof raw.limit === 'number' && Number.isFinite(raw.limit) && raw.limit >= 0 ? Math.floor(raw.limit) : undefined
  // Kept whether or not this build has an enum field to hang it on, for the same reason an unknown
  // view kind is: the grouping is what a board IS, and a pass through a client whose plugin set
  // differs must not be what deletes it.
  const groupBy = str(raw.groupBy)
  return {
    ...(filters.length ? { filters } : {}),
    ...(sort.length ? { sort } : {}),
    ...(fields.length ? { fields } : {}),
    ...(limit === undefined ? {} : { limit }),
    ...(groupBy ? { groupBy } : {}),
  }
}

// ── The mapping codec ─────────────────────────────────────────────────────────────────────────
//
// The one place a key is carried across UNREAD on purpose. `writeValue` is the write-back seam
// (model.ts § PanelMappingColumn): nothing in this read-only build sets it or looks at it, and it
// still round-trips, because a reserved shape that the codec quietly deletes is not reserved.

const parseMappingColumn = (raw: unknown): PanelMappingColumn | undefined => {
  if (!isRecord(raw)) return undefined
  const values = Array.isArray(raw.values)
    ? raw.values.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
  const writeValue = str(raw.writeValue)
  const entry: PanelMappingColumn = {
    ...(values.length ? { values } : {}),
    ...(writeValue ? { writeValue } : {}),
  }
  return Object.keys(entry).length ? entry : undefined
}

const TONES: readonly PanelTone[] = ['ok', 'warn', 'bad', 'muted', 'accent']

const parseColumn = (raw: unknown): PanelMappingColumnDef | undefined => {
  if (!isRecord(raw)) return undefined
  const id = str(raw.id)
  const label = str(raw.label)
  // The pair IS the column: an id with no label draws a blank heading and a label with no id is
  // unreferenceable from `bySource`.
  if (!id || !label) return undefined
  const tone = TONES.find((candidate) => candidate === raw.tone)
  return { id, label, ...(tone ? { tone } : {}) }
}

const FIELD_TYPES: readonly PluginCollectionFieldType[] = COLLECTION_FIELD_TYPES

const parseFieldDef = (raw: unknown): PanelFieldDef | undefined => {
  if (!isRecord(raw)) return undefined
  const id = str(raw.id)
  const label = str(raw.label)
  // The pair IS the field, same rule as a column — and the type has to be one this build renders,
  // because every view dispatches on it.
  const type = FIELD_TYPES.find((candidate) => candidate === raw.type)
  if (!id || !label || !type) return undefined
  return { id, label, type }
}

const parseMapping = (raw: unknown): PanelMapping | undefined => {
  if (!isRecord(raw)) return undefined
  const columns = list(raw.columns, parseColumn)
  const extraFields = list(raw.extraFields, parseFieldDef)

  const bySource: Record<string, Record<string, PanelMappingColumn>> = {}
  if (isRecord(raw.bySource)) {
    for (const [key, entries] of Object.entries(raw.bySource)) {
      if (!isRecord(entries)) continue
      const kept: Record<string, PanelMappingColumn> = {}
      for (const [columnId, entry] of Object.entries(entries)) {
        const parsed = parseMappingColumn(entry)
        // NOT filtered against `columns`: an entry naming a column this blob does not carry is the
        // same class of thing as an unknown pane id, and the render-time half already ignores it.
        if (parsed) kept[columnId] = parsed
      }
      if (Object.keys(kept).length) bySource[key] = kept
    }
  }

  const fields: Record<string, Record<string, string>> = {}
  if (isRecord(raw.fields)) {
    for (const [key, entries] of Object.entries(raw.fields)) {
      // `''` survives: it is the user saying "this source has nothing for that panel field", which
      // is a different answer from an absent key (model.ts § PanelMapping).
      const mapped = stringRecord(entries)
      if (mapped && Object.keys(mapped).length) fields[key] = mapped
    }
  }

  const mapping: PanelMapping = {
    ...(columns.length ? { columns } : {}),
    ...(Object.keys(bySource).length ? { bySource } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(extraFields.length ? { extraFields } : {}),
    ...(raw.unmapped === 'hidden' ? { unmapped: 'hidden' as const } : {}),
  }
  return Object.keys(mapping).length ? mapping : undefined
}

const parseView = (raw: unknown): PanelView => {
  if (!isRecord(raw)) return { kind: 'list' }
  // Any non-empty kind is kept, INCLUDING one this build cannot draw. Coercing a `board` written by
  // a newer client into a list would destroy the panel on the first round trip through an older
  // one, and these definitions are shared by every client paired with the node.
  const kind = str(raw.kind) ?? 'list'
  const aggregate = str(raw.aggregate)
  const field = str(raw.field)
  // The chart keys, tolerantly. Same additive posture as every other key in this slice: an old
  // client that WRITES the blob drops them and the chart falls back to its inferred defaults — the
  // panel itself survives, and an old client RENDERING a `chart` panel already shows "view
  // unavailable" rather than coercing it to something it can draw.
  const shape = raw.shape === 'bar' || raw.shape === 'line' ? raw.shape : undefined
  const x = str(raw.x)
  const series = str(raw.series)
  return {
    kind,
    ...(aggregate ? { aggregate: aggregate as PanelView['aggregate'] } : {}),
    ...(field ? { field } : {}),
    ...(shape ? { shape } : {}),
    ...(x ? { x } : {}),
    ...(series ? { series } : {}),
  }
}

export function parsePanelDefinition(raw: unknown): PanelDefinition | undefined {
  if (!isRecord(raw)) return undefined
  const id = str(raw.id)
  if (!id) return undefined
  const queries = list(raw.queries, parseQuery)
  if (!queries.length) return undefined
  const mapping = parseMapping(raw.mapping)
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    queries,
    ...(mapping ? { mapping } : {}),
    shaping: parseShaping(raw.shaping),
    view: parseView(raw.view),
    ...(typeof raw.refresh === 'number' && Number.isFinite(raw.refresh) ? { refresh: raw.refresh } : {}),
  }
}

// ── The geometry codec ────────────────────────────────────────────────────────────────────────
//
// A rect is one more thing the codec TOLERATES THE ABSENCE OF, not a new validity requirement. Three
// rules, and between them they mean no blob can produce an unrenderable grid:
//
//   A malformed rect is DROPPED, not repaired into place. The panel it belonged to just becomes
//   rect-less, which is a case with a defined answer already.
//
//   A placed panel with no rect is AUTO-PLACED at render time (layout.ts § firstFit). That one rule
//   is simultaneously the migration for every existing blob, the old-client-write recovery, and the
//   new-panel default.
//
//   An entry naming a panel that is not placed in that scope is RETAINED UNREAD — the unknown-id rule
//   again. It costs bytes, not correctness, and dropping it would make a partially-written blob
//   destructive.
//
// No version bump: the change is additive, both directions degrade as described, and the shape still
// parses under the old parser — which is what the slice version is a statement about.

const parseRect = (raw: unknown): Rect | undefined => {
  if (!isRecord(raw)) return undefined
  const numbers = [raw.x, raw.y, raw.w, raw.h]
  if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) return undefined
  // Only the grid-wide bounds here. The per-view-kind minimums are applied by `normalize`, not by
  // the codec, so lowering one later is a behaviour change rather than a migration.
  const w = Math.max(1, Math.min(COLS, Math.floor(raw.w as number)))
  return {
    w,
    h: Math.max(1, Math.floor(raw.h as number)),
    x: Math.max(0, Math.min(COLS - w, Math.floor(raw.x as number))),
    y: Math.max(0, Math.floor(raw.y as number)),
  }
}

export function parseDashboards(raw: unknown): DashboardState {
  const value = parseJson(raw)
  if (!isRecord(value)) return emptyDashboards()
  const panels: Record<PanelId, PanelDefinition> = {}
  if (isRecord(value.panels)) {
    for (const [id, entry] of Object.entries(value.panels)) {
      const panel = parsePanelDefinition(entry)
      // The map key wins over whatever the row claims: a definition filed under a stranger's id
      // would be unreachable by every placement that references it.
      if (panel) panels[id] = { ...panel, id }
    }
  }
  const placements: Record<string, PanelId[]> = {}
  if (isRecord(value.placements)) {
    for (const [key, entry] of Object.entries(value.placements)) {
      if (!Array.isArray(entry)) continue
      // Not filtered against `panels`: a dangling reference is the same class of thing as an
      // unknown pane id, and dropping it here would make a partially-written blob lose placements.
      placements[key] = entry.filter((id): id is string => typeof id === 'string' && id.length > 0)
    }
  }
  const layouts: Record<string, Record<PanelId, Rect>> = {}
  if (isRecord(value.layouts)) {
    for (const [key, entry] of Object.entries(value.layouts)) {
      if (!isRecord(entry)) continue
      const rects: Record<PanelId, Rect> = {}
      for (const [id, candidate] of Object.entries(entry)) {
        const rect = parseRect(candidate)
        if (rect) rects[id] = rect
      }
      if (Object.keys(rects).length) layouts[key] = rects
    }
  }
  return { panels, placements, layouts }
}

// ── Store ─────────────────────────────────────────────────────────────────────────────────────

const [dashboards, setDashboards] = createSignal<DashboardState>(emptyDashboards())
export { dashboards }

export const hydrateDashboards = (value: DashboardState): void => void setDashboards(value)

export const panelDefinition = (id: PanelId): PanelDefinition | undefined => dashboards().panels[id]

/** The panels placed in a scope, in order. A reference with no definition is skipped — the
 *  render-time half of the retain-inert rule, and the reason parsing never filters. */
export const panelsAt = (scope: PlacementScope): PanelDefinition[] => {
  const state = dashboards()
  return (state.placements[placementScopeKey(scope)] ?? []).flatMap((id) => {
    const panel = state.panels[id]
    return panel ? [panel] : []
  })
}

/** The arranged geometry of a scope, ready to render: every placed panel has a rect, nothing
 *  overlaps, and everything has floated up.
 *
 *  `normalize` runs on the way OUT rather than on the way in, so the persisted blob is never
 *  rewritten just because it was read — a client that only looks at a board must not be the one that
 *  changes it for every other client paired with the node. */
export const layoutAt = (scope: PlacementScope): PanelLayout => {
  const state = dashboards()
  const key = placementScopeKey(scope)
  const order = (state.placements[key] ?? []).filter((id) => state.panels[id])
  const stored = state.layouts[key] ?? {}
  // Only the rects of panels actually placed here. A retained entry for a panel that has since been
  // unplaced is carried in storage but must not occupy space in the grid.
  const rects = Object.fromEntries(order.flatMap((id) => (stored[id] ? [[id, stored[id]] as const] : [])))
  return normalize({ order, rects }, (id) => sizeFor(state.panels[id]?.view.kind ?? 'list'))
}

/** Commit a gesture. Writes the rects and rewrites `placements` to READING ORDER, which is what
 *  keeps an old client's order-only render sensible, the narrow-window collapse well-defined, and
 *  document order matching visual order for a screen reader. */
export const setLayoutAt = (scope: PlacementScope, layout: PanelLayout): void =>
  void setDashboards((state) => {
    const key = placementScopeKey(scope)
    const ordered = readingOrder(layout)
    // Retained entries for panels not placed here survive: dropping them would make a
    // partially-written blob destructive, and `layoutAt` already ignores them.
    const rects = { ...(state.layouts[key] ?? {}), ...layout.rects }
    return {
      ...state,
      placements: { ...state.placements, [key]: ordered },
      layouts: { ...state.layouts, [key]: rects },
    }
  })

export const savePanel = (panel: PanelDefinition): void =>
  void setDashboards((state) => ({ ...state, panels: { ...state.panels, [panel.id]: panel } }))

/** Deletes the definition AND every reference to it, geometry included. A placement pointing at
 *  nothing is the one dangling case that is a bug rather than a version skew, so it is not left
 *  behind — and a rect for a definition that no longer exists can never be read again. */
export const removePanel = (id: PanelId): void =>
  void setDashboards((state) => {
    const { [id]: _removed, ...panels } = state.panels
    const placements = Object.fromEntries(
      Object.entries(state.placements).map(([key, ids]) => [key, ids.filter((candidate) => candidate !== id)]),
    )
    const layouts = Object.fromEntries(
      Object.entries(state.layouts).map(([key, rects]) => {
        const { [id]: _gone, ...kept } = rects
        return [key, kept] as const
      }),
    )
    return { panels, placements, layouts }
  })

/** Place a panel, or move one already placed. `index` is where it lands; past the end appends. */
export const placePanel = (scope: PlacementScope, id: PanelId, index?: number): void =>
  void setDashboards((state) => {
    const key = placementScopeKey(scope)
    const without = (state.placements[key] ?? []).filter((candidate) => candidate !== id)
    const at = index === undefined ? without.length : Math.max(0, Math.min(without.length, Math.floor(index)))
    return { ...state, placements: { ...state.placements, [key]: [...without.slice(0, at), id, ...without.slice(at)] } }
  })

/** Take a panel off one surface. Its definition survives, which is the point of the split. */
export const unplacePanel = (scope: PlacementScope, id: PanelId): void =>
  void setDashboards((state) => {
    const key = placementScopeKey(scope)
    return { ...state, placements: { ...state.placements, [key]: (state.placements[key] ?? []).filter((candidate) => candidate !== id) } }
  })

// ── Slice ─────────────────────────────────────────────────────────────────────────────────────

export const dashboardsSlice: PersistedStateSlice<DashboardState> = {
  id: 'core.dashboards',
  key: PrefKeys.dashboards,
  // `app`, and one blob rather than a key per panel: the whole model is read together on every
  // surface that draws one, and a key per panel would need a scope registration and an eviction
  // rule for what is a short list. The precedent is `agentTools.perms` — one JSON slice under one
  // prefs key, read by both sides.
  scope: 'app',
  restore: 'view',
  version: 1,
  codec: { parse: parseDashboards, serialize: (value) => value },
  empty: emptyDashboards,
  unknownIds: 'retain-inert',
  maxBytes: 64 * 1024,
  binding: appStateBinding(dashboards, hydrateDashboards),
}

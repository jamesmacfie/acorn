import { createSignal } from 'solid-js'
import { isRecord, parsePanelDefinition, parsePanels } from '@acorn/dashboards-core/definition.ts'
import { PrefKeys } from '../persistence/prefKeys'
import { appStateBinding, parseJson, type PersistedStateSlice } from '../persistence/persistedState'
import { COLS, firstFit, normalize, readingOrder, sizeFor, type PanelLayout, type Rect } from './layout'
import type { PanelDefinition, PanelId } from './model'

export { parsePanelDefinition }

// The persisted dashboard model (docs/dashboards.md § Persistence): node prefs, not device storage,
// written through `savePref` to `/v2/core/prefs`; panel definitions persist independently of any
// surface, with placements referencing them by id; and an unresolved id survives as inert rather
// than being dropped.

/** `(surface, ownerId, projectId?)`. All three surfaces are drawn: `home` (a tab per `ownerId`),
 *  `pane`, and `plugin-region`, a rail source's side panel or a plugin pane's aside owned as
 *  `<pluginId>:<somethingId>` (dashboards/region.ts). */
export type PlacementSurface = 'home' | 'pane' | 'plugin-region'

export type PlacementScope = {
  surface: PlacementSurface
  /** The pane id, or `pluginId:regionId`. Absent for `home`, which has one of itself. */
  ownerId?: string
  projectId?: string
}

export const HOME_PLACEMENT: PlacementScope = { surface: 'home' }

/** A Home tab is the scope `{ surface: 'home', ownerId: tabId }`. The default tab's id is `''`, which
 *  `placementScopeKey` collapses back to the bare `home` key, so every blob written before tabs
 *  existed is already a valid one-tab state. */
export const homeTabScope = (tabId: string): PlacementScope => ({ surface: 'home', ownerId: tabId })

/** Segments are encoded so an owner id containing the separator, as `pluginId:regionId` does, can never
 *  be read as two. Trailing empties are dropped, so home's key is just `home`. */
export const placementScopeKey = (scope: PlacementScope): string => {
  const segments = [scope.surface, scope.ownerId ?? '', scope.projectId ?? ''].map(encodeURIComponent)
  while (segments.length > 1 && segments[segments.length - 1] === '') segments.pop()
  return segments.join('/')
}

export type DashboardState = {
  panels: Record<PanelId, PanelDefinition>
  /** Placement scope key → the panels placed there, in render order. */
  placements: Record<string, PanelId[]>
  /** Placement scope key to panel id to its rect on that surface (layout.ts).
   *
   *  A sibling key rather than turning `placements` entries into `{ id, x, y, w, h }` objects. These
   *  blobs are node-owned and shared by every client paired with the node, and the shipped parser keeps
   *  only string entries from a placement array, so object entries would parse to an empty placement
   *  and the board would vanish on an old client. A sibling key is invisible to an old parser.
   *
   *  The ceiling: an old client that writes the slice serialises only what it parsed, so geometry
   *  resets to auto-placement while the panels, their definitions and their order survive.
   *
   *  Geometry is per (scope, panel), never on the definition: the same panel placed on Home and in a
   *  task pane has two rects. */
  layouts: Record<string, Record<PanelId, Rect>>
  /** The named Home tabs, in display order. Additive and optional: absent, or one entry, means no tab
   *  bar and Home renders as it did before tabs existed.
   *
   *  Only names and order live here. A tab's content is ordinary `placements` and `layouts` under the
   *  `home/<tabId>` key, which is why an old client that drops this key loses the names and keeps every
   *  panel. */
  tabs?: DashboardTab[]
}

/** `id: ''` is the default tab (the bare `home` scope). */
export type DashboardTab = { id: string; name: string }

export const emptyDashboards = (): DashboardState => ({ panels: {}, placements: {}, layouts: {} })

// The geometry codec (docs/dashboards.md § Persistence): a malformed rect is dropped rather than
// repaired, a placed panel with no rect is auto-placed at render (layout.ts § firstFit), and an
// entry naming a panel not placed in that scope is retained unread. No version bump: the change is
// additive and still parses under the old parser.

const parseRect = (raw: unknown): Rect | undefined => {
  if (!isRecord(raw)) return undefined
  const numbers = [raw.x, raw.y, raw.w, raw.h]
  if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) return undefined
  // Only the grid-wide bounds here. `normalize` applies the per-view-kind minimums, so lowering one
  // later is a behaviour change rather than a migration.
  const w = Math.max(1, Math.min(COLS, Math.floor(raw.w as number)))
  return {
    w,
    h: Math.max(1, Math.floor(raw.h as number)),
    x: Math.max(0, Math.min(COLS - w, Math.floor(raw.x as number))),
    y: Math.max(0, Math.floor(raw.y as number)),
  }
}

// The tab codec (docs/dashboards.md § Persistence): at most `MAX_TABS`, names trimmed to
// `MAX_TAB_NAME` characters rather than dropped, because dropping a name would strand its panels
// behind a recovered "Untitled".

export const MAX_TABS = 8
const MAX_TAB_NAME = 60

const parseTabs = (raw: unknown): DashboardTab[] => {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const tabs: DashboardTab[] = []
  for (const entry of raw) {
    if (tabs.length >= MAX_TABS) break
    if (!isRecord(entry)) continue
    // `''` is a legal id, being the default tab, so the check is the type rather than truthiness.
    const { id, name } = entry
    if (typeof id !== 'string' || typeof name !== 'string' || !name.trim() || seen.has(id)) continue
    seen.add(id)
    tabs.push({ id, name: name.trim().slice(0, MAX_TAB_NAME) })
  }
  return tabs
}

/** The tab id a placement key names, or `undefined` for a key that isn't a Home tab's. `home` is the
 *  default tab, `home/<id>` is a named one, and anything longer carries a `projectId` segment. */
export const homeTabIdOf = (key: string): string | undefined => {
  const segments = key.split('/')
  if (segments[0] !== 'home' || segments.length > 2) return undefined
  return decodeURIComponent(segments[1] ?? '')
}

/** The tabs to render: the named ones in order, then any `home/*` scope with placements but no name,
 *  appended as "Untitled".
 *
 *  One rule doing three jobs. It's the recovery from an old client that wrote the slice and dropped
 *  `tabs`, the defence against a partially-written blob, and why deleting a name can never delete a
 *  composition. The bare `home` scope is always a candidate whether or not it holds panels, because
 *  it's the default tab and has no delete.
 *
 *  Empty when the blob names no tabs: one dashboard draws no bar. */
export function homeTabs(state: DashboardState): DashboardTab[] {
  const named = state.tabs ?? []
  if (!named.length) return []
  const seen = new Set(named.map((tab) => tab.id))
  const recovered: DashboardTab[] = []
  for (const key of ['home', ...Object.keys(state.placements)]) {
    const id = homeTabIdOf(key)
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    recovered.push({ id, name: 'Untitled' })
  }
  return [...named, ...recovered]
}

export function parseDashboards(raw: unknown): DashboardState {
  const value = parseJson(raw)
  if (!isRecord(value)) return emptyDashboards()
  // Definitions and placements come from the shared codec, which the node's measure sampler also calls
  // (@acorn/dashboards-core/definition.ts). Two parsers over one blob is how a client and a node come
  // to disagree about what a panel is. Geometry stays here, because a rect is a rendering concern.
  const { panels, placements } = parsePanels(value)
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
  const tabs = parseTabs(value.tabs)
  return { panels, placements, layouts, ...(tabs.length ? { tabs } : {}) }
}

// ── Store ─────────────────────────────────────────────────────────────────────────────────────

const [dashboards, setDashboards] = createSignal<DashboardState>(emptyDashboards())
export { dashboards }

export const hydrateDashboards = (value: DashboardState): void => void setDashboards(value)

export const panelDefinition = (id: PanelId): PanelDefinition | undefined => dashboards().panels[id]

/** The panels placed in a scope, in order. A reference with no definition is skipped: the render-time
 *  half of the retain-inert rule, and why parsing never filters. */
export const panelsAt = (scope: PlacementScope): PanelDefinition[] => {
  const state = dashboards()
  return (state.placements[placementScopeKey(scope)] ?? []).flatMap((id) => {
    const panel = state.panels[id]
    return panel ? [panel] : []
  })
}

/** The arranged geometry of a scope, ready to render: every placed panel has a rect, nothing overlaps,
 *  and everything has floated up.
 *
 *  `normalize` runs on the way out rather than in, so the persisted blob is never rewritten just
 *  because it was read. A client that only looks at a board must not change it for every other client
 *  paired with the node. */
export const layoutAt = (scope: PlacementScope): PanelLayout => {
  const state = dashboards()
  const key = placementScopeKey(scope)
  const order = (state.placements[key] ?? []).filter((id) => state.panels[id])
  const stored = state.layouts[key] ?? {}
  // Only the rects of panels actually placed here. A retained entry for a panel since unplaced is
  // carried in storage but must not occupy space in the grid.
  const rects = Object.fromEntries(order.flatMap((id) => (stored[id] ? [[id, stored[id]] as const] : [])))
  return normalize({ order, rects }, (id) => sizeFor(state.panels[id]?.view.kind ?? 'list'))
}

/** Commit a gesture. Writes the rects and rewrites `placements` to reading order, which keeps an old
 *  client's order-only render sensible, makes the narrow-window collapse well-defined, and matches
 *  document order to visual order for a screen reader. */
export const setLayoutAt = (scope: PlacementScope, layout: PanelLayout): void =>
  void setDashboards((state) => {
    const key = placementScopeKey(scope)
    const ordered = readingOrder(layout)
    // Retained entries for panels not placed here survive: dropping them would make a partially-written
    // blob destructive, and `layoutAt` already ignores them.
    const rects = { ...(state.layouts[key] ?? {}), ...layout.rects }
    return {
      ...state,
      placements: { ...state.placements, [key]: ordered },
      layouts: { ...state.layouts, [key]: rects },
    }
  })

export const savePanel = (panel: PanelDefinition): void =>
  void setDashboards((state) => ({ ...state, panels: { ...state.panels, [panel.id]: panel } }))

/** Deletes the definition and every reference to it, geometry included. A placement pointing at nothing
 *  is the one dangling case that's a bug rather than a version skew. */
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
    return { ...state, panels, placements, layouts }
  })

/** Place a panel, or move one already placed. `index` is where it lands; past the end appends. */
export const placePanel = (scope: PlacementScope, id: PanelId, index?: number): void =>
  void setDashboards((state) => {
    const key = placementScopeKey(scope)
    const without = (state.placements[key] ?? []).filter((candidate) => candidate !== id)
    const at = index === undefined ? without.length : Math.max(0, Math.min(without.length, Math.floor(index)))
    return { ...state, placements: { ...state.placements, [key]: [...without.slice(0, at), id, ...without.slice(at)] } }
  })

/** Place a panel at a starting size, which is the wizard's commit.
 *
 *  The size is a preset the person picked (layout.ts § sizePresets): it's first-fitted against what's
 *  already there and then run through the ordinary `normalize` path, so what lands is a rect like any
 *  other. Nothing persisted learns that a preset existed, so the table can be retuned without a
 *  migration.
 *
 *  Call `savePanel` first: the normalise pass asks each placed panel for its view kind's minimums. */
export function placePanelAt(scope: PlacementScope, id: PanelId, size: { w: number; h: number }): void {
  const before = layoutAt(scope)
  placePanel(scope, id)
  const rect = firstFit(Object.values(before.rects), size)
  const order = [...before.order.filter((candidate) => candidate !== id), id]
  const sizeOf = (panelId: PanelId) => sizeFor(dashboards().panels[panelId]?.view.kind ?? 'list')
  setLayoutAt(scope, normalize({ order, rects: { ...before.rects, [id]: rect } }, sizeOf))
}

/** Take a panel off one surface. Its definition survives, which is the point of the split. */
export const unplacePanel = (scope: PlacementScope, id: PanelId): void =>
  void setDashboards((state) => {
    const key = placementScopeKey(scope)
    return { ...state, placements: { ...state.placements, [key]: (state.placements[key] ?? []).filter((candidate) => candidate !== id) } }
  })

/** Create, rename and reorder, all the same write: names and order are the whole of what `tabs` holds.
 *  Held to the codec's own caps, so a store write and a parsed blob can't disagree. */
export const setHomeTabs = (tabs: readonly DashboardTab[]): void =>
  void setDashboards((state) => {
    const parsed = parseTabs(tabs)
    const { tabs: _dropped, ...rest } = state
    return parsed.length ? { ...rest, tabs: parsed } : rest
  })

/** Delete a tab: its name, its placement list and its geometry. Definitions survive, so every panel
 *  stays in the library and on every other surface.
 *
 *  The default tab isn't deletable. "Delete" of the bare scope would just be "empty it", and it's the
 *  one tab that has to remain reachable. */
export const removeHomeTab = (tabId: string): void =>
  void setDashboards((state) => {
    if (!tabId) return state
    const key = placementScopeKey(homeTabScope(tabId))
    const { [key]: _panels, ...placements } = state.placements
    const { [key]: _rects, ...layouts } = state.layouts
    const { tabs: _named, ...rest } = state
    const tabs = (state.tabs ?? []).filter((tab) => tab.id !== tabId)
    return { ...rest, placements, layouts, ...(tabs.length ? { tabs } : {}) }
  })

// ── Slice ─────────────────────────────────────────────────────────────────────────────────────

export const dashboardsSlice: PersistedStateSlice<DashboardState> = {
  id: 'core.dashboards',
  key: PrefKeys.dashboards,
  // `app`, and one blob rather than a key per panel: the whole model is read together on every surface
  // that draws one, and a key per panel would need a scope registration and an eviction rule for a
  // short list. The precedent is `agentTools.perms`.
  scope: 'app',
  restore: 'view',
  version: 1,
  codec: { parse: parseDashboards, serialize: (value) => value },
  empty: emptyDashboards,
  unknownIds: 'retain-inert',
  maxBytes: 64 * 1024,
  binding: appStateBinding(dashboards, hydrateDashboards),
}

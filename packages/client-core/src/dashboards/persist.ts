import { createSignal } from 'solid-js'
import { isRecord, parsePanelDefinition, parsePanels } from '@acorn/dashboards-core/definition.ts'
import { PrefKeys } from '../persistence/prefKeys'
import { appStateBinding, parseJson, type PersistedStateSlice } from '../persistence/persistedState'
import { COLS, firstFit, normalize, readingOrder, sizeFor, type PanelLayout, type Rect } from './layout'
import type { PanelDefinition, PanelId } from './model'

export { parsePanelDefinition }

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

/** A Home tab IS the scope `{ surface: 'home', ownerId: tabId }` (docs/future/dashboards/tabs.md).
 *  The default tab's id is `''`, which `placementScopeKey` collapses back to the bare `home` key —
 *  so every blob written before tabs existed is already a valid one-tab state. */
export const homeTabScope = (tabId: string): PlacementScope => ({ surface: 'home', ownerId: tabId })

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
  /** The named Home tabs, in display order. Additive and OPTIONAL — absent, or one entry, means no
   *  tab bar and Home renders exactly as it did before tabs existed (tabs.md § The data model).
   *
   *  Only names and order live here. A tab's CONTENT is ordinary `placements`/`layouts` under the
   *  `home/<tabId>` key, which is why an old client that drops this key loses the names and keeps
   *  every panel — and why `homeTabs` can recover an unnamed scope rather than orphan it. */
  tabs?: DashboardTab[]
}

/** `id: ''` is the default tab (the bare `home` scope). */
export type DashboardTab = { id: string; name: string }

export const emptyDashboards = (): DashboardState => ({ panels: {}, placements: {}, layouts: {} })

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

// ── The tab codec ─────────────────────────────────────────────────────────────────────────────
//
// The usual posture, and two caps that are product decisions rather than storage ones: a person with
// nine dashboards has a navigation problem tabs cannot fix, and a 200-character tab name is not a tab
// name. An over-long name is TRUNCATED rather than dropped, because dropping the entry would strand
// its panels behind a recovered "Untitled" for no gain.

export const MAX_TABS = 8
const MAX_TAB_NAME = 60

const parseTabs = (raw: unknown): DashboardTab[] => {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const tabs: DashboardTab[] = []
  for (const entry of raw) {
    if (tabs.length >= MAX_TABS) break
    if (!isRecord(entry)) continue
    // `''` is a legal id — it is the default tab — so the check is the TYPE, not truthiness.
    const { id, name } = entry
    if (typeof id !== 'string' || typeof name !== 'string' || !name.trim() || seen.has(id)) continue
    seen.add(id)
    tabs.push({ id, name: name.trim().slice(0, MAX_TAB_NAME) })
  }
  return tabs
}

/** The tab id a placement key names, or `undefined` for a key that is not a Home tab's. `home` is the
 *  default tab; `home/<id>` is a named one; anything longer carries a `projectId` segment, which no
 *  tab has. */
export const homeTabIdOf = (key: string): string | undefined => {
  const segments = key.split('/')
  if (segments[0] !== 'home' || segments.length > 2) return undefined
  return decodeURIComponent(segments[1] ?? '')
}

/** The tabs to render: the named ones in order, then any `home/*` scope that has placements but no
 *  name, appended as "Untitled".
 *
 *  ONE RULE DOING THREE JOBS (tabs.md § Survival rules). It is the recovery from an old client that
 *  wrote the slice and dropped `tabs`; it is the defence against a partially-written blob; and it is
 *  why deleting a name can never be what deletes a composition. The bare `home` scope is always a
 *  candidate whether or not it holds panels — it is the default tab and it has no delete, so it must
 *  never become unreachable.
 *
 *  Empty when the blob names no tabs: one dashboard draws no bar, and Home is pixel-identical to what
 *  it was before this key existed. */
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
  // Definitions and placements come from the SHARED codec, which the node's measure sampler also
  // calls (@acorn/dashboards-core/definition.ts). Two parsers over one blob is how a client and a
  // node come to disagree about what a panel is; geometry stays here because a rect is a rendering
  // concern and the node has no use for one.
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

/** Place a panel AT A STARTING SIZE — the wizard's commit (docs/future/dashboards/wizard.md § Place).
 *
 *  The size is a preset the person picked (layout.ts § sizePresets) and nothing more: it is
 *  first-fitted against what is already there and then run through the ordinary `normalize` path, so
 *  what lands is a rect like any other. NOTHING PERSISTED LEARNS THAT A PRESET EXISTED — the table can
 *  be retuned, or the whole idea dropped, without a migration.
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

/** Create, rename and reorder, all of them the same write: names and order are the whole of what
 *  `tabs` holds. Held to the codec's own caps so a store write and a parsed blob cannot disagree. */
export const setHomeTabs = (tabs: readonly DashboardTab[]): void =>
  void setDashboards((state) => {
    const parsed = parseTabs(tabs)
    const { tabs: _dropped, ...rest } = state
    return parsed.length ? { ...rest, tabs: parsed } : rest
  })

/** Delete a tab: its name, its placement list and its geometry. DEFINITIONS SURVIVE — every panel
 *  stays in the library and on every other surface, which is the whole point of the placement split
 *  and what the armed confirm's copy promises.
 *
 *  The default tab is not deletable. "Delete" of the bare scope would just be "empty it", and it is
 *  the one tab that has to remain reachable. */
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

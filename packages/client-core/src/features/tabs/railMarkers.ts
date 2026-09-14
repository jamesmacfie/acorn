// Rail status markers: the pure half. A marker is a small non-interactive status icon drawn around
// the outside edge of a rail control (see RailTab.tsx). This module owns validation, deterministic
// ordering, and which corner each marker ends up in. It imports neither Solid nor a registry, so it
// stays testable in the Node-only client-core suite.
//
// Placement is the host's, never the contributor's: a marker asks for an ordered list of positions
// and gets the first one still free. Anything that misses out stays in the tooltip legend, because
// a rail square can hide an icon but must never hide a state.

export type RailTone = 'neutral' | 'accent' | 'warn' | 'danger'

export type RailMarkerDot = 'ok' | 'warn' | 'bad' | 'mixed'

export type RailMarkerPosition =
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end'
  // Reserved for host lifecycle and activity (archiving, agents working). Plugins don't get it: it
  // sits under the main glyph rather than in a corner, and two things there read as one broken one.
  | 'bottom-center'

export const RAIL_MARKER_POSITIONS: readonly RailMarkerPosition[] =
  ['top-start', 'top-end', 'bottom-start', 'bottom-end', 'bottom-center']

export const RAIL_MARKER_CORNERS: readonly RailMarkerPosition[] =
  ['top-end', 'top-start', 'bottom-end', 'bottom-start']

export type RailMarker = {
  id: string
  label: string // what the state means, in words; feeds the tooltip legend and the a11y description
  icon?: string // an Icon name; exactly one of icon or dotTone
  dotTone?: RailMarkerDot
  tone?: RailTone
  busy?: boolean // spin this marker's icon, or pulse its dot. Does not make the whole control busy.
  placements: readonly RailMarkerPosition[] // preferences, in order, never guarantees
  priority?: number
}

export type PlacedRailMarker = RailMarker & { position: RailMarkerPosition }

// One legend row, mirroring one marker: its glyph (`g`) or StatusDot tone (`d`), a colour tone
// (`t`), and its meaning (`l`). ui/tips.tsx renders these; RailTab serialises them.
export type RailLegendItem = { g?: string; d?: RailMarkerDot; t?: RailTone; l: string }

export type ResolvedRailMarkers = {
  placed: readonly PlacedRailMarker[]
  legend: readonly RailLegendItem[]
}

// Contributed markers are clamped into this range so a plugin can order its own markers among
// themselves without outranking a core lifecycle state. Host priorities live above it.
export const RAIL_MARKER_PLUGIN_MAX_PRIORITY = 100

export function clampMarkerPriority(priority: number | undefined): number {
  if (typeof priority !== 'number' || !Number.isFinite(priority)) return 0
  return Math.min(RAIL_MARKER_PLUGIN_MAX_PRIORITY, Math.max(0, Math.round(priority)))
}

export function isValidRailMarker(marker: RailMarker): boolean {
  if (!marker?.id || !marker.label) return false
  // Exactly one representation. A marker with both is ambiguous; one with neither is invisible.
  if (!!marker.icon === !!marker.dotTone) return false
  if (!Array.isArray(marker.placements) || !marker.placements.length) return false
  return marker.placements.every((position) => RAIL_MARKER_POSITIONS.includes(position))
}

/** Order, place, and legend a control's markers. Invalid markers are dropped, not thrown over. */
export function resolveRailMarkers(markers: readonly RailMarker[]): ResolvedRailMarkers {
  // Ids are qualified by their contributor before they get here, so id order settles ties between
  // contributions as well as within one. That keeps the result independent of activation order.
  const ordered = markers
    .filter(isValidRailMarker)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id))
  const taken = new Set<RailMarkerPosition>()
  const placed: PlacedRailMarker[] = []
  for (const marker of ordered) {
    const position = marker.placements.find((candidate) => !taken.has(candidate))
    if (!position) continue
    taken.add(position)
    placed.push({ ...marker, position })
  }
  return {
    placed,
    // Every marker, placed or not. The tooltip is where an overflowing state survives.
    legend: ordered.map((marker) => ({ g: marker.icon, d: marker.dotTone, t: marker.tone, l: marker.label })),
  }
}

// The compiled-plugin feeder for rail status markers (docs/plugins.md § Rail markers). A plugin
// publishes marker data next to the state that owns it; the host draws the pixels.
//
// JSX-free by design, like ./slots.ts: registries/plugin.ts imports this, and that file has to stay
// importable in the Node-only client-core suite (docs/frontend.md § Registries and plugins).
import { clampMarkerPriority, type RailMarker } from '../../../features/tabs/railMarkers'
import { Registry } from '../../../kit/lib/registry'

export type RailMarkerTarget =
  | { kind: 'task'; id: string }
  | { kind: 'source'; id: string }
  | { kind: 'pane'; id: string; taskId: string }

export type RailMarkerContribution = {
  id: string
  order: number
  /**
   * Called during the consuming render, so a contribution can read signals it already owns and the
   * rail re-renders when they change. Return an empty list for targets you have nothing to say
   * about; this runs for every visible control.
   */
  markers(target: RailMarkerTarget): readonly RailMarker[]
}

export const railMarkerRegistry = new Registry<RailMarkerContribution>('rail-marker')

/**
 * Every contributed marker for one control, qualified and clamped, ready for resolveRailMarkers.
 * One failing contribution is isolated: a plugin's broken getter must not blank the whole rail.
 */
/** The contributions in draw order, sorted once per registry change.
 *
 *  `markersFor` is called per row per render — every task in the rail, on every redraw of it — and it
 *  used to copy and `localeCompare`-sort the whole registry each time. The registry is a signal, so
 *  the sorted list is cached against the array it was sorted from: reading `entries()` keeps the
 *  caller reactive, and the identity check keeps the sort to once per register or unregister
 *  (docs/performance.md § 2026-09-03 — phase 9). A `createMemo` would say the
 *  same thing, and this file is imported by `registries/plugin.ts` and has no root to own one. */
let sortedFrom: readonly RailMarkerContribution[] | null = null
let sorted: RailMarkerContribution[] = []

const inOrder = (): readonly RailMarkerContribution[] => {
  const entries = railMarkerRegistry.entries()
  if (entries === sortedFrom) return sorted
  sortedFrom = entries
  sorted = [...entries].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return sorted
}

export function markersFor(target: RailMarkerTarget): RailMarker[] {
  const contributions = inOrder()
  const markers: RailMarker[] = []
  for (const contribution of contributions) {
    try {
      for (const marker of contribution.markers(target)) {
        // Qualified by contributor, so two plugins can both call a marker `running` and the
        // allocator's id tiebreak stays stable.
        markers.push({ ...marker, id: `${contribution.id}:${marker.id}`, priority: clampMarkerPriority(marker.priority) })
      }
    } catch (error) {
      console.warn(`[rail-markers] contribution '${contribution.id}' failed`, error)
    }
  }
  return markers
}

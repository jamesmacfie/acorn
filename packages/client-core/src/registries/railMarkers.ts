// The compiled-plugin feeder for rail status markers (docs/plugins.md § Rail markers). A plugin
// publishes marker data next to the state that owns it; the host draws the pixels.
//
// JSX-free by design, like ./slots.ts: registries/plugin.ts imports this, and that file has to stay
// importable in the Node-only client-core suite (docs/frontend.md § Registries and plugins).
import { clampMarkerPriority, type RailMarker } from '../tabs/railMarkers'
import { Registry } from './registry'

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
export function markersFor(target: RailMarkerTarget): RailMarker[] {
  const contributions = [...railMarkerRegistry.entries()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
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

// `core:task`: what other plugins know about a task, drawn on its rail row.
//
// Core declares the point in @acorn/protocol/extensionPoints.ts because core has no manifest to declare
// it in. Everything else is the shared annotation machinery in ./annotations.ts.
//
// A rail row is a 52-pixel square, so a mark can't be a line of text the way it is on a diff line: the
// icon takes a free corner and the words go in the hover legend, as the rail does for core's own states
// (`RailMarker`). So this module is a rail-marker contribution rather than a draw site
// (docs/plugins/rows-and-annotations.md § Task annotations).
//
// Registered at module scope on purpose: the rail is the only thing that imports this, so the point
// exists exactly when there is a rail to draw it on.
import { CORE_TASK_KEY, CORE_TASK_POINT, type AnnotationSeverity } from '@acorn/protocol/extensionPoints.ts'
import { annotationsFor, requestAnnotations, type StampedMark } from './annotations'
import { extensionPointRegistry } from '../registries/extensionPoints/extensionPoints'
import { railMarkerRegistry } from '../registries/rail/railMarkerFeed'
import {
  RAIL_MARKER_CORNERS,
  type RailMarker,
  type RailMarkerDot,
  type RailTone,
} from '../../features/tabs/railMarkers'

extensionPointRegistry.register({
  id: CORE_TASK_POINT,
  ownerId: 'core',
  label: 'Task row',
  kind: 'annotation',
  key: CORE_TASK_KEY,
  // Four corners, so four is the placement ceiling. A fifth mark is not dropped: it stays in the
  // hover legend, which is where an overflowing state survives on this rail.
  max: 4,
  acceptedMarks: 256,
})

const TONE: Record<AnnotationSeverity, RailTone> = { info: 'neutral', warn: 'warn', danger: 'danger' }
const DOT: Record<AnnotationSeverity, RailMarkerDot> = { info: 'ok', warn: 'warn', danger: 'bad' }

/**
 * Accepted marks as rail markers. `core:source` and `core:pane` draw through this too
 * (./statusAnnotations.ts), so a mark reads the same on every rail control.
 *
 * The contributor is named in the label rather than beside the icon, because the legend is the only
 * place on this control with room for words, and a person reading "staging deploy failed" is entitled
 * to know which package said so — the same rule `AnnotationMarks` follows where it has the width.
 *
 * The index is part of the id so two marks from one plugin do not collide; `markersFor` qualifies the
 * whole thing with this contribution's id before the allocator sees it, and the allocator's own
 * tiebreak is on that id, so the order is stable whatever sequence the answers arrive in.
 */
export const annotationRailMarkers = (marks: readonly StampedMark[]): RailMarker[] =>
  marks.map((mark, index) => ({
    id: `${mark.pluginId}:${index}`,
    label: `${mark.text} — ${mark.pluginId}`,
    // Exactly one of the two, which is what `isValidRailMarker` insists on. A contributor that named
    // no icon still gets a dot, so a mark is never invisible.
    ...(mark.icon ? { icon: mark.icon } : { dotTone: DOT[mark.severity] }),
    tone: TONE[mark.severity],
    placements: RAIL_MARKER_CORNERS,
  }))

/** One task's marks as rail markers. */
export const taskAnnotationMarkers = (taskId: string): RailMarker[] =>
  annotationRailMarkers(annotationsFor(CORE_TASK_POINT, { task: taskId }))

railMarkerRegistry.register({
  id: CORE_TASK_POINT,
  order: 0,
  markers: (target) => (target.kind === 'task' ? taskAnnotationMarkers(target.id) : []),
})

/** Ask every contributor about the rows on screen, in one request each. Idempotent for a task list it
 *  has already asked about, so the rail's own re-renders cost a string compare. */
export const requestTaskAnnotations = (taskIds: readonly string[]): void =>
  requestAnnotations(
    CORE_TASK_POINT,
    taskIds.map((task) => ({ task })),
  )

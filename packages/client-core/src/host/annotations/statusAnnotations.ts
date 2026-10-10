// `core:source` and `core:pane`: what other plugins know about a rail source or a task pane, drawn on
// its icon (docs/plugins/rows-and-annotations.md § Source and pane annotations).
//
// The same shape as `core:task` (./taskAnnotations.ts) with one difference: the owner consents. A
// source or task pane that declares `statusAnnotations: true` is asked about, and nothing else is. The
// rail and the pane switcher hand this module what they draw; it picks the consenting owners, asks each
// contributor once for the lot through the shared host (./annotations.ts), and reads marks back only for
// the keys it asked about. The marks reach every rail control through the marker feed, so the default
// rail, a replacement rail, and both pane switchers get the same data.
import { createSignal } from 'solid-js'
import {
  CORE_PANE_KEY,
  CORE_PANE_POINT,
  CORE_SOURCE_KEY,
  CORE_SOURCE_POINT,
  type PluginAnnotationKey,
} from '@acorn/protocol/extensionPoints.ts'
import { annotationsFor, clearAnnotations, requestAnnotations } from './annotations'
import { annotationRailMarkers } from './taskAnnotations'
import { extensionPointRegistry } from '../registries/extensionPoints/extensionPoints'
import { railMarkerRegistry } from '../registries/rail/railMarkerFeed'
import { sourceRegistry } from '../registries/sources/sources'

// Four corners, as on a task row. A fifth mark stays in the legend.
extensionPointRegistry.register({ id: CORE_SOURCE_POINT, ownerId: 'core', label: 'Rail source', kind: 'annotation', key: CORE_SOURCE_KEY, max: 4, acceptedMarks: 256 })
extensionPointRegistry.register({ id: CORE_PANE_POINT, ownerId: 'core', label: 'Task pane button', kind: 'annotation', key: CORE_PANE_KEY, max: 4, acceptedMarks: 256 })

/** The project each asked source was keyed with. A source missing here was not asked about. */
const [askedSources, setAskedSources] = createSignal<ReadonlyMap<string, string>>(new Map())
/** The task and panes the switcher asked about, or null while no switcher is asking. */
const [askedPanes, setAskedPanes] = createSignal<{ taskId: string; paneIds: ReadonlySet<string> } | null>(null)

// The consenting registrations each point last asked for, by identity. A reloaded or removed owner
// takes its marks with it, even when the visible ids come back the same.
const askedOwners = new Map<string, readonly object[]>()

function ask(pointId: string, owners: readonly object[], keys: readonly PluginAnnotationKey[]): void {
  const previous = askedOwners.get(pointId) ?? []
  if (previous.length !== owners.length || previous.some((owner, index) => owner !== owners[index])) clearAnnotations(pointId)
  askedOwners.set(pointId, owners)
  // No empty batch: nothing could draw its answer.
  if (keys.length) requestAnnotations(pointId, keys)
}

/**
 * Ask about the sources the rail draws. A project-scoped source is keyed by the routed project and
 * skipped while there is none; any other source is keyed by `''`. Idempotent for an unchanged set.
 */
export function requestSourceAnnotations(sourceIds: readonly string[], routedProjectId: string | null | undefined): void {
  const owners: object[] = []
  const keys: PluginAnnotationKey[] = []
  const asked = new Map<string, string>()
  for (const sourceId of new Set(sourceIds)) {
    const source = sourceRegistry.get(sourceId)
    if (!source?.statusAnnotations) continue
    const projectId = source.projectScoped ? routedProjectId : ''
    if (projectId == null || (source.projectScoped && !projectId)) continue
    owners.push(source)
    keys.push({ sourceId, projectId })
    asked.set(sourceId, projectId)
  }
  ask(CORE_SOURCE_POINT, owners, keys)
  setAskedSources(asked)
}

/** Ask about the panes one task's switcher draws. Pass the pane registrations it draws. */
export function requestPaneAnnotations(taskId: string, panes: readonly { id: string; statusAnnotations?: boolean }[]): void {
  const consenting = panes.filter((pane) => pane.statusAnnotations)
  ask(CORE_PANE_POINT, consenting, consenting.map((pane) => ({ paneId: pane.id, taskId })))
  setAskedPanes(consenting.length ? { taskId, paneIds: new Set(consenting.map((pane) => pane.id)) } : null)
}

/** The switcher for this task went away: drop its marks, unless another task's switcher asked since. */
export function releasePaneAnnotations(taskId: string): void {
  if (askedPanes()?.taskId === taskId) requestPaneAnnotations(taskId, [])
}

railMarkerRegistry.register({
  id: CORE_SOURCE_POINT,
  order: 0,
  markers: (target) => {
    if (target.kind !== 'source') return []
    const projectId = askedSources().get(target.id)
    return projectId === undefined ? [] : annotationRailMarkers(annotationsFor(CORE_SOURCE_POINT, { sourceId: target.id, projectId }))
  },
})

railMarkerRegistry.register({
  id: CORE_PANE_POINT,
  order: 0,
  markers: (target) => {
    if (target.kind !== 'pane') return []
    const asked = askedPanes()
    if (asked?.taskId !== target.taskId || !asked.paneIds.has(target.id)) return []
    return annotationRailMarkers(annotationsFor(CORE_PANE_POINT, { paneId: target.id, taskId: target.taskId }))
  },
})

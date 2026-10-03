// Facts one plugin knows about the items another plugin already draws (docs/plugins/cooperative-extension-points.md § Cooperative
// extension points, the `annotation` kind).
//
// The owner registers the keys it is drawing, this module asks every contributor about all of them in
// one request, and the owner's draw site reads the marks back by key. Requests and retained results are
// partitioned by contributor; rows still read one point-level reactive map.
import { createSignal, type Accessor } from 'solid-js'
import { annotationKeyOf, type PluginAnnotationKey, type PluginAnnotationMark } from '@acorn/protocol/extensionPoints.ts'
import {
  extensionDeliveries,
  extensionPointRegistry,
  type ExtensionContribution,
  type ExtensionPointContribution,
} from '../registries/extensionPoints/extensionPoints'
import { recordSurfaceFailure } from '../plugins/surfaceFailures'
import { createLogger } from '../../infra/telemetry/logger'

/** One mark with contributor provenance stamped by the host registration. */
export type StampedMark = PluginAnnotationMark & { pluginId: string }

const log = createLogger('annotations')

type AnnotationContributionState = {
  registration: ExtensionContribution
  point: ExtensionPointContribution
  requestScope: string
  freshnessRevision: number
  keySignature: string
  controller: AbortController | null
  marksByKey: Map<string, StampedMark[]>
}

type AnnotationPointState = {
  read: Accessor<Map<string, StampedMark[]>>
  write: (next: Map<string, StampedMark[]>) => void
  contributors: Map<string, AnnotationContributionState>
  order: string[]
}

// Keep a point's signal stable across lifecycle clears. A mounted draw site is subscribed to that
// signal; replacing it while the site remains mounted would leave later answers on a new signal the
// existing reader never observed. Contributor registrations and answers are still discarded below.
const marksByPoint = new Map<string, AnnotationPointState>()

const store = (pointId: string): AnnotationPointState => {
  const existing = marksByPoint.get(pointId)
  if (existing) return existing
  const [read, write] = createSignal<Map<string, StampedMark[]>>(new Map())
  const entry: AnnotationPointState = { read, write, contributors: new Map(), order: [] }
  marksByPoint.set(pointId, entry)
  return entry
}

const sameOrder = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

/** Publish contributor maps in delivery order. Promise completion order never reaches the reader. */
const publish = (state: AnnotationPointState): void => {
  const next = new Map<string, StampedMark[]>()
  for (const id of state.order) {
    const contribution = state.contributors.get(id)
    if (!contribution) continue
    for (const [key, marks] of contribution.marksByKey) {
      next.set(key, [...(next.get(key) ?? []), ...marks])
    }
  }
  state.write(next)
}

/** The marks for one item, in registered contributor order. */
export function annotationsFor(pointId: string, key: PluginAnnotationKey): StampedMark[] {
  const point = extensionPointRegistry.get(pointId)
  if (!point?.key) return []
  return store(pointId).read().get(annotationKeyOf(point.key, key)) ?? []
}

/** Does anything currently annotate this point? This is a map read, never a fetch. */
export const hasAnnotations = (pointId: string): boolean => store(pointId).read().size > 0

/** Changes when the number of annotated keys changes, for layout consumers such as the diff. */
export const annotationSignature = (pointId: string): string => String(store(pointId).read().size)

/**
 * Ask every eligible contributor about one visible key batch.
 *
 * Eligibility, descriptor registration, request scope, freshness revision and visible keys form the
 * request identity. A changed identity aborts and clears only that contributor before its replacement
 * starts. Exact state ownership rejects late answers even when a contributor ignores AbortSignal.
 */
export function requestAnnotations(pointId: string, keys: readonly PluginAnnotationKey[]): void {
  const point = extensionPointRegistry.get(pointId)
  if (!point?.key || point.kind !== 'annotation') return
  const fields = point.key
  const keySignature = keys.map((key) => annotationKeyOf(fields, key)).join(String.fromCharCode(0))
  // These accessors are read inside the draw site's existing Solid effect. No annotation-specific
  // timer, subscription or per-row observer is needed.
  const contributions = extensionDeliveries(pointId).filter(
    (contribution): contribution is ExtensionContribution & { marks: NonNullable<ExtensionContribution['marks']> } =>
      contribution.marks !== undefined,
  )
  const state = store(pointId)
  const nextOrder = contributions.map((contribution) => contribution.id)
  let changed = !sameOrder(state.order, nextOrder)
  state.order = nextOrder

  const eligible = new Set<ExtensionContribution>(contributions)
  for (const [id, existing] of state.contributors) {
    if (eligible.has(existing.registration)) continue
    existing.controller?.abort()
    state.contributors.delete(id)
    changed = true
  }

  for (const contribution of contributions) {
    const requestScope = contribution.requestScope?.() ?? 'local'
    const freshnessRevision = contribution.freshnessRevision?.() ?? 0
    const existing = state.contributors.get(contribution.id)
    if (
      existing?.registration === contribution
      && existing.point === point
      && existing.requestScope === requestScope
      && existing.freshnessRevision === freshnessRevision
      && existing.keySignature === keySignature
    ) continue

    existing?.controller?.abort()
    const controller = new AbortController()
    const requestState: AnnotationContributionState = {
      registration: contribution,
      point,
      requestScope,
      freshnessRevision,
      keySignature,
      controller,
      marksByKey: new Map(),
    }
    state.contributors.set(contribution.id, requestState)
    changed = true

    void contribution.marks([...keys], controller.signal).then((answer) => {
      if (state.contributors.get(contribution.id) !== requestState || controller.signal.aborted) return
      const limit = point.acceptedMarks ?? Number.POSITIVE_INFINITY
      if (answer.length > limit) {
        log.warn(`${contribution.pluginId} returned too many marks for ${pointId}; ignored ${answer.length - limit}`, undefined, {
          'plugin.id': contribution.pluginId,
          'annotation.point': pointId,
          'annotation.rows': answer.length,
          'annotation.limit': limit,
        })
      }
      const marksByKey = new Map<string, StampedMark[]>()
      for (const mark of answer.slice(0, limit)) {
        const stamped: StampedMark = { ...mark, pluginId: contribution.pluginId }
        const lookup = annotationKeyOf(fields, mark.key)
        marksByKey.set(lookup, [...(marksByKey.get(lookup) ?? []), stamped])
      }
      requestState.controller = null
      requestState.marksByKey = marksByKey
      publish(state)
    }).catch((error: unknown) => {
      if (state.contributors.get(contribution.id) !== requestState || controller.signal.aborted) return
      requestState.controller = null
      recordSurfaceFailure(contribution.pluginId, contribution.id, error)
    })
  }

  // Stale marks disappear in the same turn. Successful answers later fill only their own partition.
  if (changed) publish(state)
}

/** Abort, discard contributor partitions, and synchronously notify every existing reader. */
export function clearAnnotations(pointId?: string): void {
  if (pointId === undefined) {
    for (const point of marksByPoint.values()) {
      for (const contribution of point.contributors.values()) contribution.controller?.abort()
      point.contributors.clear()
      point.order = []
      point.write(new Map())
    }
    return
  }
  const state = marksByPoint.get(pointId)
  if (state) {
    for (const contribution of state.contributors.values()) contribution.controller?.abort()
    state.contributors.clear()
    state.order = []
    state.write(new Map())
  }
}

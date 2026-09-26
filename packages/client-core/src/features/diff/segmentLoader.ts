import { batch } from 'solid-js'
import { createStore } from 'solid-js/store'
import { MAX_SEGMENTS_PER_REQUEST, segmentContentKey, type DiffSegmentPayload, type DiffSegmentRequest } from '@acorn/diff-document/document'
import { diffRowsFromPlain, type DiffRow } from '../../kit/diff/diffModel'
import type { SegmentRef } from './documentView'

// Loads and colours the segments near the reader, and nothing else (docs/diff-rendering.md § Parsing
// and highlighting).
//
// The viewer says which segments are on screen and which are near, every time its range moves. The
// loader asks the source for the missing ones in small batches, the ones on screen first, and forgets
// any queued segment the reader has since scrolled away from, so a pane left open does no more work
// than its range needs. A loaded segment publishes its plain rows at once; syntax and word colouring
// follow in a second queue with the same demand, and replace the rows under the same index when they
// land. Held segments are bounded, least recently wanted first out.

export type SegmentStatus = 'loading' | 'loaded' | 'error'

type Entry = { ref: SegmentRef; rows: DiffRow[]; enriched: boolean; visited: boolean; bytes: number }

/** Segments held for the open document. Enough for the viewport, the runway either side, and a
 *  reader flicking back and forth; phase 4 of docs/future/git-inspired/ replaces this with a shared
 *  weighted cache. */
const RESIDENT_SEGMENTS = 96
/** Requests in flight at once. A second lets the next range start while one is still answering. */
const MAX_IN_FLIGHT = 2
/** Segments per request: a viewport's worth, so the visible ones are one round trip. */
const BATCH_SEGMENTS = Math.min(8, MAX_SEGMENTS_PER_REQUEST)

const weigh = (rows: readonly DiffRow[]) => {
  let bytes = 0
  for (const row of rows) bytes += 32 + ('raw' in row ? row.raw.length * 2 : 'text' in row ? row.text.length * 2 : 0)
  return bytes
}

export function createSegmentLoader(options: {
  load: (requests: DiffSegmentRequest[], signal: AbortSignal) => Promise<DiffSegmentPayload[]>
  /** Colour one segment's rows. Answers new rows, never rejects. */
  enrich: (rows: DiffRow[]) => Promise<DiffRow[]>
  /** Time spent turning payloads into rows and applying colour, for the health reading. */
  prepared?: (ms: number) => void
}) {
  const resident = new Map<string, Entry>()
  // Read per key by the rows that draw a segment, so a publish redraws that segment and no other.
  // Numbers and strings, set one key at a time: a store merges an object set by path into the old one.
  const [versions, setVersions] = createStore<Record<string, number>>({})
  const [statuses, setStatuses] = createStore<Record<string, SegmentStatus | undefined>>({})
  /** Which segment and plain row each built row came from, so find can mark a match on the row it
   *  names. */
  const places = new WeakMap<object, { contentKey: string; index: number }>()

  let wanted: SegmentRef[] = []
  let wantedKeys = new Set<string>()
  let visibleKeys = new Set<string>()
  const inFlight = new Map<AbortController, string[]>()
  const loading = new Set<string>()
  let enriching: string | null = null
  let generation = 0
  let disposed = false

  const bump = (key: string) => setVersions(key, (versions[key] ?? 0) + 1)

  const store = (ref: SegmentRef, rows: DiffRow[], enriched: boolean) => {
    rows.forEach((row, index) => places.set(row, { contentKey: ref.contentKey, index }))
    const previous = resident.get(ref.contentKey)
    resident.delete(ref.contentKey)
    resident.set(ref.contentKey, { ref, rows, enriched, visited: previous?.visited || visibleKeys.has(ref.contentKey), bytes: weigh(rows) })
  }

  const evict = () => {
    if (resident.size <= RESIDENT_SEGMENTS) return
    for (const [key] of resident) {
      if (resident.size <= RESIDENT_SEGMENTS) break
      if (wantedKeys.has(key)) continue
      resident.delete(key)
      batch(() => {
        setStatuses(key, undefined)
        bump(key)
      })
    }
  }

  const pump = () => {
    if (disposed) return
    const queue = wanted.filter((ref) => !resident.has(ref.contentKey) && !loading.has(ref.contentKey) && statuses[ref.contentKey] !== 'error')
    while (inFlight.size < MAX_IN_FLIGHT && queue.length) {
      const refs = queue.splice(0, BATCH_SEGMENTS)
      const keys = refs.map((ref) => ref.contentKey)
      const controller = new AbortController()
      inFlight.set(controller, keys)
      for (const key of keys) loading.add(key)
      batch(() => { for (const key of keys) setStatuses(key, 'loading') })
      const byKey = new Map(refs.map((ref) => [ref.contentKey, ref]))
      const requests = refs.map((ref): DiffSegmentRequest => ({ path: ref.file.path, patchKey: ref.file.patchKey!, ordinal: ref.ordinal }))
      const at = generation
      void options.load(requests, controller.signal).then(
        (payloads) => {
          if (at !== generation || controller.signal.aborted) return
          const started = performance.now()
          const answered = new Set<string>()
          batch(() => {
            for (const payload of payloads) {
              const key = segmentContentKey(payload.patchKey, payload.ordinal)
              const ref = byKey.get(key)
              if (!ref) continue
              answered.add(key)
              store(ref, diffRowsFromPlain(ref.file.path, ref.file.sha, payload.rows), false)
              setStatuses(key, 'loaded')
              bump(key)
            }
            for (const key of keys) if (!answered.has(key)) setStatuses(key, 'error')
          })
          options.prepared?.(performance.now() - started)
        },
        () => {
          if (at !== generation || controller.signal.aborted) return
          batch(() => { for (const key of keys) setStatuses(key, 'error') })
        },
      ).finally(() => {
        inFlight.delete(controller)
        for (const key of keys) loading.delete(key)
        if (at !== generation) return
        evict()
        pump()
        enrichNext()
      })
    }
  }

  // One segment at a time, nearest first, and only while it is still wanted.
  const enrichNext = () => {
    if (disposed || enriching) return
    const next = wanted.find((ref) => {
      const entry = resident.get(ref.contentKey)
      return entry && !entry.enriched && !ref.descriptor.oversize
    })
    if (!next) return
    const entry = resident.get(next.contentKey)!
    enriching = next.contentKey
    const at = generation
    void options.enrich(entry.rows).then((rows) => {
      enriching = null
      if (at !== generation) return
      // The same rows it started from, or the segment was evicted or replaced meanwhile and this
      // colouring belongs to nothing on screen.
      if (resident.get(next.contentKey) !== entry) return enrichNext()
      const started = performance.now()
      store(next, rows, true)
      bump(next.contentKey)
      options.prepared?.(performance.now() - started)
      enrichNext()
    })
  }

  return {
    /** A segment's rows, or undefined while it is not loaded. Reactive per segment. */
    rows: (contentKey: string): readonly DiffRow[] | undefined => {
      void versions[contentKey]
      return resident.get(contentKey)?.rows
    },
    status: (contentKey: string): SegmentStatus | undefined => statuses[contentKey],
    place: (row: object): { contentKey: string; index: number } | undefined => places.get(row),
    /**
     * What the reader can see and what is near it, nearest first. Queued work for anything else is
     * dropped, and a request whose every segment has left the range is aborted.
     */
    demand: (visible: readonly SegmentRef[], near: readonly SegmentRef[]) => {
      visibleKeys = new Set(visible.map((ref) => ref.contentKey))
      const seen = new Set<string>()
      wanted = [...visible, ...near].filter((ref) => !seen.has(ref.contentKey) && seen.add(ref.contentKey))
      wantedKeys = seen
      for (const key of visibleKeys) {
        const entry = resident.get(key)
        if (entry) {
          entry.visited = true
          // Touched, so the least recently wanted segment is the first evicted.
          resident.delete(key)
          resident.set(key, entry)
        }
      }
      for (const [controller, keys] of inFlight) {
        if (keys.every((key) => !wantedKeys.has(key))) {
          controller.abort()
          inFlight.delete(controller)
          for (const key of keys) {
            loading.delete(key)
            setStatuses(key, undefined)
          }
        }
      }
      pump()
      enrichNext()
    },
    retry: (contentKey: string) => {
      setStatuses(contentKey, undefined)
      pump()
    },
    /** A different document: stop everything in flight. Held rows stay, because a segment is keyed by
     *  its content and one that survives into the new revision is still right. */
    reset: () => {
      generation++
      enriching = null
      for (const controller of inFlight.keys()) controller.abort()
      inFlight.clear()
      loading.clear()
      wanted = []
      wantedKeys = new Set()
      batch(() => {
        for (const key of Object.keys(statuses)) if (statuses[key] !== 'loaded') setStatuses(key, undefined)
      })
    },
    /** Work owed and rows held, for the health reading. */
    stats: () => {
      let rows = 0
      let bytes = 0
      let unvisited = 0
      for (const entry of resident.values()) {
        rows += entry.rows.length
        bytes += entry.bytes
        if (!entry.visited) unvisited++
      }
      const queued = wanted
        .filter((ref) => !resident.has(ref.contentKey) && !loading.has(ref.contentKey) && statuses[ref.contentKey] !== 'error')
        .map((ref) => ref.contentKey)
      const enrichment = wanted.filter((ref) => {
        const entry = resident.get(ref.contentKey)
        return entry && !entry.enriched && !ref.descriptor.oversize
      }).length
      return { queued, loading: loading.size, enrichment, segments: resident.size, rows, bytes, unvisited }
    },
    dispose: () => {
      disposed = true
      generation++
      for (const controller of inFlight.keys()) controller.abort()
      inFlight.clear()
      loading.clear()
      wanted = []
      resident.clear()
    },
  }
}

export type SegmentLoader = ReturnType<typeof createSegmentLoader>

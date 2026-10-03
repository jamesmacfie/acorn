import { batch, untrack } from 'solid-js'
import { createStore } from 'solid-js/store'
import { MAX_SEGMENTS_PER_REQUEST, segmentContentKey, type DiffSegmentPayload, type DiffSegmentRequest } from '@acorn/diff-document/document'
import { recordSample } from '../../infra/telemetry/emitter'
import { diffRowsFromPlain, type DiffRow } from '../../kit/diff/diffModel'
import type { SegmentRef } from './documentView'
import { residentKey, type SegmentCache } from './segmentCache'

// Loads and colours the segments near the reader, and nothing else (docs/diff-rendering/loading.md § Parsing
// and highlighting).
//
// The viewer says which segments are on screen and which are near, every time its range moves. The
// loader asks the source for the missing ones in small batches, the ones on screen first, and forgets
// any queued segment the reader has since scrolled away from, so a pane left open does no more work
// than its range needs. A loaded segment publishes its plain rows at once; syntax and word colouring
// follow in a second queue with the same demand, and replace the rows under the same index when they
// land.
//
// The rows themselves live in the node's segment cache (./segmentCache.ts), not here, so a segment
// read by an earlier pane is drawn without asking the source again. This loader holds what it is
// showing, near, or loading, so none of it is evicted from under the pane, and lets go on unmount.

/** A segment this pane is waiting on or could not get. A segment with rows has neither. */
export type SegmentStatus = 'loading' | 'error'

/** What a segment's rows are looked up by: its content and the file they are built for. */
export type SegmentAddress = Pick<SegmentRef, 'contentKey'> & { file: { path: string; sha: string | null } }

const keyOf = (ref: SegmentAddress) => residentKey(ref.contentKey, ref.file.path, ref.file.sha)

/** Requests in flight at once. A second lets the next range start while one is still answering. */
const MAX_IN_FLIGHT = 2
/** Segments per request: a viewport's worth, so the visible ones are one round trip. */
const BATCH_SEGMENTS = Math.min(8, MAX_SEGMENTS_PER_REQUEST)

export function createSegmentLoader(options: {
  cache: SegmentCache
  load: (requests: DiffSegmentRequest[], signal: AbortSignal) => Promise<DiffSegmentPayload[]>
  /** Colour one segment's rows. Answers new rows, never rejects, and says `provisional` when the
   *  colour is a fallback worth trying again later. Left out, nothing is coloured: a caller drawing
   *  plain text must not record plain rows as a segment's colour, or the diff viewer would find it
   *  already coloured. */
  enrich?: (rows: readonly DiffRow[]) => Promise<{ rows: DiffRow[]; provisional: boolean }>
  /** Time spent turning payloads into rows and applying colour, for the health reading. */
  prepared?: (ms: number) => void
  /** The first time this pane has plain rows on screen, and whether the cache already had them. */
  firstPlain?: (outcome: 'hit' | 'miss') => void
}) {
  const { cache } = options
  // Read per key by the rows that draw a segment, so a publish redraws that segment and no other.
  // Numbers and strings, set one key at a time: a store merges an object set by path into the old one.
  const [versions, setVersions] = createStore<Record<string, number>>({})
  const [statuses, setStatuses] = createStore<Record<string, SegmentStatus | undefined>>({})
  /** Which segment and plain row each built row came from, so find can mark a match on the row it
   *  names. */
  const places = new WeakMap<object, { path: string; contentKey: string; index: number }>()

  let wanted: SegmentRef[] = []
  let wantedKeys = new Set<string>()
  let visibleKeys = new Set<string>()
  const inFlight = new Map<AbortController, string[]>()
  const loading = new Set<string>()
  let enriching: string | null = null
  let generation = 0
  let disposed = false
  // This pane's own accesses, for its health reading: segments it came near that the cache had, and
  // ones it had to ask for. Counted once each time a segment enters the range, not per draw.
  let hits = 0
  let misses = 0
  let firstPainted = false
  /** Segments this pane loaded ahead of the reader and has not yet shown. */
  const unvisited = new Set<string>()
  /** Segments this pane coloured and got only a fallback for. It does not try them again, so a
   *  grammar that always times out costs one attempt a visit; a later pane tries once more. */
  const fellBack = new Set<string>()
  const owesColour = (ref: SegmentRef) => {
    if (ref.descriptor.oversize) return false
    const key = keyOf(ref)
    const entry = cache.peek(key)
    return !!entry && (!entry.enriched || (entry.provisional && !fellBack.has(key)))
  }

  const bump = (key: string) => setVersions(key, (versions[key] ?? 0) + 1)

  // Another pane's insert or the budget changed a segment's rows or took its colour. Only this pane's
  // draws of that one segment re-read.
  const holder = cache.holder(bump)
  // What this pane holds: everything it wants, and everything it is loading or colouring, so a
  // batch cannot be evicted between arriving and being drawn.
  const pin = () => {
    const keys = new Set(wantedKeys)
    for (const key of loading) keys.add(key)
    if (enriching) keys.add(enriching)
    holder.hold(keys)
  }

  const remember = (key: string, rows: readonly DiffRow[]) => {
    const [contentKey = '', path = ''] = key.split('\u0000')
    rows.forEach((row, index) => places.set(row, { path, contentKey, index }))
  }

  const painted = (outcome: 'hit' | 'miss') => {
    if (firstPainted) return
    firstPainted = true
    options.firstPlain?.(outcome)
  }

  const pump = () => {
    if (disposed) return
    const queue = wanted.filter((ref) => {
      const key = keyOf(ref)
      return !cache.has(key) && !loading.has(key) && statuses[key] !== 'error'
    })
    while (inFlight.size < MAX_IN_FLIGHT && queue.length) {
      const refs = queue.splice(0, BATCH_SEGMENTS)
      const keys = refs.map(keyOf)
      const controller = new AbortController()
      inFlight.set(controller, keys)
      for (const key of keys) loading.add(key)
      pin()
      batch(() => { for (const key of keys) setStatuses(key, 'loading') })
      // By path and content: two files with the same patch, such as one version bump in several
      // manifests, have the same content key and are still two segments to answer.
      const byContent = new Map(refs.map((ref) => [`${ref.file.path}\u0000${ref.contentKey}`, ref]))
      const requests = refs.map((ref): DiffSegmentRequest => ({ path: ref.file.path, patchKey: ref.file.patchKey!, ordinal: ref.ordinal }))
      const at = generation
      void options.load(requests, controller.signal).then(
        (payloads) => {
          if (at !== generation || controller.signal.aborted) return
          const started = performance.now()
          const answered = new Set<string>()
          const inserted: { key: string; path: string; patchKey: string; plain: DiffRow[] }[] = []
          for (const payload of payloads) {
            const ref = byContent.get(`${payload.path}\u0000${segmentContentKey(payload.patchKey, payload.ordinal)}`)
            if (!ref) continue
            const key = keyOf(ref)
            answered.add(key)
            const plain = diffRowsFromPlain(ref.file.path, ref.file.sha, payload.rows)
            remember(key, plain)
            inserted.push({ key, path: ref.file.path, patchKey: payload.patchKey, plain })
            if (!visibleKeys.has(key)) unvisited.add(key)
          }
          cache.insert(inserted)
          batch(() => {
            for (const key of keys) {
              setStatuses(key, answered.has(key) ? undefined : 'error')
              if (answered.has(key)) bump(key)
            }
          })
          if (inserted.some((item) => visibleKeys.has(item.key))) painted('miss')
          options.prepared?.(performance.now() - started)
        },
        () => {
          if (at !== generation || controller.signal.aborted) return
          batch(() => { for (const key of keys) setStatuses(key, 'error') })
        },
      ).finally(() => {
        // Every way a request ends comes through here, so its pins always go.
        if (inFlight.delete(controller)) for (const key of keys) loading.delete(key)
        if (disposed || at !== generation) return
        pin()
        pump()
        enrichNext()
      })
    }
  }

  // One segment at a time, nearest first, and only while it is still wanted.
  const enrichNext = () => {
    const { enrich } = options
    if (disposed || enriching || !enrich) return
    const next = wanted.find(owesColour)
    if (!next) return
    const key = keyOf(next)
    const from = cache.peek(key)!.plain
    enriching = key
    pin()
    const at = generation
    void enrich(from).then(({ rows, provisional }) => {
      if (disposed || at !== generation) return
      enriching = null
      const started = performance.now()
      if (provisional) fellBack.add(key)
      // Kept only if the segment still holds the rows the colouring started from. Otherwise it was
      // evicted or replaced meanwhile, and this colouring belongs to nothing on screen.
      remember(key, rows)
      if (cache.enrich(key, from, rows, provisional)) bump(key)
      options.prepared?.(performance.now() - started)
      pin()
      enrichNext()
    })
  }

  return {
    /** A segment's rows, coloured once they are, or undefined while it is not held. Reactive per
     *  segment. */
    rows: (ref: SegmentAddress): readonly DiffRow[] | undefined => {
      const key = keyOf(ref)
      void versions[key]
      const entry = cache.peek(key)
      if (!entry) return undefined
      const rows = entry.enriched ?? entry.plain
      // Rows another pane built have no place in this one's find index yet.
      if (rows.length && !places.has(rows[0]!)) remember(key, rows)
      return rows
    },
    status: (ref: SegmentAddress): SegmentStatus | undefined => statuses[keyOf(ref)],
    place: (row: object): { path: string; contentKey: string; index: number } | undefined => places.get(row),
    /**
     * What the reader can see and what is near it, nearest first. Queued work for anything else is
     * dropped, and a request whose every segment has left the range is aborted.
     */
    demand: (visible: readonly SegmentRef[], near: readonly SegmentRef[]) => untrack(() => {
      // Untracked: a caller's effect should re-run when its range moves, not whenever a status or
      // version this reads along the way changes.
      if (disposed) return
      visibleKeys = new Set(visible.map(keyOf))
      const seen = new Set<string>()
      const previous = wantedKeys
      wanted = [...visible, ...near].filter((ref) => {
        const key = keyOf(ref)
        return !seen.has(key) && !!seen.add(key)
      })
      wantedKeys = seen
      let hit = 0
      let miss = 0
      for (const ref of wanted) {
        const key = keyOf(ref)
        if (previous.has(key) || loading.has(key)) continue
        if (cache.has(key)) hit++
        else miss++
      }
      hits += hit
      misses += miss
      if (hit) recordSample('core', 'diff.segment_cache.hit', hit)
      if (miss) recordSample('core', 'diff.segment_cache.miss', miss)
      for (const key of visibleKeys) {
        unvisited.delete(key)
        if (cache.has(key)) painted('hit')
      }
      // Touched, so the least recently wanted segment is the first evicted.
      cache.touch(visibleKeys)
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
      pin()
      pump()
      enrichNext()
    }),
    retry: (ref: SegmentAddress) => {
      setStatuses(keyOf(ref), undefined)
      pump()
    },
    /** A different document: stop everything in flight. What is held stays, because a segment is
     *  keyed by its content and one that survives into the new revision is still right; the next
     *  demand replaces the claim. */
    reset: () => {
      generation++
      enriching = null
      for (const controller of inFlight.keys()) controller.abort()
      inFlight.clear()
      loading.clear()
      wanted = []
      unvisited.clear()
      pin()
      batch(() => {
        for (const key of Object.keys(statuses)) if (statuses[key] !== undefined) setStatuses(key, undefined)
      })
    },
    /** A working tree's file moved on from this patch: drop its old segments rather than let every
     *  save leave a copy under the budget. */
    supersede: (path: string, patchKey: string) => holder.supersede(path, patchKey),
    /** Work owed, this pane's accesses, and what the node holds, for the health reading. */
    stats: () => {
      const queued = wanted
        .map(keyOf)
        .filter((key) => !cache.has(key) && !loading.has(key) && statuses[key] !== 'error')
      const enrichment = wanted.filter(owesColour).length
      for (const key of unvisited) if (!cache.has(key)) unvisited.delete(key)
      return { queued, loading: loading.size, enrichment, unvisited: unvisited.size, hits, misses, cache: cache.stats() }
    },
    dispose: () => {
      disposed = true
      generation++
      for (const controller of inFlight.keys()) controller.abort()
      inFlight.clear()
      loading.clear()
      wanted = []
      wantedKeys = new Set()
      enriching = null
      holder.release()
    },
  }
}

export type SegmentLoader = ReturnType<typeof createSegmentLoader>

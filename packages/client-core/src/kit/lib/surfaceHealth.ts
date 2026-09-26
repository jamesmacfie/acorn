// What a large rendered surface says about its own health: numbers a diff or a timeline keeps about
// itself, read on demand by whoever asks (docs/telemetry.md § Rendered-surface health).
//
// A surface registers when it mounts and hands over a reader. The reader is only called when someone
// asks for a snapshot, so a surface pays for its counts at read time rather than on every scroll or
// streamed event. Disposing the registration takes one final reading, after the surface's own
// cleanups have run, and keeps it as the kind's `retired` entry. That reading is how a teardown check
// proves observers and scheduled frames went back to zero without waiting on garbage collection.
//
// Numbers and one boolean, nothing else. The template below is the whole schema: `sanitize` copies
// only the fields it names and only when they are finite numbers (or the boolean), so a reader that
// returned a path, a line of code or a session id would lose it here rather than leak it. Diffs and
// transcripts hold proprietary source and conversation, which is why this is structural rather than
// a convention.
//
// In `kit/` rather than in the telemetry folder, because the Timeline registers here and `kit/` may
// not import the emitter (./contributionErrors.ts says why). The emitter installs a handler the same
// way it does for scroll places, and the desktop publishes snapshots on the performance timeline
// (infra/telemetry/surfaceHealth.ts). A sandboxed kit gets its own copy of this module with nothing
// installed, so it stays inert there.

export type SurfaceKind = 'diff' | 'timeline'

/** Every field a surface can report. Grouped by the question each answers; a field a surface has no
 *  concept of yet stays zero, which is what later phases report into. */
export type SurfaceHealth = {
  /** The document as a whole. `ready` is the source-owned structure being complete. */
  topology: { files: number; segments: number; fixedRows: number; dynamicBlocks: number; ready: boolean; lateSourceBlocks: number }
  /** What is in the DOM now. Blank and uncovered are measured against the visible viewport only. */
  mounted: { segments: number; fixedRows: number; dynamicBlocks: number; blankBlocks: number; uncoveredRanges: number }
  /** Work still owed. Distance is in the surface's own unit (segments for the diff), never a path.
   *  `unvisitedSegments` is content prepared for a part of the surface the reader has not reached. */
  work: { queuedSegments: number; queuedEnrichment: number; furthestQueueDistance: number; unvisitedSegments: number; scheduledFrames: number; heldPublications: number; prepareMs: number }
  /** Size reads and the geometry writes they caused, cumulative since mount, plus live observers.
   *  `fixedRebuilds` counts rebuilds of the exact fixed geometry, which a dynamic resize must never cause. */
  measurement: { candidates: number; reads: number; commits: number; maxCommitsInFrame: number; readMs: number; commitMs: number; fixedRebuilds: number; activeObservers: number; observedElements: number }
  /** Scroll writes the surface made to keep a reading place, cumulative since mount. `substituted`
   *  counts places whose anchor had gone and a neighbour stood in. */
  correction: { count: number; failed: number; substituted: number; maxPixels: number; maxAnchorDrift: number }
  /** Parsed content held in memory for this surface, and for the diff every other diff on the node:
   *  the weight now against its two ceilings, and the cache's inserts, evictions and oversize
   *  inserts since it was made. `hits` and `misses` are this surface's own, since mount. Bytes are
   *  the cache's estimate, not the heap's. */
  resident: {
    documents: number; segments: number; rows: number; estimatedBytes: number; plainBytes: number; enrichmentBytes: number
    hits: number; misses: number; inserts: number; evictions: number; oversize: number; rowCeiling: number; byteCeiling: number
  }
}

export type SurfaceHealthEntry = { kind: SurfaceKind } & SurfaceHealth

/** What a reader returns: any subset of the fields. Anything it leaves out reads as zero. */
export type SurfaceHealthReading = { [Group in keyof SurfaceHealth]?: Partial<SurfaceHealth[Group]> }

export type SurfaceHealthSnapshot = {
  surfaces: SurfaceHealthEntry[]
  /** The final reading of the most recently disposed surface of each kind. */
  retired: Partial<Record<SurfaceKind, SurfaceHealthEntry>>
}

export type SurfaceCheckpoint = 'ready' | 'teardown'

export type SurfaceHealthProbe = {
  /** Say that a milestone was reached, so the installed handler can record it. */
  checkpoint: (reason: Exclude<SurfaceCheckpoint, 'teardown'>) => void
  dispose: () => void
}

const TEMPLATE: SurfaceHealth = {
  topology: { files: 0, segments: 0, fixedRows: 0, dynamicBlocks: 0, ready: false, lateSourceBlocks: 0 },
  mounted: { segments: 0, fixedRows: 0, dynamicBlocks: 0, blankBlocks: 0, uncoveredRanges: 0 },
  work: { queuedSegments: 0, queuedEnrichment: 0, furthestQueueDistance: 0, unvisitedSegments: 0, scheduledFrames: 0, heldPublications: 0, prepareMs: 0 },
  measurement: { candidates: 0, reads: 0, commits: 0, maxCommitsInFrame: 0, readMs: 0, commitMs: 0, fixedRebuilds: 0, activeObservers: 0, observedElements: 0 },
  correction: { count: 0, failed: 0, substituted: 0, maxPixels: 0, maxAnchorDrift: 0 },
  resident: {
    documents: 0, segments: 0, rows: 0, estimatedBytes: 0, plainBytes: 0, enrichmentBytes: 0,
    hits: 0, misses: 0, inserts: 0, evictions: 0, oversize: 0, rowCeiling: 0, byteCeiling: 0,
  },
}

const KINDS: readonly SurfaceKind[] = ['diff', 'timeline']

/** Copy the template's fields out of a reading and nothing else. Exported for the privacy test. */
export function sanitizeSurfaceHealth(kind: SurfaceKind, reading: SurfaceHealthReading | undefined): SurfaceHealthEntry {
  const entry = { kind: KINDS.includes(kind) ? kind : 'diff' } as SurfaceHealthEntry
  for (const group of Object.keys(TEMPLATE) as (keyof SurfaceHealth)[]) {
    const source = (reading?.[group] ?? {}) as Record<string, unknown>
    const out: Record<string, number | boolean> = {}
    for (const [field, empty] of Object.entries(TEMPLATE[group])) {
      const value = source[field]
      if (typeof empty === 'boolean') out[field] = value === true
      else out[field] = typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
    }
    ;(entry as Record<string, unknown>)[group] = out
  }
  return entry
}

type Registration = { kind: SurfaceKind; read: () => SurfaceHealthReading }

const live = new Set<Registration>()
const retired: Partial<Record<SurfaceKind, SurfaceHealthEntry>> = {}
let handler: ((entry: SurfaceHealthEntry, checkpoint: SurfaceCheckpoint) => void) | null = null

/** A reader that throws reads as empty. Instrumentation must never fail the surface it describes. */
const readSafely = (registration: Registration): SurfaceHealthEntry => {
  try {
    return sanitizeSurfaceHealth(registration.kind, registration.read())
  } catch {
    return sanitizeSurfaceHealth(registration.kind, undefined)
  }
}

const notify = (entry: SurfaceHealthEntry, checkpoint: SurfaceCheckpoint): void => {
  try {
    handler?.(entry, checkpoint)
  } catch {
    // Deliberately silent, for the reason `readSafely` gives.
  }
}

/**
 * Register a surface. Call it before the surface's other cleanups are registered, so that disposal,
 * which Solid runs in reverse order, happens after them and the final reading sees them done.
 */
export function registerSurfaceHealth(kind: SurfaceKind, read: () => SurfaceHealthReading): SurfaceHealthProbe {
  const registration: Registration = { kind, read }
  live.add(registration)
  return {
    checkpoint: (reason) => {
      if (live.has(registration)) notify(readSafely(registration), reason)
    },
    dispose: () => {
      if (!live.has(registration)) return
      const final = readSafely(registration)
      live.delete(registration)
      retired[kind] = final
      notify(final, 'teardown')
    },
  }
}

/** Every mounted surface's current counts, plus the last reading of each kind that went away. */
export function surfaceHealthSnapshot(): SurfaceHealthSnapshot {
  return { surfaces: [...live].map(readSafely), retired: { ...retired } }
}

/** Called by the client's telemetry start-up. One handler; a second replaces the first. */
export const setSurfaceHealthHandler = (next: ((entry: SurfaceHealthEntry, checkpoint: SurfaceCheckpoint) => void) | null): void => {
  handler = next
}

/** Test seam: forget every registration and retired reading. */
export function _resetSurfaceHealth(): void {
  live.clear()
  for (const kind of KINDS) delete retired[kind]
  handler = null
}

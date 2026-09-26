import type { DiffDocumentTopology } from '@acorn/diff-document/document'
import { registerSurfaceHealth, type SurfaceHealthReading } from '../../kit/lib/surfaceHealth'
import { isCodeRow, type CodeRow, type DiffThread, type Row } from '../../kit/diff/diffModel'
import type { DiffLayout } from './diffLayout'
import type { DiffItem } from './documentView'
import type { SegmentLoader } from './segmentLoader'

// The diff's health reading (docs/telemetry.md § Rendered-surface health). Everything here is read
// when a snapshot is asked for, from state the pane already holds, so an open diff pays nothing for
// it between requests.
//
// The document's size comes from its topology, the mounted counts from the items in the layout's
// range, the work owed from the segment loader, whose queue is only ever what the reader can see and
// what is near it, and the measurement and correction counts from the layout (./diffLayout.ts). The
// queue distance is in segments from the items on screen.

export type DiffHealthInputs = {
  topology: () => DiffDocumentTopology | undefined
  items: () => readonly DiffItem[]
  /** Source threads that land in a segment of this document. */
  placedThreads: () => number
  threads: () => readonly DiffThread[] | undefined
  layout: Pick<DiffLayout, 'range' | 'health'>
  scrollEl: () => HTMLElement | undefined
  loader: SegmentLoader
  /** A mounted item's rows with its threads placed, or undefined while it is not loaded. */
  itemRows: (item: Extract<DiffItem, { kind: 'segment' | 'overlay' }>) => readonly Row[] | undefined
  hasLineExtra: (row: CodeRow) => boolean
}

/**
 * How much of the visible viewport the mounted items actually cover. Rects rather than virtual
 * offsets, because the failure worth catching is the DOM and the virtualizer disagreeing: an item
 * whose real height differs from its offset leaves a gap or an overlap the numbers alone would not show.
 */
function coverage(scroller: HTMLElement, selector: string): { blank: number; uncovered: number } {
  const view = scroller.getBoundingClientRect()
  if (view.height <= 0) return { blank: 0, uncovered: 0 }
  const canvas = scroller.firstElementChild
  const bottom = Math.min(view.bottom, canvas ? canvas.getBoundingClientRect().bottom : view.bottom)
  const spans: [number, number][] = []
  let blank = 0
  for (const element of scroller.querySelectorAll<HTMLElement>(selector)) {
    const rect = element.getBoundingClientRect()
    if (rect.bottom <= view.top || rect.top >= bottom) continue
    if (rect.height > 0) spans.push([Math.max(rect.top, view.top), Math.min(rect.bottom, bottom)])
    // Visible, and neither a placeholder nor content: a pending segment says "Loading", a row has cells.
    if (rect.height <= 0 || (!element.firstElementChild && !(element.textContent ?? '').trim())) blank++
  }
  spans.sort((a, b) => a[0] - b[0])
  let cursor = view.top
  let uncovered = 0
  for (const [top, end] of spans) {
    if (top - cursor > 1) uncovered++
    cursor = Math.max(cursor, end)
  }
  if (bottom - cursor > 1) uncovered++
  return { blank, uncovered }
}

/**
 * Register the pane as a `diff` surface. Call it first in the pane, before anything that registers a
 * cleanup, and `attach` its inputs once they exist: disposal then runs after the layout, its measure
 * scheduler and the loader have stopped, and the final reading shows that they did.
 */
export function createDiffHealth() {
  let inputs: DiffHealthInputs | null = null
  let ready = false
  let readyThreads: Set<string> | null = null
  let lateSourceBlocks = 0
  let prepareMs = 0

  const read = (): SurfaceHealthReading => {
    if (!inputs) return {}
    const { loader } = inputs
    const geometry = inputs.layout.health()
    const topology = inputs.topology()
    const items = inputs.items()
    const noDiff = topology?.files.filter((file) => !file.patchKey || !file.segments.length).length ?? 0

    const scroller = inputs.scrollEl()
    const viewTop = scroller?.scrollTop ?? 0
    const viewBottom = viewTop + (scroller?.clientHeight ?? 0)
    let mountedSegments = 0
    let mountedFixed = 0
    let mountedDynamic = 0
    let firstVisible = Infinity
    let lastVisible = -Infinity
    const segmentAt = new Map<string, number>()
    let ordinal = 0
    const positions = items.map((item) => (item.kind === 'segment' ? ordinal++ : ordinal))
    items.forEach((item, index) => {
      if (item.kind === 'segment') segmentAt.set(item.segment.contentKey, positions[index]!)
    })
    for (const vi of inputs.layout.range()) {
      const item = items[vi.index]
      if (!item) continue
      if (vi.end > viewTop && vi.start < viewBottom) {
        firstVisible = Math.min(firstVisible, positions[vi.index]!)
        lastVisible = Math.max(lastVisible, positions[vi.index]!)
      }
      if (item.kind === 'file' || item.kind === 'nodiff') {
        mountedFixed++
        continue
      }
      if (item.kind === 'segment') mountedSegments++
      for (const row of inputs.itemRows(item) ?? []) {
        if (row.kind !== 'thread') mountedFixed++
        if (row.kind === 'thread' || (isCodeRow(row) && inputs.hasLineExtra(row))) mountedDynamic++
      }
    }
    const shown = scroller ? coverage(scroller, '.diff-item[data-index]') : { blank: 0, uncovered: 0 }

    const stats = loader.stats()
    if (firstVisible === Infinity) firstVisible = lastVisible = 0
    let furthest = 0
    for (const key of stats.queued) {
      const at = segmentAt.get(key)
      if (at == null) continue
      furthest = Math.max(furthest, at < firstVisible ? firstVisible - at : at > lastVisible ? at - lastVisible : 0)
    }

    return {
      topology: {
        files: topology?.files.length ?? 0,
        segments: topology?.totals.segments ?? 0,
        // A header per file, a no-diff row for each file without one, and every segment's rows.
        fixedRows: topology ? topology.totals.rows + topology.files.length + noDiff : 0,
        dynamicBlocks: inputs.placedThreads(),
        ready,
        lateSourceBlocks,
      },
      mounted: { segments: mountedSegments, fixedRows: mountedFixed, dynamicBlocks: mountedDynamic, blankBlocks: shown.blank, uncoveredRanges: shown.uncovered },
      work: {
        queuedSegments: stats.queued.length + stats.loading,
        queuedEnrichment: stats.enrichment,
        furthestQueueDistance: furthest,
        unvisitedSegments: stats.unvisited,
        scheduledFrames: geometry.pendingFrames,
        heldPublications: 0,
        prepareMs,
      },
      measurement: geometry.measurement,
      correction: geometry.correction,
      // UTF-16 code units of the row text held, plus a flat allowance per row: a lower bound, since
      // the tokens built from it weigh several times that.
      resident: { documents: topology ? 1 : 0, segments: stats.segments, rows: stats.rows, estimatedBytes: stats.bytes },
    }
  }

  const probe = registerSurfaceHealth('diff', read)

  return {
    attach: (next: DiffHealthInputs) => { inputs = next },
    /** Time spent building a segment's rows or applying its colour. */
    prepared: (ms: number) => { prepareMs += ms },
    /** The topology and the source's threads have both arrived. The first time per file set, the
     *  document's structure is complete. */
    ready: () => {
      if (ready || !inputs) return
      ready = true
      readyThreads = new Set((inputs.threads() ?? []).map((thread) => thread.threadId))
      probe.checkpoint('ready')
    },
    /** Threads the source added after the document was ready. A composer the reader opens is not a
     *  thread, so it never counts; a comment the reader posts comes back from the source as a thread
     *  and does, because nothing on this side can tell it from one the source had all along. */
    threads: (threads: readonly DiffThread[] | undefined) => {
      if (!readyThreads) return
      for (const thread of threads ?? []) {
        if (readyThreads.has(thread.threadId)) continue
        readyThreads.add(thread.threadId)
        lateSourceBlocks++
      }
    },
    /** A different file set: a different document, which becomes ready on its own. */
    reset: () => {
      ready = false
      readyThreads = null
      lateSourceBlocks = 0
      prepareMs = 0
    },
    dispose: probe.dispose,
  }
}

import { registerSurfaceHealth, type SurfaceHealthReading } from '../../kit/lib/surfaceHealth'
import { isCodeRow, type CodeRow, type DiffFile, type DiffThread, type ParsedFile, type Row, type SplitBand, type ViewMode } from '../../kit/diff/diffModel'
import type { DiffMeasureCounters } from '../../kit/diff/virtualization'

// The diff's health reading (docs/telemetry.md § Rendered-surface health). Everything here is read
// when a snapshot is asked for, from state the pane already holds, so an open diff pays nothing for
// it between requests.
//
// Two of the numbers are the current renderer's known costs rather than the goal the later phases
// set: `topology` only knows a file's rows once the hydrator has parsed it, and the queue distance
// shows the hydrator working through files the reader is nowhere near.

type HealthVirtualizer = {
  getVirtualItems: () => readonly { index: number }[]
  elementsCache: ReadonlyMap<unknown, Element>
}

export type DiffHealthInputs = {
  files: () => readonly DiffFile[]
  rows: () => readonly Row[]
  bands: () => readonly SplitBand[]
  parsed: () => readonly ParsedFile[]
  threads: () => readonly DiffThread[] | undefined
  viewMode: () => ViewMode
  virt: HealthVirtualizer
  splitVirt: HealthVirtualizer
  scrollEl: () => HTMLElement | undefined
  counters: DiffMeasureCounters
  scheduledFrames: () => number
  hydration: () => { queued: readonly string[]; loading: number }
  heldPublications: () => number
  visiblePaths: () => ReadonlySet<string>
  hasLineExtra: (row: CodeRow) => boolean
}

const isFixed = (row: Row) => row.kind !== 'thread' && row.kind !== 'load'
const isPlaceholder = (parsed: ParsedFile) => parsed.diff.length === 1 && parsed.diff[0]?.kind === 'load'

/**
 * How much of the visible viewport the mounted rows actually cover. Rects rather than virtual
 * offsets, because the failure worth catching is the DOM and the virtualizer disagreeing: a row whose
 * real height differs from its offset leaves a gap or an overlap the numbers alone would not show.
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
    // Visible, and neither a skeleton nor content: a load row says "Loading", a code row has cells.
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

/** How far, in files, the furthest queued file is from the files the reader can see. */
function queueDistance(files: readonly DiffFile[], queued: readonly string[], visible: ReadonlySet<string>): number {
  if (!queued.length) return 0
  const index = new Map(files.map((file, position) => [file.path, position]))
  let low = Infinity
  let high = -Infinity
  for (const path of visible) {
    const at = index.get(path)
    if (at == null) continue
    low = Math.min(low, at)
    high = Math.max(high, at)
  }
  if (low === Infinity) low = high = 0
  let furthest = 0
  for (const path of queued) {
    const at = index.get(path)
    if (at == null) continue
    furthest = Math.max(furthest, at < low ? low - at : at > high ? at - high : 0)
  }
  return furthest
}

const connected = (virtualizer: HealthVirtualizer) => {
  let count = 0
  for (const element of virtualizer.elementsCache.values()) if (element.isConnected) count++
  return count
}

/**
 * Register the pane as a `diff` surface. Call it first in the pane, before anything that registers a
 * cleanup, and `attach` its inputs once they exist: disposal then runs after the virtualizers, the
 * hydrator and the measure schedulers have stopped, and the final reading shows that they did.
 */
export function createDiffHealth() {
  let inputs: DiffHealthInputs | null = null
  let ready = false
  let readyThreads: Set<string> | null = null
  let lateSourceBlocks = 0
  let prepareMs = 0

  const read = (): SurfaceHealthReading => {
    if (!inputs) return {}
    const { files, rows, bands, counters } = inputs
    const all = rows()
    let fixedRows = 0
    let dynamicBlocks = 0
    for (const row of all) {
      if (isFixed(row)) fixedRows++
      else if (row.kind === 'thread') dynamicBlocks++
    }

    const split = inputs.viewMode() === 'split'
    let mountedFixed = 0
    let mountedDynamic = 0
    if (split) {
      const list = bands()
      for (const item of inputs.splitVirt.getVirtualItems()) {
        const band = list[item.index]
        if (!band) continue
        const dynamic = band.kind === 'full'
          ? band.row.kind === 'thread'
          : (!!band.left && inputs.hasLineExtra(band.left)) || (!!band.right && inputs.hasLineExtra(band.right))
        if (dynamic) mountedDynamic++
        else mountedFixed++
      }
    } else {
      for (const item of inputs.virt.getVirtualItems()) {
        const row = all[item.index]
        if (!row) continue
        if (row.kind === 'thread' || (isCodeRow(row) && inputs.hasLineExtra(row))) mountedDynamic++
        else mountedFixed++
      }
    }
    const scroller = inputs.scrollEl()
    const shown = scroller
      ? coverage(scroller, split ? '.diff-split-band[data-index]' : '.diff-row[data-index]')
      : { blank: 0, uncovered: 0 }

    const hydration = inputs.hydration()
    let residentRows = 0
    let residentChars = 0
    let documents = 0
    for (const parsed of inputs.parsed()) {
      if (isPlaceholder(parsed)) continue
      documents = 1
      residentRows += parsed.diff.length
      residentChars += parsed.file.patch?.length ?? 0
    }

    return {
      topology: { files: files().length, fixedRows, dynamicBlocks, ready, lateSourceBlocks },
      mounted: { fixedRows: mountedFixed, dynamicBlocks: mountedDynamic, blankBlocks: shown.blank, uncoveredRanges: shown.uncovered },
      work: {
        queuedSegments: hydration.queued.length + hydration.loading,
        furthestQueueDistance: queueDistance(files(), hydration.queued, inputs.visiblePaths()),
        scheduledFrames: inputs.scheduledFrames() + counters.pendingFrames(),
        heldPublications: inputs.heldPublications(),
        prepareMs,
      },
      measurement: {
        candidates: counters.counts.candidates,
        reads: counters.counts.reads,
        commits: counters.counts.commits,
        maxCommitsInFrame: counters.counts.maxCommitsInFrame,
        readMs: counters.counts.readMs,
        activeObservers: counters.counts.activeObservers,
        observedElements: connected(inputs.virt) + connected(inputs.splitVirt),
      },
      correction: { count: counters.counts.corrections, maxPixels: counters.counts.maxCorrectionPixels },
      // UTF-16 code units of the patch text held, a lower bound: the row objects and tokens built
      // from it weigh several times that.
      resident: { documents, rows: residentRows, estimatedBytes: residentChars * 2 },
    }
  }

  const probe = registerSurfaceHealth('diff', read)

  return {
    attach: (next: DiffHealthInputs) => { inputs = next },
    /** Time spent parsing a file or rebuilding the row model, both proportional to the whole diff. */
    prepared: (ms: number) => { prepareMs += ms },
    /** The hydrator has nothing left to do. The first time per file set, the topology is complete. */
    settled: () => {
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

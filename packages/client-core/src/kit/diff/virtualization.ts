import { createVirtualizer, measureElement, observeElementRect, type Virtualizer } from '@tanstack/solid-virtual'

/** Mounted beyond each edge of the viewport: about two screens of runway altogether in a normal
 *  pane, so a momentum scroll does not outrun what is mounted. */
const DIFF_RUNWAY_PX = 800

// Virtualizer plumbing shared by the diff's unified and split lists. The two setups differ only in
// how tall each item is estimated to be, and both feed the same batched-rAF measure scheduling.

/**
 * What the two virtualizers and their schedulers did, for the diff's health reading
 * (docs/telemetry.md § Rendered-surface health).
 *
 * Counted through the virtualizer's own public options rather than by patching it: `measureElement`
 * is every size read, and a read that returns a size other than the one held is a geometry commit,
 * which is the moment TanStack rebuilds the offsets below that row. A commit to a row above the
 * viewport is also a scroll correction, because TanStack moves `scrollTop` by the difference.
 * `observeElementRect` is called when a virtualizer attaches to its scroller and its return value
 * when it detaches, and TanStack creates and disconnects its size observers at the same two moments,
 * so that pair is the observer lifecycle.
 */
export type DiffMeasureCounters = ReturnType<typeof createDiffMeasureCounters>

export function createDiffMeasureCounters() {
  const counts = {
    candidates: 0,
    reads: 0,
    commits: 0,
    maxCommitsInFrame: 0,
    readMs: 0,
    activeObservers: 0,
    corrections: 0,
    maxCorrectionPixels: 0,
  }
  let frameCommits = 0
  let frame = 0

  const commit = () => {
    counts.commits += 1
    frameCommits += 1
    counts.maxCommitsInFrame = Math.max(counts.maxCommitsInFrame, frameCommits)
    // One frame's worth of commits, closed by the next frame. No frame is requested while nothing
    // commits, so an idle diff schedules nothing here.
    if (!frame && typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(() => {
        frame = 0
        frameCommits = 0
      })
    }
  }

  const measure = (node: Element, entry: ResizeObserverEntry | undefined, instance: Virtualizer<HTMLDivElement, Element>) => {
    const started = performance.now()
    const index = instance.indexFromElement(node)
    const held = instance.itemSizeCache.get(instance.options.getItemKey(index))
    const size = measureElement(node, entry, instance)
    counts.readMs += performance.now() - started
    // Without an entry TanStack answers from its cache when it can, which is not a read of the DOM.
    if (entry || held === undefined) counts.reads += 1
    const previous = held ?? instance.options.estimateSize(index)
    if (size !== previous) {
      commit()
      const start = instance.measurementsCache[index]?.start
      const offset = instance.scrollOffset ?? 0
      // TanStack's own rule for when a resize moves the scroll position, simplified to its two cases.
      if (start != null && (held === undefined ? start < offset : start + previous <= offset)) {
        counts.corrections += 1
        counts.maxCorrectionPixels = Math.max(counts.maxCorrectionPixels, Math.abs(size - previous))
      }
    }
    return size
  }

  const observe = (instance: Virtualizer<HTMLDivElement, Element>, cb: Parameters<typeof observeElementRect>[1]) => {
    const stop = observeElementRect(instance, cb)
    if (!stop) return stop
    counts.activeObservers += 1
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      counts.activeObservers -= 1
      stop()
    }
  }

  return {
    counts,
    /** A row was handed to the scheduler to be measured. */
    candidate: () => { counts.candidates += 1 },
    measure,
    observe,
    /** 1 while this frame's commit window is open. */
    pendingFrames: () => (frame ? 1 : 0),
    dispose: () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}

export function createDiffVirtualizer<T>(opts: {
  items: () => readonly T[]
  keys: () => readonly string[]
  /** Fallback getItemKey prefix for an index with no identity key. */
  keyPrefix: string
  estimateSize: (item: T | undefined) => number
  scrollEl: () => HTMLDivElement | undefined
  counters?: DiffMeasureCounters
  /** Read whenever offsets have to be recomputed without any key changing, such as an inline thread
   *  arriving for a segment that has not been measured yet. */
  estimates?: () => unknown
}) {
  // Assigned below; the range extractor runs only once the virtualizer exists.
  let instance: Virtualizer<HTMLDivElement, Element> | undefined
  const virtualizer = createVirtualizer<HTMLDivElement, Element>({
    get count() {
      return opts.items().length
    },
    getScrollElement: () => opts.scrollEl() ?? null,
    // A getter, so a new key list or a moved estimate hands TanStack a new function. A new
    // `getItemKey` is what makes it recompute every offset, and it does so keeping each measured size,
    // where `measure()` would throw them all away.
    get getItemKey() {
      const keys = opts.keys()
      opts.estimates?.()
      return (index: number) => keys[index] ?? `${opts.keyPrefix}:${index}`
    },
    estimateSize: (index) => opts.estimateSize(opts.items()[index]),
    overscan: 0,
    // Runway in pixels rather than in items. An item is a segment of up to 64 rows or a 36px file
    // header, so a count of items would be a screen of runway in one place and none in another.
    rangeExtractor: (range) => {
      const measured = instance?.measurementsCache ?? []
      let first = range.startIndex
      let before = 0
      while (first > 0 && before < DIFF_RUNWAY_PX) before += measured[--first]?.size ?? 0
      let last = range.endIndex
      let after = 0
      while (last < range.count - 1 && after < DIFF_RUNWAY_PX) after += measured[++last]?.size ?? 0
      const out: number[] = []
      for (let index = first; index <= last; index++) out.push(index)
      return out
    },
    ...(opts.counters ? { measureElement: opts.counters.measure, observeElementRect: opts.counters.observe } : {}),
  })
  instance = virtualizer
  return virtualizer
}

export type MeasureTarget = 'unified' | 'split'

type MeasurableVirtualizer = {
  measure: () => void
  measureElement: (el: HTMLElement) => void
}

// Batched measure scheduling: `scheduleVirtualMeasure` coalesces whole-list measure() calls and
// `scheduleElementMeasure` coalesces per-row measureElement() calls, each into one rAF pass, so a
// burst of newly-mounted rows triggers one measure per frame instead of one per row.
export function createDiffMeasureSchedulers(
  virtualizers: Record<MeasureTarget, MeasurableVirtualizer>,
  scrollEl: () => Element | undefined,
  counters?: DiffMeasureCounters,
) {
  let virtualMeasureFrame = 0
  let needsUnifiedMeasure = false
  let needsSplitMeasure = false
  const scheduleVirtualMeasure = (target: MeasureTarget) => {
    if (target === 'unified') needsUnifiedMeasure = true
    else needsSplitMeasure = true
    if (virtualMeasureFrame) return
    virtualMeasureFrame = requestAnimationFrame(() => {
      virtualMeasureFrame = 0
      if (!scrollEl()) return
      if (needsUnifiedMeasure) virtualizers.unified.measure()
      if (needsSplitMeasure) virtualizers.split.measure()
      needsUnifiedMeasure = false
      needsSplitMeasure = false
    })
  }

  const pendingUnifiedMeasures = new Set<HTMLElement>()
  const pendingSplitMeasures = new Set<HTMLElement>()
  let elementMeasureFrame = 0
  const scheduleElementMeasure = (target: MeasureTarget, el: HTMLElement) => {
    counters?.candidate()
    if (target === 'unified') pendingUnifiedMeasures.add(el)
    else pendingSplitMeasures.add(el)
    if (elementMeasureFrame) return
    elementMeasureFrame = requestAnimationFrame(() => {
      elementMeasureFrame = 0
      for (const item of pendingUnifiedMeasures) {
        if (item.isConnected) virtualizers.unified.measureElement(item)
      }
      for (const item of pendingSplitMeasures) {
        if (item.isConnected) virtualizers.split.measureElement(item)
      }
      pendingUnifiedMeasures.clear()
      pendingSplitMeasures.clear()
    })
  }

  const cancel = () => {
    cancelAnimationFrame(virtualMeasureFrame)
    cancelAnimationFrame(elementMeasureFrame)
    virtualMeasureFrame = 0
    elementMeasureFrame = 0
  }

  /** How many of the two frames are still requested. */
  const pendingFrames = () => (virtualMeasureFrame ? 1 : 0) + (elementMeasureFrame ? 1 : 0)

  return { scheduleVirtualMeasure, scheduleElementMeasure, cancel, pendingFrames }
}

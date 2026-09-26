// When the diff reads the heights of its dynamic blocks, and when it commits them
// (docs/diff-rendering.md § Row geometry).
//
// One `ResizeObserver` per diff surface watches every mounted dynamic block and the scroller. Its
// callback only marks blocks dirty: it reads nothing and writes nothing, because an observer that
// wrote heights around the elements it watches is a feedback loop, and a burst of resizes would commit
// once per block. A pass then reads every dirty, connected block in one batch, with no write between
// the reads, compares the readings with the heights the geometry holds, and hands the changes over as
// one commit. At most one commit lands in a frame; a pass that would be the second waits for the next
// frame.
//
// The pass runs inside the observer's callback when it can, which is after layout and before paint,
// so a block that grew on screen and the content it pushed down land in the same frame. That is the
// before-paint lane. Everything else waits for an animation frame.
//
// While the reader is scrolling, a block that sits wholly above the reading place stays dirty. Its
// commit would have to move `scrollTop` to keep the reader where they are, and a write in the middle of
// momentum fights the scroll. Everything at or below the reading place commits as usual, because it
// moves nothing the reader is looking at. That includes a block the reader has just opened or edited:
// it is on screen, so it is never wholly above the reading place. Once the scroll settles, the pass
// that was held back runs.
//
// Only mounted blocks are measured. A block the virtual range has not reached keeps its estimate or
// the height last measured for it, and makes no DOM.

/** Readings closer than this to the held height are the same height: WebKit reports fractions. */
const HEIGHT_EPSILON = 0.5

type Observed = { id: string; base: number }

export type DiffMeasureSchedulerOptions = {
  /** The height the geometry holds for a block now, or undefined if it holds none. */
  held: (id: string) => number | undefined
  /** The block sits wholly above the reading place, so committing it now would move the reader. */
  above: (id: string) => boolean
  /** Milliseconds until the reader's scrolling settles; 0 when they are not scrolling. */
  readerWait: () => number
  /** One geometry commit: every changed block's new height. */
  commit: (changes: ReadonlyMap<string, number>) => void
  /** The scroller's box, when it is observed. */
  viewport?: (width: number, height: number) => void
  /** How tall an element is. The real engine's answer by default; tests model their own. */
  read?: (element: Element) => number
}

export function createDiffMeasureScheduler(options: DiffMeasureSchedulerOptions) {
  const read = options.read ?? ((element: Element) => element.getBoundingClientRect().height)
  const observed = new Map<Element, Observed>()
  const elements = new Map<string, Element>()
  const dirty = new Set<string>()
  let viewportElement: Element | null = null

  const counts = {
    candidates: 0,
    reads: 0,
    commits: 0,
    maxCommitsInFrame: 0,
    readMs: 0,
    commitMs: 0,
    activeObservers: 0,
  }
  let frame = 0
  let settle: ReturnType<typeof setTimeout> | 0 = 0
  // Closes the frame a commit landed in, so the next commit waits for a new one.
  let frameClose = 0
  let frameCommits = 0
  let disposed = false

  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === viewportElement) {
            options.viewport?.(entry.contentRect.width, entry.contentRect.height)
            continue
          }
          const block = observed.get(entry.target)
          if (block) dirty.add(block.id)
        }
        run()
      })
    : null
  if (observer) counts.activeObservers = 1

  const schedule = () => {
    if (frame || disposed) return
    frame = requestAnimationFrame(() => {
      frame = 0
      pass()
    })
  }

  /** Run a pass now if this frame has not committed yet, otherwise in the next one. */
  const run = () => {
    if (disposed || !dirty.size) return
    if (frameCommits) schedule()
    else pass()
  }

  const pass = () => {
    if (disposed) return
    if (settle) {
      clearTimeout(settle)
      settle = 0
    }
    const wait = options.readerWait()
    const candidates: [string, Element, number][] = []
    for (const id of dirty) {
      const element = elements.get(id)
      if (!element?.isConnected) {
        dirty.delete(id)
        continue
      }
      candidates.push([id, element, observed.get(element)!.base])
    }
    if (!candidates.length) return
    counts.candidates += candidates.length

    // Every read before any decision, and no write between them.
    const started = performance.now()
    const readings = candidates.map(([id, element, base]) => [id, Math.max(0, read(element) - base)] as const)
    counts.reads += readings.length
    counts.readMs += performance.now() - started

    const changes = new Map<string, number>()
    for (const [id, height] of readings) {
      const held = options.held(id)
      if (held !== undefined && Math.abs(height - held) < HEIGHT_EPSILON) {
        dirty.delete(id)
        continue
      }
      // Held back until the scroll settles: committing it would move the reader mid-gesture.
      if (wait > 0 && options.above(id)) continue
      changes.set(id, height)
      dirty.delete(id)
    }

    if (changes.size) {
      const began = performance.now()
      options.commit(changes)
      counts.commitMs += performance.now() - began
      counts.commits += 1
      frameCommits += 1
      counts.maxCommitsInFrame = Math.max(counts.maxCommitsInFrame, frameCommits)
      if (!frameClose) {
        frameClose = requestAnimationFrame(() => {
          frameClose = 0
          frameCommits = 0
        })
      }
    }

    if (!dirty.size) return
    if (wait > 0) settle = setTimeout(() => { settle = 0; schedule() }, wait)
    else schedule()
  }

  return {
    counts,
    /** Watch a mounted block. `base` is the part of the element that is fixed geometry, such as the
     *  code line above a note. */
    observe: (element: Element, id: string, base = 0) => {
      const previous = elements.get(id)
      if (previous && previous !== element) {
        observed.delete(previous)
        observer?.unobserve(previous)
      }
      observed.set(element, { id, base })
      elements.set(id, element)
      if (observer) {
        // The observer reports every element once when it starts watching it, which is the first read.
        observer.observe(element)
        return
      }
      dirty.add(id)
      schedule()
    },
    unobserve: (element: Element) => {
      const block = observed.get(element)
      if (!block) return
      observed.delete(element)
      observer?.unobserve(element)
      if (elements.get(block.id) === element) elements.delete(block.id)
      dirty.delete(block.id)
    },
    /** Watch the scroller for its width and height. Without an observer, read them once now. */
    observeViewport: (element: HTMLElement) => {
      if (viewportElement && viewportElement !== element) observer?.unobserve(viewportElement)
      viewportElement = element
      if (observer) observer.observe(element)
      else options.viewport?.(element.clientWidth, element.clientHeight)
    },
    /** Elements under watch, the scroller included. */
    observedElements: () => observed.size + (viewportElement ? 1 : 0),
    /** Frames and timers still requested. */
    pendingFrames: () => (frame ? 1 : 0) + (settle ? 1 : 0) + (frameClose ? 1 : 0),
    /** Blocks waiting for a pass. */
    pending: () => dirty.size,
    dispose: () => {
      disposed = true
      observer?.disconnect()
      counts.activeObservers = 0
      if (frame) cancelAnimationFrame(frame)
      if (frameClose) cancelAnimationFrame(frameClose)
      if (settle) clearTimeout(settle)
      frame = 0
      frameClose = 0
      settle = 0
      observed.clear()
      elements.clear()
      dirty.clear()
      viewportElement = null
    },
  }
}

export type DiffMeasureScheduler = ReturnType<typeof createDiffMeasureScheduler>

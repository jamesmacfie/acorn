import { batch, createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from 'solid-js'
import { createDiffLayoutIndex, type DiffLayoutBlock } from '../../kit/diff/layoutIndex'
import { createDiffMeasureScheduler } from '../../kit/diff/measureScheduler'
import {
  DIFF_GAP_ROW_HEIGHT, DIFF_LINE_HEIGHT, DIFF_RESOLVED_THREAD_HEIGHT, DIFF_THREAD_HEIGHT,
  isCodeRow, toBands, type CodeRow, type DiffThread, type Row, type ViewMode,
} from '../../kit/diff/diffModel'
import { createScrollAuthor } from '../../kit/lib/timeline/scrollAuthor'
import type { DiffItem } from './documentView'

// The diff's range and scroll authority (docs/diff-rendering/geometry.md § Row geometry).
//
// Code rows have exact heights from the topology; the dynamic blocks between and under them (threads,
// and whatever a line draws under itself: a review note, another plugin's marks, an open composer)
// are measured. The two live apart, in ../../kit/diff/layoutIndex.ts, so a thread that grows moves the
// items below it without the geometry recomputing anything per item.
//
// This module is the reactive part: it builds the index for the projection on screen, derives each
// item's blocks, keeps the heights measured for them, decides which items are mounted, and makes every
// scroll write the diff makes. Before any geometry change it notes where the reader is by identity
// (an item and a point in its code rows, or a block and an offset into it), and after it puts that
// place back, so a block resizing above the reader does not move what they are reading.

/** Mounted beyond each edge of the viewport: about two screens of runway altogether in a normal pane,
 *  so a momentum scroll does not outrun what is mounted. In pixels rather than items, because an item
 *  is a 36px header in one place and a 64-row segment in another. */
export const DIFF_RUNWAY_PX = 800
/** Scroller widths that share measured heights. A block's height depends on its width once it holds
 *  prose, and a pane resize of a few pixels should not make every remembered height suspect. Chosen by
 *  hand, not from a measured resize profile. */
export const DIFF_WIDTH_BUCKET_PX = 80
/** How long after the reader's last scroll event the scroll counts as settled. Long enough to bridge
 *  the gaps in a momentum scroll's events, short enough that a held-back commit lands soon after the
 *  reader stops. Chosen by hand, not from a WebKit momentum profile. */
export const DIFF_SCROLL_SETTLE_MS = 150

/**
 * Something between or under code rows whose height is measured rather than known.
 *
 * `at` is where it sits in its item's code rows, in pixels of fixed geometry. `fingerprint` names the
 * state that decides its height, so a height measured in one state is not reused in another: a thread
 * collapsed, resolved, or given a comment is a different height. What a person types into an open box
 * is not in it, because typing only happens while the block is mounted and measured.
 */
export type DiffDynamicBlock = { id: string; kind: 'thread' | 'line'; at: number; fingerprint: string; estimate: number }

/**
 * Where the reader is. The item and the path are the anchor; the pixels are only the distance into it.
 * `fixed` is a point in the item's code rows, which no block resizing can move. `index` is where the
 * item was, read only when the item has gone and the file's own header has gone with it.
 */
export type DiffReadingPlace =
  | { at: 'row'; key: string; path: string; index: number; fixed: number }
  | { at: 'block'; id: string; offset: number; key: string; path: string; index: number; fixed: number }

/** A mounted item and where it sits. */
export type DiffRangeItem = { index: number; key: string; start: number; end: number }

/** What decides a line's block: the fingerprint of what the row draws under itself (null for
 *  nothing), and whether a composer is open on it. */
export type DiffBlockInputs = {
  extra: (row: CodeRow) => string | null
  composer: (row: CodeRow, side: 'LEFT' | 'RIGHT' | null) => boolean
  collapsed: (thread: DiffThread) => boolean
}

export const threadBlockId = (thread: DiffThread) => `t:${thread.threadId}`

const lineSide = (row: CodeRow) => (row.kind === 'delete' ? 'old' : 'new')
const lineNumber = (row: CodeRow) => (row.kind === 'delete' ? row.oldNo : row.newNo)

/** A unified code row's block: its note, marks, and composer, which all draw inside the row. Null when
 *  it has none. The id ends with the path so a colon in it cannot make two ids equal. */
export function lineBlock(row: CodeRow, inputs: DiffBlockInputs, itemKey = ''): { id: string; fingerprint: string } | null {
  const extra = inputs.extra(row)
  const composer = inputs.composer(row, null)
  if (extra == null && !composer) return null
  return { id: `l:${itemKey}:${lineSide(row)}:${lineNumber(row)}:${row.path}`, fingerprint: `${extra ?? ''}|${composer ? 1 : 0}` }
}

/** A split band's block: both columns' notes and composers, drawn inside the band. */
export function bandBlock(left: CodeRow | null, right: CodeRow | null, inputs: DiffBlockInputs, itemKey = ''): { id: string; fingerprint: string } | null {
  const row = left ?? right
  if (!row) return null
  const leftExtra = left ? inputs.extra(left) : null
  const rightExtra = right && right !== left ? inputs.extra(right) : null
  const leftComposer = !!left && inputs.composer(left, 'LEFT')
  const rightComposer = !!right && inputs.composer(right, 'RIGHT')
  if (leftExtra == null && rightExtra == null && !leftComposer && !rightComposer) return null
  return {
    id: `b:${itemKey}:${left?.oldNo ?? ''}:${right?.newNo ?? ''}:${row.path}`,
    fingerprint: `${leftExtra ?? ''}|${rightExtra ?? ''}|${leftComposer ? 1 : 0}${rightComposer ? 1 : 0}`,
  }
}

export function threadBlock(thread: DiffThread, at: number, collapsed: boolean): DiffDynamicBlock {
  let comments = ''
  for (const comment of thread.comments) comments += `${comment.id}.${comment.body?.length ?? 0},`
  return {
    id: threadBlockId(thread),
    kind: 'thread',
    at,
    estimate: collapsed ? DIFF_RESOLVED_THREAD_HEIGHT : DIFF_THREAD_HEIGHT,
    fingerprint: `${collapsed ? 'c' : 'o'}${thread.resolved ? 'r' : 'u'}:${comments}`,
  }
}

const fixedRowHeight = (row: Row) => (row.kind === 'gap' ? DIFF_GAP_ROW_HEIGHT : DIFF_LINE_HEIGHT)

/** A loaded item's blocks, in the order they are drawn: threads where they are interleaved, and a
 *  line's block after its code line. */
export function rowBlocks(rows: readonly Row[], mode: ViewMode, inputs: DiffBlockInputs, itemKey = ''): DiffDynamicBlock[] {
  const out: DiffDynamicBlock[] = []
  let at = 0
  if (mode === 'unified') {
    for (const row of rows) {
      if (row.kind === 'thread') {
        out.push(threadBlock(row.thread, at, inputs.collapsed(row.thread)))
        continue
      }
      at += fixedRowHeight(row)
      const block = isCodeRow(row) ? lineBlock(row, inputs, itemKey) : null
      if (block) out.push({ ...block, kind: 'line', at, estimate: 0 })
    }
    return out
  }
  for (const band of toBands([...rows])) {
    if (band.kind === 'full') {
      if (band.row.kind === 'thread') out.push(threadBlock(band.row.thread, at, inputs.collapsed(band.row.thread)))
      else at += fixedRowHeight(band.row)
      continue
    }
    at += DIFF_LINE_HEIGHT
    const block = bandBlock(band.left, band.right, inputs, itemKey)
    if (block) out.push({ ...block, kind: 'line', at, estimate: 0 })
  }
  return out
}

/** A height measured for a block, and what it was measured against. */
type HeightEntry = { height: number; fingerprint: string; bucket: number }

function createProjection() {
  return {
    index: createDiffLayoutIndex(),
    /** The items the index was last built for. */
    items: [] as readonly DiffItem[],
    keys: new Map<string, number>(),
    /** Each item's blocks, by item key, kept while the item exists so a scrolled-away item keeps its
     *  height. */
    lists: new Map<string, DiffDynamicBlock[]>(),
    /** Which item each block is in. */
    owner: new Map<string, string>(),
    heights: new Map<string, HeightEntry>(),
  }
}

type Projection = ReturnType<typeof createProjection>

const sameBlocks = (a: readonly DiffDynamicBlock[] | undefined, b: readonly DiffDynamicBlock[]) => {
  if ((a?.length ?? 0) !== b.length) return false
  return b.every((block, at) => {
    const other = a![at]!
    return other.id === block.id && other.at === block.at && other.fingerprint === block.fingerprint && other.estimate === block.estimate
  })
}

const sameRange = (a: readonly DiffRangeItem[], b: readonly DiffRangeItem[]) =>
  a.length === b.length && a.every((item, at) => {
    const other = b[at]!
    return other.key === item.key && other.start === item.start && other.end === item.end
  })

export function createDiffLayout(props: {
  items: Accessor<readonly DiffItem[]>
  mode: Accessor<ViewMode>
  /** An item's exact height with no dynamic block in it. */
  fixedHeight: (item: DiffItem, mode: ViewMode) => number
  /** An item's dynamic blocks, in the order they are drawn. Reads inside are tracked for mounted items. */
  blocks: (item: DiffItem, mode: ViewMode) => DiffDynamicBlock[]
  /** The items the source's own blocks (its threads) are in, from the topology. */
  sourceItems: Accessor<readonly string[]>
  scrollEl: Accessor<HTMLDivElement | undefined>
}) {
  const projections: Record<ViewMode, Projection> = { unified: createProjection(), split: createProjection() }
  const [version, setVersion] = createSignal(0)
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewport, setViewport] = createSignal(0)
  let bucket = 0
  let canvas: HTMLElement | undefined
  let builtMode: ViewMode | null = null
  const author = createScrollAuthor()
  let lastReader = -Infinity
  const counts = { corrections: 0, maxPixels: 0, maxDrift: 0, substituted: 0 }

  const effective = (projection: Projection, block: DiffDynamicBlock) => {
    const entry = projection.heights.get(block.id)
    return entry && entry.fingerprint === block.fingerprint ? entry.height : block.estimate
  }
  const placed = (projection: Projection, list: readonly DiffDynamicBlock[] | undefined): DiffLayoutBlock[] =>
    (list ?? []).map((block) => ({ id: block.id, at: block.at, height: effective(projection, block) }))

  const syncCanvas = (projection: Projection) => {
    if (canvas) canvas.style.height = `${projection.index.total()}px`
  }

  // --- Reading places ---------------------------------------------------------------------------

  const capture = (projection: Projection, top: number): DiffReadingPlace | null => {
    const point = projection.index.pointAt(top)
    const item = point && projection.items[point.index]
    if (!point || !item) return null
    const base = { key: item.key, path: item.file.path, index: point.index }
    if ('fixed' in point) return { at: 'row', ...base, fixed: point.fixed }
    const block = projection.index.blocks(point.index).find((candidate) => candidate.id === point.block)
    return { at: 'block', id: point.block, offset: point.offset, ...base, fixed: block?.at ?? 0 }
  }

  /** Where a place is now, and whether it had to stand in for one that has gone. */
  const resolve = (projection: Projection, place: DiffReadingPlace): { top: number; substituted: boolean } | null => {
    const { index } = projection
    const at = projection.keys.get(place.key)
    if (at !== undefined) {
      if (place.at === 'block') {
        const block = index.blocks(at).find((candidate) => candidate.id === place.id)
        // Clamped, in case the block came back shorter than the offset into it.
        const offset = block ? Math.min(place.offset, Math.max(0, block.height - 1)) : 0
        const top = block ? index.offsetOf({ index: at, block: place.id, offset }) : null
        if (top != null) return { top, substituted: false }
      }
      return { top: index.offsetOf({ index: at, fixed: Math.min(place.fixed, index.fixedSize(at)) })!, substituted: place.at === 'block' }
    }
    // The item has gone, as a collapsed file's segments do: its file's header, or whatever now holds
    // its position.
    const substitute = projection.keys.get(`f:${place.path}`) ?? Math.min(place.index, projection.items.length - 1)
    if (substitute < 0) return null
    return { top: index.top(substitute), substituted: true }
  }

  /** Put the reader at `top`, as this surface's own write. */
  const write = (element: HTMLElement, top: number) => {
    author.write(element, top)
    setScrollTop(element.scrollTop)
  }

  const correct = (element: HTMLElement, place: DiffReadingPlace, projection: Projection) => {
    const found = resolve(projection, place)
    if (!found) return
    if (found.substituted) counts.substituted += 1
    const before = element.scrollTop
    const moved = Math.abs(found.top - before)
    if (moved < 0.5) return
    write(element, found.top)
    counts.corrections += 1
    counts.maxPixels = Math.max(counts.maxPixels, moved)
    // How far the browser left the reader from the place. A clamp against the end of the document is
    // not drift: there is no scrolling further.
    if (found.top <= element.scrollHeight - element.clientHeight) counts.maxDrift = Math.max(counts.maxDrift, Math.abs(element.scrollTop - found.top))
  }

  // --- The index --------------------------------------------------------------------------------

  const rebuild = (projection: Projection, items: readonly DiffItem[], mode: ViewMode) => {
    // Only within one projection. A change of projection swaps the scroller, and restoring a place
    // across it is the scroll restoration's decision (./scrollRestoration.ts).
    const element = builtMode === mode ? props.scrollEl() : undefined
    const place = element && projection.items.length ? capture(projection, element.scrollTop) : null
    const keys = new Map<string, number>()
    items.forEach((item, at) => keys.set(item.key, at))
    for (const [key, list] of projection.lists) {
      if (keys.has(key)) continue
      projection.lists.delete(key)
      for (const block of list) if (projection.owner.get(block.id) === key) projection.owner.delete(block.id)
    }
    projection.items = items
    projection.keys = keys
    projection.index.rebuild(
      items.map((item) => props.fixedHeight(item, mode)),
      (at) => {
        const list = projection.lists.get(items[at]!.key)
        return list && placed(projection, list)
      },
    )
    syncCanvas(projection)
    if (place && element) correct(element, place, projection)
  }

  /** The projection on screen, built for the current items. Rebuilt lazily, on the first read after
   *  the items or the projection change, so nothing reads an index built for a different list. */
  const current = (): Projection => {
    const items = props.items()
    const mode = props.mode()
    const projection = projections[mode]
    if (projection.items !== items) rebuild(projection, items, mode)
    builtMode = mode
    return projection
  }

  /** Re-derive these items' blocks. True when any item's blocks changed. */
  const syncItems = (projection: Projection, keys: Iterable<string>, track: boolean) => {
    const mode = props.mode()
    let changed = false
    for (const key of keys) {
      const at = projection.keys.get(key)
      if (at === undefined) continue
      const item = projection.items[at]!
      const list = track ? props.blocks(item, mode) : untrack(() => props.blocks(item, mode))
      const previous = projection.lists.get(key)
      if (sameBlocks(previous, list)) continue
      for (const block of previous ?? []) if (projection.owner.get(block.id) === key) projection.owner.delete(block.id)
      for (const block of list) projection.owner.set(block.id, key)
      if (list.length) projection.lists.set(key, list)
      else projection.lists.delete(key)
      projection.index.setBlocks(at, placed(projection, list))
      changed = true
    }
    return changed
  }

  /** Change the geometry and keep the reader where they were: note their place, change it, put the
   *  place back with at most one scroll write. */
  const applyGeometry = (change: (projection: Projection) => boolean) => {
    const projection = current()
    const element = props.scrollEl()
    const place = element && projection.items.length ? capture(projection, element.scrollTop) : null
    if (!change(projection)) return
    syncCanvas(projection)
    batch(() => {
      setVersion((value) => value + 1)
      if (place && element) correct(element, place, projection)
    })
  }

  // --- Measurement ------------------------------------------------------------------------------

  const blockOf = (projection: Projection, id: string) => {
    const key = projection.owner.get(id)
    const at = key === undefined ? undefined : projection.keys.get(key)
    const block = key === undefined ? undefined : projection.lists.get(key)?.find((candidate) => candidate.id === id)
    return at === undefined || !block ? null : { at, key: key!, block }
  }

  const readerWait = () => Math.max(0, lastReader + DIFF_SCROLL_SETTLE_MS - Date.now())

  const scheduler = createDiffMeasureScheduler({
    held: (id) => {
      const projection = current()
      const found = blockOf(projection, id)
      return found ? effective(projection, found.block) : undefined
    },
    above: (id) => {
      const projection = current()
      const found = blockOf(projection, id)
      const element = props.scrollEl()
      if (!found || !element) return false
      const top = projection.index.offsetOf({ index: found.at, block: id, offset: 0 })
      return top != null && top + effective(projection, found.block) <= element.scrollTop
    },
    readerWait,
    commit: (changes) => applyGeometry((projection) => {
      const touched = new Set<string>()
      for (const [id, height] of changes) {
        const found = blockOf(projection, id)
        if (!found) continue
        projection.heights.set(id, { height, fingerprint: found.block.fingerprint, bucket })
        touched.add(found.key)
      }
      for (const key of touched) projection.index.setBlocks(projection.keys.get(key)!, placed(projection, projection.lists.get(key)))
      return touched.size > 0
    }),
    viewport: (width, height) => {
      setViewport(height)
      bucket = Math.floor(width / DIFF_WIDTH_BUCKET_PX)
    },
  })
  onCleanup(() => {
    scheduler.dispose()
    author.dispose()
  })

  // --- The mounted range ------------------------------------------------------------------------

  const range = createMemo<DiffRangeItem[]>(() => {
    version()
    const projection = current()
    const { index } = projection
    if (!index.count) return []
    const top = scrollTop()
    const first = index.indexAt(Math.max(0, top - DIFF_RUNWAY_PX))
    const last = index.indexAt(top + viewport() + DIFF_RUNWAY_PX)
    const out: DiffRangeItem[] = []
    for (let at = first; at <= last; at++) {
      const start = index.top(at)
      out.push({ index: at, key: projection.items[at]!.key, start, end: start + index.size(at) })
    }
    return out
  }, [], { equals: sameRange })

  // The source's own blocks, wherever they are: a thread arriving, resolving, or going away changes
  // its item's height whether or not it is mounted. Items already holding blocks are re-derived too,
  // so one that loses its last thread gives the space back.
  createEffect(() => {
    const keys = new Set(props.sourceItems())
    applyGeometry((projection) => {
      for (const key of projection.lists.keys()) keys.add(key)
      return syncItems(projection, keys, false)
    })
  })

  // Mounted items, tracked: their rows arriving, a composer opening, a note or a mark appearing.
  createEffect(() => {
    const keys = range().map((item) => item.key)
    applyGeometry((projection) => syncItems(projection, keys, true))
  })

  const scrollEl = () => props.scrollEl()

  return {
    range,
    scrollTop,
    totalSize: () => {
      version()
      return current().index.total()
    },
    /** Where item `index` starts now. */
    top: (index: number) => untrack(() => current().index.top(index)),
    /** The pixel offset of a point in an item's code rows, blocks above it included. */
    offsetOf: (index: number, fixed: number) => untrack(() => current().index.offsetOf({ index, fixed })),

    /** Hand over the scroller: its size decides the range and the width bucket. */
    attach: (element: HTMLDivElement) => {
      setViewport(element.clientHeight)
      bucket = Math.floor(element.clientWidth / DIFF_WIDTH_BUCKET_PX)
      setScrollTop(element.scrollTop)
      scheduler.observeViewport(element)
    },
    /** Hand over the canvas, whose height this module sets directly: a correction has to be written
     *  after the canvas is tall enough to take it, not whenever the renderer next runs. */
    attachCanvas: (element: HTMLElement) => {
      canvas = element
      syncCanvas(untrack(current))
    },

    /** Watch a mounted block while `block` names one. `base` is the element's fixed part. */
    observeBlock: (element: HTMLElement, block: Accessor<{ id: string; base: number } | null>) => {
      const named = createMemo(block, null, { equals: (a, b) => a?.id === b?.id && a?.base === b?.base })
      createEffect(() => {
        const watched = named()
        if (!watched) return
        element.dataset.block = watched.id
        scheduler.observe(element, watched.id, watched.base)
        onCleanup(() => {
          scheduler.unobserve(element)
          delete element.dataset.block
        })
      })
    },

    /** The reader touched the scroller: a wheel, a touch, a pointer, a key. */
    input: author.input,
    /**
     * A scroll event. Says who moved the view: this surface (`own`), the reader or the momentum of
     * their gesture (`reader`), or neither, such as the browser clamping against a shorter canvas
     * (`other`). A scroll event alone never counts as the reader: this surface's own corrections emit
     * them too, and would keep the reader's settling window open against its own work.
     */
    onScroll: (element: HTMLDivElement): 'own' | 'reader' | 'other' => {
      let cause: 'own' | 'reader' | 'other' = 'own'
      if (!author.applying()) {
        const now = Date.now()
        cause = author.fresh() || now - lastReader < DIFF_SCROLL_SETTLE_MS ? 'reader' : 'other'
        if (cause === 'reader') lastReader = now
      }
      setScrollTop(element.scrollTop)
      return cause
    },

    /** Move to an offset, as this surface's own scroll: a file or a match the reader asked for. */
    scrollToOffset: (top: number) => {
      const element = scrollEl()
      if (element) write(element, Math.max(0, top))
    },
    scrollToIndex: (index: number) => {
      const element = scrollEl()
      if (element) write(element, untrack(() => current().index.top(index)))
    },
    /** The reader's place now, from the last scroll position seen. */
    place: (): DiffReadingPlace | null => untrack(() => capture(current(), scrollTop())),
    /** Go to a remembered place. False when there is nothing to lay it out against yet. */
    goTo: (place: DiffReadingPlace): boolean => {
      const element = scrollEl()
      const projection = untrack(current)
      if (!element || !projection.items.length) return false
      const found = resolve(projection, place)
      if (!found) return false
      if (found.substituted) counts.substituted += 1
      write(element, found.top)
      return true
    },
    /** Forget every measured height: a different document. */
    reset: () => {
      for (const projection of Object.values(projections)) {
        projection.heights.clear()
        projection.lists.clear()
        projection.owner.clear()
        projection.items = []
      }
    },

    /** What the geometry did, for the health reading. */
    health: () => {
      const projection = untrack(current)
      let blocks = 0
      for (const item of untrack(range)) blocks += projection.lists.get(item.key)?.length ?? 0
      return {
        measurement: {
          ...scheduler.counts,
          observedElements: scheduler.observedElements(),
          fixedRebuilds: projections.unified.index.stats.fixedRebuilds + projections.split.index.stats.fixedRebuilds,
        },
        correction: { count: counts.corrections, maxPixels: counts.maxPixels, maxAnchorDrift: counts.maxDrift, substituted: counts.substituted },
        mountedBlocks: blocks,
        pendingFrames: scheduler.pendingFrames() + author.pendingFrames(),
      }
    },
  }
}

export type DiffLayout = ReturnType<typeof createDiffLayout>

import { createMemo, type Accessor } from 'solid-js'
import { segmentContentKey, type DiffDocumentFile, type DiffDocumentTopology, type DiffSegmentDescriptor } from '@acorn/diff-document/document'
import {
  DIFF_FILE_HEADER_HEIGHT, DIFF_GAP_ROW_HEIGHT, DIFF_LINE_HEIGHT,
  type CodeRow, type DiffThread, type ViewMode,
} from '../../kit/diff/diffModel'

// The document as the viewer scrolls it: one item per file header, per segment, and per slice of an
// expanded gap, built from the topology alone (docs/diff-rendering/loading.md § Parsing and highlighting). No row exists here.
// A segment item's code rows have an exact height from its counts before its rows load, and a
// segment's inline threads are known from their line numbers, so ./diffLayout.ts can reserve for them
// and the scrollbar and every file's offset are right from the first frame.

/** One segment of one file, and the key its content is cached and requested under. */
export type SegmentRef = { file: DiffDocumentFile; ordinal: number; descriptor: DiffSegmentDescriptor; contentKey: string }

/** The context lines a gap revealed, and which edge of its segment the gap was on. A gap only ever
 *  sits at a segment's first row, or the bottom gap at its last (@acorn/diff-document § segmentRows). */
export type GapOverlay = { edge: 'first' | 'last'; rows: CodeRow[] }
/** Where a segment's revealed context is kept. The path is part of it because two files with the same
 *  patch share a content key and still reveal different lines. */
export const overlayKey = (path: string, contentKey: string) => `${path}\u0000${contentKey}`

export type DiffItem =
  | { kind: 'file'; key: string; file: DiffDocumentFile }
  | { kind: 'nodiff'; key: string; file: DiffDocumentFile }
  | { kind: 'segment'; key: string; file: DiffDocumentFile; segment: SegmentRef; skipFirst: boolean; skipLast: boolean }
  | { kind: 'overlay'; key: string; file: DiffDocumentFile; rows: CodeRow[] }

/** Revealed context is drawn in slices this long, so opening a five-thousand-line gap mounts a
 *  segment's worth of rows rather than all of them. */
export const OVERLAY_SLICE_ROWS = 64

/** Where a thread sits: the new side unless GitHub said LEFT. The same rule that interleaves it. */
export const threadAnchor = (thread: DiffThread): { side: 'old' | 'new'; line: number } | null =>
  thread.line == null ? null : { side: thread.side === 'LEFT' ? 'old' : 'new', line: thread.line }

const covers = (descriptor: DiffSegmentDescriptor, side: 'old' | 'new', line: number): boolean => {
  const [oldFirst, oldLast, newFirst, newLast] = descriptor.lines
  return side === 'old' ? !!oldFirst && line >= oldFirst && line <= oldLast : !!newFirst && line >= newFirst && line <= newLast
}

/** Which of a file's segments holds this line. Their line spans only increase, so the first that
 *  covers it is the one. */
export function segmentOfLine(file: DiffDocumentFile, side: 'old' | 'new', line: number): number {
  return file.segments.findIndex((descriptor) => covers(descriptor, side, line))
}

export function createDocumentView(props: {
  topology: Accessor<DiffDocumentTopology | undefined>
  collapsed: Accessor<ReadonlySet<string>>
  /** Expanded gaps, by the content key of the segment they were in. */
  overlays: Accessor<ReadonlyMap<string, GapOverlay[]>>
  threads: Accessor<readonly DiffThread[] | undefined>
  /** The files a file filter kept, with where it matched each path. `null` when nothing is filtered. */
  filter: Accessor<ReadonlyMap<string, readonly number[]> | null>
}) {
  const files = createMemo(() => props.topology()?.files ?? [])
  const fileByPath = createMemo(() => new Map(files().map((file) => [file.path, file])))

  const items = createMemo<DiffItem[]>(() => {
    const out: DiffItem[] = []
    const overlays = props.overlays()
    const collapsed = props.collapsed()
    const filter = props.filter()
    for (const file of files()) {
      if (filter && !filter.has(file.path)) continue
      out.push({ kind: 'file', key: `f:${file.path}`, file })
      if (collapsed.has(file.path)) continue
      if (!file.patchKey || !file.segments.length) {
        out.push({ kind: 'nodiff', key: `n:${file.path}`, file })
        continue
      }
      file.segments.forEach((descriptor, ordinal) => {
        const contentKey = segmentContentKey(file.patchKey!, ordinal)
        const segment: SegmentRef = { file, ordinal, descriptor, contentKey }
        const opened = overlays.get(overlayKey(file.path, contentKey)) ?? []
        const first = opened.find((overlay) => overlay.edge === 'first')
        const last = opened.find((overlay) => overlay.edge === 'last')
        const slices = (overlay: GapOverlay) => {
          for (let at = 0; at < overlay.rows.length; at += OVERLAY_SLICE_ROWS) {
            out.push({ kind: 'overlay', key: `o:${file.path}:${ordinal}:${overlay.edge}:${at}`, file, rows: overlay.rows.slice(at, at + OVERLAY_SLICE_ROWS) })
          }
        }
        if (first) slices(first)
        const kept = descriptor.rows - (first ? 1 : 0) - (last ? 1 : 0)
        if (kept > 0) out.push({ kind: 'segment', key: `s:${file.path}:${ordinal}`, file, segment, skipFirst: !!first, skipLast: !!last })
        if (last) slices(last)
      })
    }
    return out
  })

  const indexByKey = createMemo(() => new Map(items().map((item, index) => [item.key, index])))

  // Each segment item's threads, from their line numbers alone, in the source's order.
  const threadsIn = createMemo(() => {
    const byKey = new Map<string, DiffThread[]>()
    for (const thread of props.threads() ?? []) {
      const anchor = threadAnchor(thread)
      const file = thread.path ? fileByPath().get(thread.path) : undefined
      if (!anchor || !file) continue
      const ordinal = segmentOfLine(file, anchor.side, anchor.line)
      if (ordinal < 0) continue
      const key = `s:${file.path}:${ordinal}`
      const bucket = byKey.get(key)
      if (bucket) bucket.push(thread)
      else byKey.set(key, [thread])
    }
    return byKey
  })

  /** An item's code rows, headers and gaps: exact, because none of them wraps. Threads and whatever a
   *  line draws under itself are dynamic blocks on top of this (./diffLayout.ts). */
  const fixedHeight = (item: DiffItem, mode: ViewMode): number => {
    if (item.kind === 'file') return DIFF_FILE_HEADER_HEIGHT
    if (item.kind === 'nodiff') return DIFF_GAP_ROW_HEIGHT
    if (item.kind === 'overlay') return item.rows.length * DIFF_LINE_HEIGHT
    const { descriptor } = item.segment
    const skipped = (item.skipFirst ? 1 : 0) + (item.skipLast ? 1 : 0)
    const lines = (mode === 'split' ? descriptor.bands : descriptor.rows) - descriptor.gaps
    const gaps = descriptor.gaps - skipped
    return lines * DIFF_LINE_HEIGHT + gaps * DIFF_GAP_ROW_HEIGHT
  }

  /** Threads the source has that land in some segment of this document. */
  const placedThreads = createMemo(() => {
    let count = 0
    for (const thread of props.threads() ?? []) {
      const anchor = threadAnchor(thread)
      const file = thread.path ? fileByPath().get(thread.path) : undefined
      if (anchor && file && segmentOfLine(file, anchor.side, anchor.line) >= 0) count++
    }
    return count
  })

  return { files, fileByPath, items, indexByKey, fixedHeight, threadsIn, placedThreads }
}

export type DocumentView = ReturnType<typeof createDocumentView>

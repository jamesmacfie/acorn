import { DIFF_DOCUMENT_VERSION, SEGMENT_MAX_BYTES, SEGMENT_MAX_ROWS, type DiffDocumentFile, type DiffDocumentTopology, type DiffSegmentDescriptor, type PlainDiffRow } from './model'
import { parsePatch } from './parse'

/** One file's patch, cut into segments. `bytes` is roughly what the rows weigh as JSON, which is the
 *  weight a cache of parsed files charges for them. */
export type FileDocument = { segments: PlainDiffRow[][]; descriptors: DiffSegmentDescriptor[]; bytes: number }

export type SegmentLimits = { rows: number; bytes: number }

const LIMITS: SegmentLimits = { rows: SEGMENT_MAX_ROWS, bytes: SEGMENT_MAX_BYTES }

/** UTF-8 length without allocating an encoded copy. */
function utf8Length(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++ }
    else bytes += 3
  }
  return bytes
}

// A row's text plus a flat allowance for its numbers and the JSON around it.
const ROW_OVERHEAD = 32
export const rowBytes = (row: PlainDiffRow): number =>
  ROW_OVERHEAD + (row.kind === 'gap' ? 0 : utf8Length(row.kind === 'hunk' ? row.text : row.raw))

// A tab advances to the next multiple of eight, matching CSS tab-size's default. Counting it as one
// column under-measures indented code, and under-measuring is the failure that clips a line.
const TAB_COLUMNS = 8
export function lineColumns(raw: string): number {
  let cols = 0
  for (const ch of raw) cols = ch === '\t' ? (Math.floor(cols / TAB_COLUMNS) + 1) * TAB_COLUMNS : cols + 1
  return cols
}

const isCode = (row: PlainDiffRow) => row.kind === 'normal' || row.kind === 'insert' || row.kind === 'delete'

/**
 * How many bands the split view draws for these rows: a hunk, a gap or an unchanged line is one band,
 * and a run of deletions followed by a run of insertions pairs up into as many bands as the longer run.
 * The same pairing the renderer's `toBands` does, so the count is exact before any row is built.
 */
export function bandCount(rows: readonly PlainDiffRow[]): number {
  let bands = 0
  let i = 0
  while (i < rows.length) {
    const kind = rows[i]!.kind
    if (kind !== 'delete' && kind !== 'insert') {
      bands++
      i++
      continue
    }
    let d = i
    while (d < rows.length && rows[d]!.kind === 'delete') d++
    let n = d
    while (n < rows.length && rows[n]!.kind === 'insert') n++
    bands += Math.max(d - i, n - d)
    i = n
  }
  return bands
}

export function describeSegment(rows: readonly PlainDiffRow[], limits: SegmentLimits = LIMITS): DiffSegmentDescriptor {
  let gaps = 0
  let columns = 0
  let oldFirst = 0
  let oldLast = 0
  let newFirst = 0
  let newLast = 0
  for (const row of rows) {
    if (row.kind === 'gap') gaps++
    if (row.kind !== 'normal' && row.kind !== 'insert' && row.kind !== 'delete') continue
    columns = Math.max(columns, lineColumns(row.raw))
    if (row.oldNo != null) {
      if (!oldFirst) oldFirst = row.oldNo
      oldLast = row.oldNo
    }
    if (row.newNo != null) {
      if (!newFirst) newFirst = row.newNo
      newLast = row.newNo
    }
  }
  const descriptor: DiffSegmentDescriptor = { rows: rows.length, bands: bandCount(rows), gaps, columns, lines: [oldFirst, oldLast, newFirst, newLast] }
  if (rows.length === 1 && rowBytes(rows[0]!) > limits.bytes) descriptor.oversize = true
  return descriptor
}

// Whether a segment may begin at `rows[at]` without splitting a change run from its pair: a deletion
// run followed by insertions draws as paired bands, and a cut between them would pair each half with
// nothing.
const safeStart = (rows: readonly PlainDiffRow[], at: number): boolean => {
  const row = rows[at]!
  const before = rows[at - 1]
  if (!before || !isCode(row)) return true
  if (row.kind === 'normal') return true
  if (row.kind === 'delete') return before.kind !== 'delete'
  return before.kind !== 'delete' && before.kind !== 'insert'
}

/**
 * Cut plain rows into segments bounded by both row count and bytes.
 *
 * Boundaries fall between hunks where they can: a hunk joins the segment before it only when it fits
 * whole. A top or middle gap always opens a segment, and the bottom gap always closes one, so an
 * expanded gap is always at a segment's edge and its revealed lines slot in beside the segment rather
 * than through the middle of it. A hunk too big for one segment is split at the last point that does
 * not separate a deletion run from its insertions, within the back half of the segment, or at the
 * limit if there is none. Deterministic: the same rows always cut the same way.
 */
export function segmentRows(rows: readonly PlainDiffRow[], limits: SegmentLimits = LIMITS): FileDocument {
  // Units: a hunk with the gap in front of it, or the bottom gap on its own.
  const units: PlainDiffRow[][] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const opens = row.kind === 'gap' || (row.kind === 'hunk' && rows[i - 1]?.kind !== 'gap')
    if (opens || !units.length) units.push([row])
    else units[units.length - 1]!.push(row)
  }

  const segments: PlainDiffRow[][] = []
  let current: PlainDiffRow[] = []
  let currentBytes = 0
  const flush = () => {
    if (current.length) segments.push(current)
    current = []
    currentBytes = 0
  }
  let total = 0
  for (const unit of units) {
    const sizes = unit.map(rowBytes)
    const unitBytes = sizes.reduce((sum, size) => sum + size, 0)
    total += unitBytes
    const head = unit[0]!
    const bottom = head.kind === 'gap' && head.side === 'bottom'
    const opensSegment = head.kind === 'gap' && !bottom
    const fits = current.length + unit.length <= limits.rows && currentBytes + unitBytes <= limits.bytes
    if (opensSegment || !fits) flush()
    if (current.length + unit.length <= limits.rows && currentBytes + unitBytes <= limits.bytes) {
      current.push(...unit)
      currentBytes += unitBytes
      continue
    }
    // Too big for a segment of its own: split it.
    for (let i = 0; i < unit.length; i++) {
      const size = sizes[i]!
      if (size > limits.bytes) {
        flush()
        segments.push([unit[i]!])
        continue
      }
      if (current.length + 1 > limits.rows || currentBytes + size > limits.bytes) {
        let cut = current.length
        let carriedBytes = 0
        if (!safeStart(unit, i)) {
          // Walk back to where the run began, within the back half of this segment, as long as the
          // rows carried forward still leave room for this one.
          const offset = i - current.length
          let back = 0
          for (let at = current.length - 1; at >= Math.ceil(current.length / 2); at--) {
            back += sizes[offset + at]!
            if (back + size > limits.bytes) break
            if (safeStart(unit, offset + at)) {
              cut = at
              carriedBytes = back
              break
            }
          }
        }
        const carried = current.slice(cut)
        current = current.slice(0, cut)
        flush()
        current = carried
        currentBytes = carriedBytes
      }
      current.push(unit[i]!)
      currentBytes += size
    }
  }
  flush()
  return { segments, descriptors: segments.map((segment) => describeSegment(segment, limits)), bytes: total }
}

/** One file's patch, parsed and cut. */
export const fileDocument = (path: string, patch: string | null, limits: SegmentLimits = LIMITS): FileDocument =>
  segmentRows(parsePatch(path, patch), limits)

/** cyrb53: a 53-bit string hash, stable on every engine. Identity for a revision, not a security
 *  boundary: a collision would make the viewer keep one layout across two revisions, never serve
 *  wrong rows, because every segment is addressed by its own content key. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** The whole document from its files, with totals and a revision over every path and patch. */
export function documentTopology(files: DiffDocumentFile[]): DiffDocumentTopology {
  let rows = 0
  let bands = 0
  let segments = 0
  let columns = 0
  let identity = ''
  for (const file of files) {
    identity += `${file.path}\u0000${file.patchKey ?? ''}\u0000`
    for (const segment of file.segments) {
      rows += segment.rows
      bands += segment.bands
      segments++
      columns = Math.max(columns, segment.columns)
    }
  }
  return {
    schemaVersion: DIFF_DOCUMENT_VERSION,
    revision: `${files.length}:${hash53(identity)}`,
    files,
    totals: { files: files.length, rows, bands, segments, columns },
  }
}

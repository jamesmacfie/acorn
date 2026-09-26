// The segmented diff document: what a provider's route sends and what the shared viewer reads
// (docs/diff-rendering.md § The document).
//
// A document arrives in two parts. The topology is every file and, for each, the bounded segments its
// patch was cut into, described by counts alone: rows, split bands, gaps, the widest line, and which
// line numbers the segment covers. That is enough to lay out and scroll the whole diff before one line
// of it is loaded. A segment's payload is its plain rows, fetched when the reader comes near it.
//
// Nothing here is named for a provider. GitHub, its compare preview, and a local working tree all
// produce this shape, and the renderer never learns which one it is drawing.

/** Bumped whenever parsing or segmenting would turn the same patch into different segments. It is
 *  part of every segment's content key, so a new version never serves an old cut. */
export const DIFF_DOCUMENT_VERSION = 1

/** A segment holds at most this many rows. Sized so that the viewport plus one segment of runway each
 *  way mounts a few hundred rows at most, which is the bound the health probe asserts. */
export const SEGMENT_MAX_ROWS = 64
/** And at most this many bytes of row text. A generated file with one enormous line per row fills a
 *  segment by bytes long before it does by rows. A single row over the limit is kept whole, alone in a
 *  segment marked `oversize`. */
export const SEGMENT_MAX_BYTES = 32 * 1024

/** The most segments one batch request may name. */
export const MAX_SEGMENTS_PER_REQUEST = 32
/** The most matches one search page carries. */
export const SEARCH_PAGE_MATCHES = 500
/** The most segments one search page reads, about 64,000 rows. A query that matches little answers a
 *  short or empty page with a cursor, so no single request scans the whole of a large document. */
export const SEARCH_PAGE_SEGMENTS = 1_000
/** The longest query a search accepts. */
export const SEARCH_MAX_QUERY = 256
/** The most files one document, or one request listing a document's files, may hold. GitHub stops a
 *  pull request's list at 3,000 files; a working tree has no ceiling of its own, so this is it. */
export const MAX_DOCUMENT_FILES = 5_000

// Plain rows: what a patch parses into, before any colour. The renderer adds the path, the new-side
// key and the tokens when it builds its own rows from these.
export type PlainCodeRow = { kind: 'normal' | 'insert' | 'delete'; oldNo: number | null; newNo: number | null; raw: string }
export type PlainHunkRow = { kind: 'hunk'; text: string }
// A run of unchanged lines hidden above, between, or below hunks. `count` is null for the bottom gap:
// its size needs the file's length, known only once the new side is read.
export type PlainGapRow = { kind: 'gap'; side: 'top' | 'mid' | 'bottom'; oldStart: number; newStart: number; count: number | null }
export type PlainDiffRow = PlainCodeRow | PlainHunkRow | PlainGapRow

/**
 * One segment, described without its rows. Its position in the file's `segments` array is its ordinal.
 *
 * `rows` and `bands` are exact for the two projections: the unified list and the split view's paired
 * bands. `gaps` counts the gap rows among them, because a gap row is drawn taller than a code row and
 * the renderer owns the pixel heights. `lines` is the first and last old-side and new-side line number
 * the segment's code rows carry, 0 where a side has none, which is how an inline thread is placed in
 * its segment before the segment loads.
 */
export type DiffSegmentDescriptor = {
  rows: number
  bands: number
  gaps: number
  columns: number
  lines: [oldFirst: number, oldLast: number, newFirst: number, newLast: number]
  /** One row over the byte limit, kept whole. */
  oversize?: true
}

/** One file in a document. `patchKey` is the patch's own content digest, and null means the file has
 *  no diff to show (binary, too large, or nothing changed). `sha` is whatever the source needs to read
 *  the file's new side for gap expansion, handed back to it untouched. */
export type DiffDocumentFile = {
  path: string
  status: string | null
  additions: number | null
  deletions: number | null
  sha: string | null
  viewed: boolean
  patchKey: string | null
  segments: DiffSegmentDescriptor[]
}

/** Everything needed to draw and navigate a diff, with no source text in it. */
export type DiffDocumentTopology = {
  schemaVersion: number
  /** Which files and which patches. Moves when any file or patch does. */
  revision: string
  files: DiffDocumentFile[]
  totals: { files: number; rows: number; bands: number; segments: number; columns: number }
}

/** A segment by its content: the file's path, the patch it was cut from, and where in it. */
export type DiffSegmentRequest = { path: string; patchKey: string; ordinal: number }
export type DiffSegmentPayload = DiffSegmentRequest & { rows: PlainDiffRow[] }

export type DiffSearchRequest = { query: string; caseSensitive: boolean; cursor: string | null }
/** A match by segment and row, so the reader can be taken to one without the renderer holding the
 *  document. `start` and `end` are offsets into the row's text. */
export type DiffSearchMatch = { path: string; patchKey: string; ordinal: number; row: number; start: number; end: number }
export type DiffSearchPage = { matches: DiffSearchMatch[]; nextCursor: string | null }

/** A segment's identity by content. Stable while other files come and go, and different whenever the
 *  patch or the parser is, so a cache keyed by it can never serve rows from another revision. */
export const segmentContentKey = (patchKey: string, ordinal: number): string => `v${DIFF_DOCUMENT_VERSION}:${patchKey}:${ordinal}`

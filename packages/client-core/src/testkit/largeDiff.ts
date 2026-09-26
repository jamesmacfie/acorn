// The generated large diff behind the large-surface fixture (docs/testing.md § Large-surface fixture).
//
// Deterministic from a seed and built at run time, so nothing checked in is a million lines long.
// Files come out of a generator one at a time with both sides of the file, the unified patch between
// them, the source's threads and the line notes anchored in it. A test can stream the canonical
// profile through a digest without holding it, and the desktop seeder can write each file's two sides
// into a Git repository and let the real Changes pane diff them.
//
// The patch is built here from the same edit script as the two sides, so its rows are known exactly:
// `rows` counts what `buildRenderableRows` makes of the file (the file row, gaps, hunk headers and
// code rows), which is what the diff's health reading calls fixed rows.
//
// Test scaffolding: imported by tests and by the agent-automation seeder, never by production code
// (tools/arch/boundaries.test.ts § the testkit is imported only by tests).
import { documentTopology, fileDocument, searchDocument, type DiffDocumentFile, type DiffSegmentPayload, type DiffSegmentRequest } from '@acorn/diff-document/document'
import type { DiffFile, DiffThread } from '../kit/diff/diffModel'
import type { DiffLineAnchor, DiffSource } from '../features/diff/source'

export type LargeSurfaceProfile = 'small' | 'scale' | 'canonical'

/** Files, the fixed rows they add up to, and the dynamic blocks (threads and notes) anchored in them. */
export const LARGE_SURFACE_PROFILES: Record<LargeSurfaceProfile, { files: number; rows: number; largeFiles: number; largeRows: number; threads: number; notes: number }> = {
  small: { files: 22, rows: 10_000, largeFiles: 1, largeRows: 3_000, threads: 20, notes: 20 },
  scale: { files: 220, rows: 100_000, largeFiles: 3, largeRows: 12_000, threads: 100, notes: 100 },
  canonical: { files: 2_200, rows: 1_040_000, largeFiles: 8, largeRows: 60_000, threads: 400, notes: 400 },
}

/** A review note on one line, in the Changes plugin's own vocabulary. */
export type LargeDiffNote = { path: string; side: 'additions' | 'deletions'; line: number; snippet: string; body: string }

export type LargeDiffFile = DiffFile & {
  /** The file's previous path when it was renamed. The diff model has no field for it. */
  oldPath: string | null
  /** Both sides, whole, or null when that side does not exist. A binary file holds NUL bytes. */
  base: string | null
  head: string | null
  binary: boolean
  threads: DiffThread[]
  notes: LargeDiffNote[]
  /** What `buildRenderableRows` makes of this file before threads are interleaved. */
  rows: number
}

type Op = { kind: ' ' | '-' | '+'; text: string }

/** mulberry32: small, fast, and the same sequence on every engine. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = ['alpha', 'branch', 'cursor', 'delta', 'engine', 'frame', 'glyph', 'hunk', 'index', 'join', 'kernel', 'layout']
/** One block of text that recurs across files, so nothing may key a row by its text or position. */
const DUPLICATE = ['  if (value == null) return fallback', '  return value', '}']
const LONG_LINE = `const table = [${Array.from({ length: 700 }, (_, index) => index).join(', ')}]`

function line(next: () => number, n: number): string {
  const word = WORDS[Math.floor(next() * WORDS.length)]
  const roll = next()
  if (roll < 0.04) return `\tindent_${word}(${n})\t// tab`
  if (roll < 0.06) return ''
  return `  const ${word}${n} = compute(${Math.floor(next() * 1000)}, '${word}')`
}

/** The edit script for one file: runs of context with changes between them, about `target` rows. */
function editScript(next: () => number, target: number, fileIndex: number): Op[] {
  const ops: Op[] = []
  let n = 0
  let codeRows = 0
  while (codeRows < target) {
    // Mostly short runs, now and then a long one, so hunks split and gaps appear between them.
    const context = next() < 0.15 ? 12 + Math.floor(next() * 40) : 1 + Math.floor(next() * 5)
    for (let i = 0; i < context; i++) ops.push({ kind: ' ', text: line(next, n++) })
    codeRows += Math.min(context, 6)
    const dels = Math.floor(next() * 5)
    const adds = Math.max(dels === 0 ? 1 : 0, Math.floor(next() * 7))
    const duplicate = next() < 0.05
    for (let i = 0; i < dels; i++) ops.push({ kind: '-', text: duplicate ? DUPLICATE[i % DUPLICATE.length]! : line(next, n++) })
    for (let i = 0; i < adds; i++) {
      const text = duplicate ? DUPLICATE[i % DUPLICATE.length]! : fileIndex % 97 === 5 && i === 0 ? LONG_LINE : line(next, n++)
      ops.push({ kind: '+', text })
    }
    codeRows += dels + adds
  }
  for (let i = 0; i < 3; i++) ops.push({ kind: ' ', text: line(next, n++) })
  return ops
}

type Hunk = { start: number; end: number; oldStart: number; newStart: number; oldLines: number; newLines: number }

/** Changes grouped into hunks with three lines of context, the way `git diff` groups them. */
function hunksOf(ops: Op[], context = 3): Hunk[] {
  const oldAt = new Int32Array(ops.length + 1)
  const newAt = new Int32Array(ops.length + 1)
  for (let i = 0; i < ops.length; i++) {
    oldAt[i + 1] = oldAt[i]! + (ops[i]!.kind === '+' ? 0 : 1)
    newAt[i + 1] = newAt[i]! + (ops[i]!.kind === '-' ? 0 : 1)
  }
  const ranges: [number, number][] = []
  for (let i = 0; i < ops.length; i++) {
    if (ops[i]!.kind === ' ') continue
    const start = Math.max(0, i - context)
    const end = Math.min(ops.length - 1, i + context)
    const last = ranges[ranges.length - 1]
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else ranges.push([start, end])
  }
  return ranges.map(([start, end]) => {
    const oldLines = oldAt[end + 1]! - oldAt[start]!
    const newLines = newAt[end + 1]! - newAt[start]!
    // A side with no lines names the line before it, which is 0 for a file that did not exist.
    return { start, end, oldLines, newLines, oldStart: oldLines ? oldAt[start]! + 1 : oldAt[start]!, newStart: newLines ? newAt[start]! + 1 : newAt[start]! }
  })
}

function patchOf(ops: Op[], hunks: Hunk[]): string {
  const out: string[] = []
  for (const hunk of hunks) {
    out.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
    for (let i = hunk.start; i <= hunk.end; i++) out.push(`${ops[i]!.kind}${ops[i]!.text}`)
  }
  return out.join('\n')
}

/** The rows the diff model builds from these hunks: file row, top and middle gaps, headers, code
 *  rows, and the bottom gap it always adds after the last hunk. */
function rowsOf(hunks: Hunk[]): number {
  if (!hunks.length) return 2
  let rows = 1 + 1
  hunks.forEach((hunk, index) => {
    const previous = hunks[index - 1]
    if (index === 0 ? hunk.newStart > 1 : hunk.newStart - (previous!.newStart + previous!.newLines - 1) > 1) rows++
    rows += 1 + (hunk.end - hunk.start + 1)
  })
  return rows
}

const BODIES = [
  'Could this be **simpler**? The loop above already covers it.',
  'A screenshot of what I see:\n\n![rendering](https://example.invalid/fixture.png)',
  '<details><summary>Full trace</summary>\n\n```\nat compute (engine.ts:12)\nat frame (engine.ts:40)\n```\n</details>',
  '```suggestion\n  return value ?? fallback\n```',
  'Nit: naming.',
]

/** Pick evenly spaced anchors, with the first and last line of the file among them. */
function anchorsIn(ops: Op[], hunks: Hunk[], count: number): { op: Op; oldNo: number; newNo: number }[] {
  if (!count || !hunks.length) return []
  const candidates: { op: Op; oldNo: number; newNo: number }[] = []
  for (const hunk of hunks) {
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    for (let i = hunk.start; i <= hunk.end; i++) {
      const op = ops[i]!
      candidates.push({ op, oldNo: op.kind === '+' ? 0 : oldNo, newNo: op.kind === '-' ? 0 : newNo })
      if (op.kind !== '+') oldNo++
      if (op.kind !== '-') newNo++
    }
  }
  if (count === 1) return [candidates[0]!]
  return Array.from({ length: count }, (_, index) => candidates[Math.round((index * (candidates.length - 1)) / (count - 1))]!)
}

/**
 * Every file of one profile, in display order. The same seed yields the same files, paths, patches,
 * threads and notes on every run.
 */
export function* largeDiffFiles(profile: LargeSurfaceProfile, seed = 1): Generator<LargeDiffFile> {
  const shape = LARGE_SURFACE_PROFILES[profile]
  const next = random(seed)
  const small = shape.files - shape.largeFiles
  const average = (shape.rows - shape.largeFiles * shape.largeRows) / small
  // Large files spread through the list rather than bunched at one end.
  const large = new Set(Array.from({ length: shape.largeFiles }, (_, index) => Math.floor(((index + 0.5) * shape.files) / shape.largeFiles)))
  let threadsLeft = shape.threads
  let notesLeft = shape.notes
  for (let index = 0; index < shape.files; index++) {
    const filesLeft = shape.files - index
    const folder = `pkg-${String(index % 40).padStart(2, '0')}`
    const path = `src/${folder}/module-${String(index).padStart(4, '0')}.ts`
    // The large files stay plain modifications, so every profile has several very large patches.
    const kind = large.has(index) ? 'modified'
      : index % 53 === 7 ? 'binary' : index % 61 === 11 ? 'renamed' : index % 67 === 13 ? 'added' : index % 71 === 17 ? 'removed' : 'modified'

    if (kind === 'binary') {
      const bytes = (fill: number) => String.fromCharCode(0, 1, 2, fill, 0, 255, 0, fill).repeat(16)
      yield {
        path: `assets/${folder}/image-${String(index).padStart(4, '0')}.bin`,
        status: 'modified', additions: null, deletions: null, sha: null, viewed: false, patch: null,
        oldPath: null, base: bytes(3), head: bytes(4), binary: true, threads: [], notes: [], rows: 2,
      }
      continue
    }

    const target = large.has(index) ? shape.largeRows : Math.max(8, Math.round(average * (0.2 + next() * 1.6)))
    let ops = editScript(next, target, index)
    if (kind === 'added') ops = ops.filter((op) => op.kind !== '-').map((op) => ({ kind: '+', text: op.text }))
    if (kind === 'removed') ops = ops.filter((op) => op.kind !== '+').map((op) => ({ kind: '-', text: op.text }))
    const hunks = hunksOf(ops)
    const patch = patchOf(ops, hunks)
    const base = kind === 'added' ? null : `${ops.filter((op) => op.kind !== '+').map((op) => op.text).join('\n')}\n`
    const head = kind === 'removed' ? null : `${ops.filter((op) => op.kind !== '-').map((op) => op.text).join('\n')}\n`

    // Spread the dynamic blocks over the files that remain, a few more on the large ones.
    const threadCount = Math.min(threadsLeft, Math.ceil(threadsLeft / filesLeft) + (large.has(index) ? 2 : 0))
    threadsLeft -= threadCount
    const noteCount = Math.min(notesLeft, Math.ceil(notesLeft / filesLeft) + (large.has(index) ? 2 : 0))
    notesLeft -= noteCount

    const threads = anchorsIn(ops, hunks, threadCount).map(({ op, oldNo, newNo }, position): DiffThread => {
      const left = op.kind === '-'
      const comments = 1 + ((index + position) % 3)
      return {
        threadId: `thread-${index}-${position}`,
        path,
        line: left ? oldNo : newNo,
        side: left ? 'LEFT' : 'RIGHT',
        resolved: (index + position) % 4 === 0,
        comments: Array.from({ length: comments }, (_, at) => ({
          id: `comment-${index}-${position}-${at}`,
          databaseId: index * 1_000 + position * 10 + at,
          author: at % 2 ? 'reviewer' : 'author',
          body: BODIES[(index + position + at) % BODIES.length]!,
          createdAt: 1_700_000_000_000 + index * 1_000 + at,
        })),
      }
    })
    const notes = anchorsIn(ops, hunks, noteCount).map(({ op, oldNo, newNo }, position): LargeDiffNote => ({
      path,
      side: op.kind === '-' ? 'deletions' : 'additions',
      line: op.kind === '-' ? oldNo : newNo,
      snippet: op.text,
      body: position % 3 === 2 ? `Note ${position}: ${BODIES[0]} ${'This one wraps across the row. '.repeat(4)}` : `Note ${position}: check this line.`,
    }))

    yield {
      path,
      status: kind,
      additions: ops.filter((op) => op.kind === '+').length,
      deletions: ops.filter((op) => op.kind === '-').length,
      sha: head == null ? null : 'head',
      viewed: false,
      patch,
      oldPath: kind === 'renamed' ? `src/${folder}/previous-${String(index).padStart(4, '0')}.ts` : null,
      base,
      head,
      binary: false,
      threads,
      notes,
      rows: rowsOf(hunks),
    }
  }
}

/** FNV-1a over UTF-16 code units, folded into a running value. */
const fold = (hash: number, text: string): number => {
  let value = hash
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619) >>> 0
  return value
}

/** One profile's totals and a digest of every path, patch, anchor and identity in it, computed by
 *  streaming the files rather than holding them. */
export function largeDiffSummary(profile: LargeSurfaceProfile, seed = 1) {
  let files = 0
  let fixedRows = 0
  let threads = 0
  let notes = 0
  let hash = 2166136261
  for (const file of largeDiffFiles(profile, seed)) {
    files++
    fixedRows += file.rows
    threads += file.threads.length
    notes += file.notes.length
    hash = fold(fold(fold(hash, file.path), file.patch ?? ''), file.oldPath ?? '')
    for (const thread of file.threads) hash = fold(hash, `${thread.threadId}:${thread.side}:${thread.line}:${thread.comments.length}`)
    for (const note of file.notes) hash = fold(hash, `${note.side}:${note.line}:${note.body}`)
  }
  return { files, fixedRows, threads, notes, digest: hash.toString(16).padStart(8, '0') }
}

/**
 * A `DiffSource` over generated files, for rendering the real `DiffPane` in a test. It plays the
 * provider's part in-process: the topology and every segment are cut from the fixture's patches with
 * the same package the node routes use, and `loadSegments` and `search` answer from them. Threads are
 * the source's own; `lineExtra` draws each file's notes the way the Changes pane draws review notes.
 *
 * `onLoad` sees every segment request, which is how a test proves what the viewer asked for.
 * `delay` holds each answer back, for a test about what the viewer shows while it waits.
 */
export function largeDiffSource(files: readonly LargeDiffFile[], options: {
  scope?: string
  threads?: () => DiffThread[]
  onLoad?: (requests: DiffSegmentRequest[]) => void
  delay?: () => Promise<void>
} = {}): DiffSource {
  const documents = new Map(files.map((file) => [file.path, fileDocument(file.path, file.patch)]))
  const patchKeys = new Map(files.map((file) => [file.path, file.patch ? `fixture:${fold(2166136261, file.patch).toString(16)}` : null]))
  const topology = documentTopology(files.map((file): DiffDocumentFile => ({
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    sha: file.sha,
    viewed: file.viewed,
    patchKey: patchKeys.get(file.path) ?? null,
    segments: documents.get(file.path)!.descriptors,
  })))
  const byPath = new Map(files.map((file) => [file.path, file]))
  const allThreads = files.flatMap((file) => file.threads)
  const notesAt = new Map<string, LargeDiffNote[]>()
  for (const file of files) {
    for (const note of file.notes) {
      const key = `${note.path}:${note.side}:${note.line}`
      notesAt.set(key, [...(notesAt.get(key) ?? []), note])
    }
  }
  const anchors: DiffLineAnchor[] = files.flatMap((file) => file.notes.map((note) => ({
    path: note.path, side: note.side === 'deletions' ? 'old' as const : 'new' as const, line: note.line,
  })))
  const notesFor = (row: { path: string; oldNo: number | null; newNo: number | null }) =>
    row.newNo != null ? notesAt.get(`${row.path}:additions:${row.newNo}`) : row.oldNo != null ? notesAt.get(`${row.path}:deletions:${row.oldNo}`) : undefined
  const scope = options.scope ?? 'large-diff'
  return {
    scope: { taskId: scope, routeKey: scope },
    topology: () => topology,
    loading: () => false,
    signature: () => topology.revision,
    selectedPath: () => '',
    threads: options.threads ?? (() => allThreads),
    loadSegments: async (requests) => {
      options.onLoad?.(requests)
      await options.delay?.()
      return requests.flatMap((request): DiffSegmentPayload[] => {
        const rows = patchKeys.get(request.path) === request.patchKey ? documents.get(request.path)?.segments[request.ordinal] : undefined
        return rows ? [{ ...request, rows }] : []
      })
    },
    search: async (request) => (await searchDocument(
      topology.files,
      async (file) => documents.get(file.path)?.segments ?? [],
      request,
    )) ?? { matches: [], nextCursor: null },
    fileText: async ({ path }) => byPath.get(path)?.head ?? '',
    canComment: () => false,
    invalidate: () => {},
    draftPrefix: scope,
    lineExtra: {
      anchors: () => anchors,
      render: (row) => (notesFor(row) ?? []).map((note) => note.body).join('\n'),
    },
    find: { commandId: `${scope}.find`, description: 'Find', category: 'navigation' },
  }
}

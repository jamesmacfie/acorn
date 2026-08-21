// The shared diff viewer's row model (see docs/diff-rendering.md for how GitHub and Changes each
// reach it and for the row types' structural contract).
import { diffWordsWithSpace } from 'diff'
import gitdiffParser from 'gitdiff-parser'
import { synth } from './synth'
import type { getHighlighter } from '../../highlight/shiki'
import { langFor } from '../../highlight/shiki'
// Type-only, so the worker client's module graph, including its dynamic `?worker` import, stays out
// of this module. Several plugin tests load it in a node environment where that import cannot
// resolve.
import type { TokenizeDocument } from '../../highlight/worker'

// The renderer's own input contract, structural rather than named after one producer. A PR file
// from github, an uncommitted hunk from changes, or a future producer all satisfy it without either
// side importing the other.
export type DiffFile = {
  path: string
  status: string | null
  additions: number | null
  deletions: number | null
  sha: string | null
  viewed: boolean
  patch: string | null
}

export type DiffThreadComment = {
  id: string
  databaseId: number | null
  author: string | null
  body: string | null
  createdAt: number | null
}

// An inline review conversation anchored to a line. `side` is the producer's own vocabulary; the
// renderer only groups by it.
export type DiffThread = {
  threadId: string
  path: string | null
  line: number | null
  side: string | null
  resolved: boolean
  comments: DiffThreadComment[]
}


export type Tok = { content: string; light: string; dark: string }
export type WordTok = { content: string; kind: 'eq' | 'add' | 'del' }
export type CodeRow = {
  kind: 'normal' | 'insert' | 'delete'
  path: string
  oldNo: number | null
  newNo: number | null
  toks: Tok[]
  raw: string
  words?: WordTok[]
}
export type HunkRow = { kind: 'hunk'; text: string }
export type FileRow = { kind: 'file'; file: DiffFile }
export type NoDiffRow = { kind: 'nodiff' }
export type LoadDiffStatus = 'loading' | 'error'
export type LoadDiffRow = { kind: 'load'; file: DiffFile; status: LoadDiffStatus }
export type ThreadRowT = { kind: 'thread'; thread: DiffThread }
// A run of unchanged lines hidden between/above/below hunks. oldNo/newNo advance in lockstep
// (unchanged context), so expansion just slices the head blob from newStart. count is null for the
// bottom gap; its size needs the file's total line count, known only once the body is fetched.
export type GapRow = {
  kind: 'gap'
  path: string
  sha: string | null
  side: 'top' | 'mid' | 'bottom'
  oldStart: number
  newStart: number
  count: number | null
}
export type Row = HunkRow | CodeRow | FileRow | NoDiffRow | LoadDiffRow | ThreadRowT | GapRow
export type DiffRow = HunkRow | CodeRow | GapRow | LoadDiffRow
export type ParsedFile = { file: DiffFile; diff: DiffRow[] }

export const gapId = (gap: Pick<GapRow, 'path' | 'side' | 'oldStart' | 'newStart'>) => `${gap.path}:${gap.side}:${gap.oldStart}:${gap.newStart}`

export type ViewMode = 'unified' | 'split'
export type SplitBand =
  | { kind: 'full'; row: HunkRow | FileRow | NoDiffRow | LoadDiffRow | ThreadRowT | GapRow }
  | { kind: 'pair'; left: CodeRow | null; right: CodeRow | null }

export type TokenizeLine = (path: string, content: string) => Tok[]

export const isCodeRow = (r: Row): r is CodeRow => r.kind === 'normal' || r.kind === 'insert' || r.kind === 'delete'
export const fileAnchor = (path: string) => `diff-file:${path}`

// Virtualizer size estimates per row kind. This is the single source for these numbers; DiffView's
// fallback estimate imports DIFF_LOAD_ROW_HEIGHT rather than redefining 36.
export const DIFF_LINE_HEIGHT = 20
export const DIFF_FILE_HEADER_HEIGHT = 36
export const DIFF_THREAD_HEIGHT = 140
export const DIFF_RESOLVED_THREAD_HEIGHT = 50
export const DIFF_LOAD_ROW_HEIGHT = 36
export const DIFF_GAP_ROW_HEIGHT = 28

export const estimateRowSize = (row: Row | undefined) => {
  if (!row) return DIFF_LINE_HEIGHT
  if (row.kind === 'file') return DIFF_FILE_HEADER_HEIGHT
  if (row.kind === 'thread') return row.thread.resolved ? DIFF_RESOLVED_THREAD_HEIGHT : DIFF_THREAD_HEIGHT
  if (row.kind === 'nodiff') return DIFF_GAP_ROW_HEIGHT
  if (row.kind === 'load') return DIFF_LOAD_ROW_HEIGHT
  if (row.kind === 'gap') return DIFF_GAP_ROW_HEIGHT
  return DIFF_LINE_HEIGHT
}

// Widest code line, in columns of 1ch (see docs/diff-rendering.md § Row geometry for why the row
// canvas has to be this wide rather than sized by layout).
//
// A tab advances to the next multiple of TAB_COLUMNS rather than counting as one, matching CSS
// tab-size's default. Counting it as one character under-measures indented code, and
// under-measuring is the failure that clips a line.
const TAB_COLUMNS = 8
export const maxLineCols = (rows: readonly Row[]) => {
  let widest = 0
  for (const row of rows) {
    if (!isCodeRow(row)) continue
    let cols = 0
    for (const ch of row.raw) cols = ch === '\t' ? (Math.floor(cols / TAB_COLUMNS) + 1) * TAB_COLUMNS : cols + 1
    if (cols > widest) widest = cols
  }
  return widest
}

export const estimateSplitBandSize = (band: SplitBand | undefined) => {
  if (!band) return DIFF_LINE_HEIGHT
  if (band.kind === 'full') return estimateRowSize(band.row)
  return Math.max(estimateRowSize(band.left ?? undefined), estimateRowSize(band.right ?? undefined))
}

const UNKNOWN_FILE_KEY = '<unknown>'

const countedKey = (base: string, counts: Map<string, number>) => {
  const count = counts.get(base) ?? 0
  counts.set(base, count + 1)
  return count === 0 ? base : `${base}:${count}`
}

const codeRowIdentity = (row: CodeRow) => `code:${row.path}:${row.kind}:${row.oldNo ?? ''}:${row.newNo ?? ''}`

const rowIdentityBase = (row: Row, currentFilePath: string) => {
  if (row.kind === 'file') return `file:${row.file.path}`
  if (row.kind === 'hunk') return `hunk:${currentFilePath}:${row.text}`
  if (row.kind === 'gap') return `gap:${gapId(row)}`
  if (row.kind === 'load') return `load:${row.file.path}:${row.status}`
  if (row.kind === 'nodiff') return `nodiff:${currentFilePath}`
  if (row.kind === 'thread') return `thread:${row.thread.threadId}`
  return codeRowIdentity(row)
}

export function rowIdentityKeys(rows: readonly Row[]): string[] {
  const counts = new Map<string, number>()
  let currentFilePath = UNKNOWN_FILE_KEY
  return rows.map((row) => {
    if (row.kind === 'file') currentFilePath = row.file.path
    return countedKey(rowIdentityBase(row, currentFilePath), counts)
  })
}

export function splitBandIdentityKeys(bands: readonly SplitBand[]): string[] {
  const counts = new Map<string, number>()
  let currentFilePath = UNKNOWN_FILE_KEY
  return bands.map((band) => {
    let base: string
    if (band.kind === 'full') {
      if (band.row.kind === 'file') currentFilePath = band.row.file.path
      base = `full:${rowIdentityBase(band.row, currentFilePath)}`
    } else {
      base = `pair:${band.left ? codeRowIdentity(band.left) : 'empty'}:${band.right ? codeRowIdentity(band.right) : 'empty'}`
    }
    return countedKey(base, counts)
  })
}

export const plainTokenize: TokenizeLine = (_path, content) => [{ content, light: '', dark: '' }]

export function highlighterTokenize(hl: Awaited<ReturnType<typeof getHighlighter>>): TokenizeLine {
  return (path, content) => {
    const lang = langFor(path)
    if (lang === 'text') return plainTokenize(path, content)
    const [line] = hl.codeToTokensWithThemes(content, { lang: lang as never, themes: { light: 'github-light', dark: 'github-dark' } })
    return (line ?? []).map((t) => ({ content: t.content, light: t.variants.light.color ?? '', dark: t.variants.dark.color ?? '' }))
  }
}

export function wordDiff(oldText: string, newText: string): { del: WordTok[]; add: WordTok[] } {
  const parts = diffWordsWithSpace(oldText, newText)
  const del: WordTok[] = []
  const add: WordTok[] = []
  for (const p of parts) {
    if (p.added) add.push({ content: p.value, kind: 'add' })
    else if (p.removed) del.push({ content: p.value, kind: 'del' })
    else {
      del.push({ content: p.value, kind: 'eq' })
      add.push({ content: p.value, kind: 'eq' })
    }
  }
  return { del, add }
}

function rawPatchRows(file: DiffFile, tokenize: TokenizeLine): DiffRow[] {
  const rows: DiffRow[] = []
  for (const line of (file.patch ?? '').split('\n')) {
    if (line.startsWith('@@')) {
      rows.push({ kind: 'hunk', text: line })
    } else if (line.startsWith('+')) {
      const raw = line.slice(1)
      rows.push({ kind: 'insert', path: file.path, oldNo: null, newNo: null, toks: tokenize(file.path, raw), raw })
    } else if (line.startsWith('-')) {
      const raw = line.slice(1)
      rows.push({ kind: 'delete', path: file.path, oldNo: null, newNo: null, toks: tokenize(file.path, raw), raw })
    } else {
      const raw = line.startsWith(' ') ? line.slice(1) : line
      rows.push({ kind: 'normal', path: file.path, oldNo: null, newNo: null, toks: tokenize(file.path, raw), raw })
    }
  }
  return rows
}

// One tokenizable document: the lines of one side of one hunk, and the rows they belong to.
//
// A hunk interleaves two documents. A deleted line belongs to the pre-image, an inserted line to
// the post-image, an unchanged line to both. Tokenizing them in display order would feed the
// grammar a text that never existed: a deleted `*/` would close a comment for the inserted lines
// below it. So the two sides are gathered separately and each is tokenized as its own document.
//
// Context lines are in both batches, because they carry grammar state to the deletions on one side
// and the insertions on the other; leaving them out of either would put that side's changed lines
// back on a cold start. Their row appears as a target twice, and the second assignment wins. The
// two sides agree on the text by definition, so this is safe.
type TokenBatch = { code: string; targets: CodeRow[] }

// The structure of a patch, with the tokens still missing. Split out because the two fill
// strategies, per line on the main thread and per hunk-side in the worker, differ only in how
// `batches` is consumed, and the hunk walk below is not worth having twice.
function buildRowSkeleton(file: DiffFile): { rows: DiffRow[]; batches: TokenBatch[] } | null {
  let parsed: ReturnType<typeof gitdiffParser.parse>
  try {
    parsed = gitdiffParser.parse(synth(file.path, file.patch ?? ''))
  } catch {
    return null
  }
  const hunks = parsed[0]?.hunks ?? []
  const out: DiffRow[] = []
  const batches: TokenBatch[] = []
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i]!
    // Gap before this hunk: top (above the first) or the span since the previous hunk's end.
    if (i === 0) {
      if (h.newStart > 1) out.push({ kind: 'gap', path: file.path, sha: file.sha, side: 'top', oldStart: 1, newStart: 1, count: h.newStart - 1 })
    } else {
      const prev = hunks[i - 1]!
      const prevOldEnd = prev.oldStart + prev.oldLines - 1
      const prevNewEnd = prev.newStart + prev.newLines - 1
      if (h.newStart - prevNewEnd > 1)
        out.push({ kind: 'gap', path: file.path, sha: file.sha, side: 'mid', oldStart: prevOldEnd + 1, newStart: prevNewEnd + 1, count: h.newStart - prevNewEnd - 1 })
    }
    out.push({ kind: 'hunk', text: h.content || `@@ -${h.oldStart} +${h.newStart} @@` })
    const oldSide: CodeRow[] = []
    const newSide: CodeRow[] = []
    for (const ch of h.changes) {
      let row: CodeRow
      if (ch.type === 'normal') {
        row = { kind: 'normal', path: file.path, oldNo: ch.oldLineNumber, newNo: ch.newLineNumber, toks: [], raw: ch.content }
        oldSide.push(row)
        newSide.push(row)
      } else if (ch.type === 'insert') {
        row = { kind: 'insert', path: file.path, oldNo: null, newNo: ch.lineNumber, toks: [], raw: ch.content }
        newSide.push(row)
      } else {
        row = { kind: 'delete', path: file.path, oldNo: ch.lineNumber, newNo: null, toks: [], raw: ch.content }
        oldSide.push(row)
      }
      out.push(row)
    }
    // Old side first so the shared context rows end up carrying the post-image's colours, which is
    // the file as it now stands and the side a reader is looking at.
    for (const side of [oldSide, newSide]) {
      if (side.length) batches.push({ code: side.map((r) => r.raw).join('\n'), targets: side })
    }
  }
  if (out.length === 0) return null
  // Bottom gap: lines after the last hunk to end-of-file. Size is unknown until the body is fetched
  // (count: null); on expand it collapses to nothing if the hunk already reached EOF.
  const last = hunks[hunks.length - 1]
  if (last) out.push({ kind: 'gap', path: file.path, sha: file.sha, side: 'bottom', oldStart: last.oldStart + last.oldLines, newStart: last.newStart + last.newLines, count: null })
  return { rows: out, batches }
}

export function buildDiffRows(file: DiffFile, tokenize: TokenizeLine): DiffRow[] {
  if (!file.patch) return []
  const built = buildRowSkeleton(file)
  if (!built) return rawPatchRows(file, tokenize)
  for (const batch of built.batches) {
    for (const row of batch.targets) row.toks = tokenize(row.path, row.raw)
  }
  attachWordDiffs(built.rows)
  return built.rows
}

/**
 * The same rows, tokenized a document at a time instead of a line at a time.
 *
 * This is the path the app uses. It is what makes the worker worth having, one message per
 * hunk-side rather than per line (see highlight/worker.ts), and it is what makes multi-line
 * constructs colour correctly, because shiki carries grammar state across the lines of a single
 * call.
 *
 * Never rejects: tokenizeDocument degrades to plain text rather than throwing, and a patch that
 * will not parse falls back to the untokenized raw rows exactly as the sync path does.
 */
export async function buildDiffRowsAsync(file: DiffFile, tokenizeDoc: TokenizeDocument): Promise<DiffRow[]> {
  if (!file.patch) return []
  const built = buildRowSkeleton(file)
    // A patch this parser cannot read is a display problem, not a highlighting one. Show the raw
    // lines.
  if (!built) return rawPatchRows(file, plainTokenize)
  for (const batch of built.batches) {
    const lines = await tokenizeDoc(file.path, batch.code)
    for (let i = 0; i < batch.targets.length; i++) {
      const toks = lines[i]
      // A grammar that returned fewer lines than we sent (or nothing, on a fallback) leaves the row
      // showing its raw text rather than an empty one.
      batch.targets[i]!.toks = toks?.length ? toks : [{ content: batch.targets[i]!.raw, light: '', dark: '' }]
    }
  }
  attachWordDiffs(built.rows)
  return built.rows
}

// Slice the hidden lines for a gap out of the full head-file body and tokenize them. Unchanged
// context, so oldNo/newNo step together from the gap's start.
export function expandGap(gap: GapRow, body: string, tokenize: TokenizeLine): CodeRow[] {
  const rows = gapRows(gap, body)
  for (const row of rows) row.toks = tokenize(gap.path, row.raw)
  return rows
}

/**
 * As above, tokenized as one document so the revealed run colours consistently.
 *
 * The run still starts from a cold grammar state at its first line, because the lines above it were
 * never tokenized: this reveals a slice out of the middle of a file. Expanding into the top of a
 * block comment therefore still mis-colours until the expansion reaches line 1. Fixing it means
 * tokenizing the whole body and keeping the state, worth doing when someone complains about an
 * expanded gap specifically rather than on spec.
 */
export async function expandGapAsync(gap: GapRow, body: string, tokenizeDoc: TokenizeDocument): Promise<CodeRow[]> {
  const rows = gapRows(gap, body)
  if (!rows.length) return rows
  const lines = await tokenizeDoc(gap.path, rows.map((r) => r.raw).join('\n'))
  for (let i = 0; i < rows.length; i++) {
    const toks = lines[i]
    rows[i]!.toks = toks?.length ? toks : [{ content: rows[i]!.raw, light: '', dark: '' }]
  }
  return rows
}

/** The rows a gap reveals, untokenized. Unchanged context, so oldNo/newNo step together. */
function gapRows(gap: GapRow, body: string): CodeRow[] {
  const lines = body.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop() // drop one trailing newline
  const count = gap.count ?? lines.length - (gap.newStart - 1)
  const rows: CodeRow[] = []
  for (let k = 0; k < count; k++) {
    const raw = lines[gap.newStart - 1 + k]
    if (raw == null) break
    rows.push({ kind: 'normal', path: gap.path, oldNo: gap.oldStart + k, newNo: gap.newStart + k, toks: [], raw })
  }
  return rows
}

export function buildRenderableRows(parsed: ParsedFile[], threads: DiffThread[] | undefined, expanded?: Map<string, CodeRow[]>, collapsed?: Set<string>): Row[] {
  const threadsByPath = new Map<string, DiffThread[]>()
  for (const thread of threads ?? []) {
    if (!thread.path) continue
    const bucket = threadsByPath.get(thread.path)
    if (bucket) bucket.push(thread)
    else threadsByPath.set(thread.path, [thread])
  }

  const out: Row[] = []
  for (const { file, diff } of parsed) {
    out.push({ kind: 'file', file })
    if (collapsed?.has(file.path)) continue
    const fileThreads = threadsByPath.get(file.path) ?? []
    for (const row of diff) {
      // An expanded gap is replaced by its revealed context lines (whole-gap expand).
      if (row.kind === 'gap') {
        const lines = expanded?.get(gapId(row))
        if (lines) {
          for (const line of lines) pushCodeRow(out, line, fileThreads)
        } else {
          out.push(row)
        }
        continue
      }
      if (row.kind === 'hunk' || row.kind === 'load') out.push(row)
      else pushCodeRow(out, row, fileThreads)
    }
    if (diff.length === 0) out.push({ kind: 'nodiff' })
  }
  return out
}

function pushCodeRow(out: Row[], row: CodeRow, fileThreads: DiffThread[]) {
  out.push(row)
  for (const thread of fileThreads) {
    const onRight = thread.side === 'RIGHT' || thread.side == null
    const anchor = onRight ? row.newNo : row.oldNo
    if (anchor != null && anchor === thread.line) out.push({ kind: 'thread', thread })
  }
}

export function attachWordDiffs(rows: DiffRow[]) {
  let i = 0
  while (i < rows.length) {
    if (rows[i]!.kind !== 'delete') {
      i++
      continue
    }
    let d = i
    while (d < rows.length && rows[d]!.kind === 'delete') d++
    let n = d
    while (n < rows.length && rows[n]!.kind === 'insert') n++
    const dels = rows.slice(i, d) as CodeRow[]
    const inss = rows.slice(d, n) as CodeRow[]
    const pairs = Math.min(dels.length, inss.length)
    for (let k = 0; k < pairs; k++) {
      const { del, add } = wordDiff(dels[k]!.raw, inss[k]!.raw)
      dels[k]!.words = del
      inss[k]!.words = add
    }
    i = n > i ? n : i + 1
  }
}

export function toBands(rows: Row[]): SplitBand[] {
  const out: SplitBand[] = []
  let i = 0
  while (i < rows.length) {
    const row = rows[i]!
    if (row.kind === 'hunk' || row.kind === 'thread' || row.kind === 'file' || row.kind === 'nodiff' || row.kind === 'load' || row.kind === 'gap') {
      out.push({ kind: 'full', row })
      i++
      continue
    }
    if (row.kind === 'normal') {
      out.push({ kind: 'pair', left: row, right: row })
      i++
      continue
    }
    if (row.kind === 'delete') {
      let d = i
      while (d < rows.length && rows[d]!.kind === 'delete') d++
      let n = d
      while (n < rows.length && rows[n]!.kind === 'insert') n++
      const dels = rows.slice(i, d) as CodeRow[]
      const inss = rows.slice(d, n) as CodeRow[]
      const max = Math.max(dels.length, inss.length)
      for (let k = 0; k < max; k++) out.push({ kind: 'pair', left: dels[k] ?? null, right: inss[k] ?? null })
      i = n
      continue
    }
    let n = i
    while (n < rows.length && rows[n]!.kind === 'insert') n++
    for (const ins of rows.slice(i, n) as CodeRow[]) out.push({ kind: 'pair', left: null, right: ins })
    i = n
  }
  return out
}

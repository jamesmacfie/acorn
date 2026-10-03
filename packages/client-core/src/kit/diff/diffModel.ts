// The shared diff viewer's row model (see docs/diff-rendering.md for how GitHub and Changes each
// reach it and for the row types' structural contract).
import { lineColumns, parsePatch, type PlainDiffRow } from '@acorn/diff-document/document'
import { wordDiff, type DiffWordsDocument, type WordDiffInput, type WordDiffOutput, type WordTok } from './wordDiff'
import type { getHighlighter } from '../../infra/highlight/shiki'
// From `langs.ts` rather than from `shiki.ts`, which re-exports it: the re-export is a value import
// and pulls the main-thread highlighter and its regex engine into every graph this module is in.
// `highlighter.worker.ts` splits the vocabulary out for the same reason, and the terminal host is the
// second caller that wants the row model and has no use for shiki at all.
import { langFor } from '../../infra/highlight/langs'
// Type-only, so the worker client's module graph, including its dynamic `?worker` import, stays out
// of this module. Several plugin tests load it in a node environment where that import cannot
// resolve.
import type { TokenizeDocument } from '../../infra/highlight/worker'

// The renderer's own input contract, structural rather than named after one producer, so a PR file
// from github and an uncommitted hunk from changes both satisfy it without either side importing
// the other.
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
export type { WordTok } from './wordDiff'
export { wordDiff } from './wordDiff'
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

// Fixed row heights, and the single source for these numbers (docs/diff-rendering/geometry.md § Row geometry).
export const DIFF_LINE_HEIGHT = 20
export const DIFF_FILE_HEADER_HEIGHT = 36
export const DIFF_THREAD_HEIGHT = 140
export const DIFF_RESOLVED_THREAD_HEIGHT = 50
export const DIFF_GAP_ROW_HEIGHT = 28

// Widest code line, in columns of 1ch (see docs/diff-rendering/geometry.md § Row geometry for why the row
// canvas has to be this wide rather than sized by layout). Tabs advance to the next stop
// (@acorn/diff-document § lineColumns).
export const maxLineCols = (rows: readonly Row[]) => {
  let widest = 0
  for (const row of rows) if (isCodeRow(row)) widest = Math.max(widest, lineColumns(row.raw))
  return widest
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

export const plainTokenize: TokenizeLine = (_path, content) => [{ content, light: '', dark: '' }]

export function highlighterTokenize(hl: Awaited<ReturnType<typeof getHighlighter>>): TokenizeLine {
  return (path, content) => {
    const lang = langFor(path)
    if (lang === 'text') return plainTokenize(path, content)
    const [line] = hl.codeToTokensWithThemes(content, { lang: lang as never, themes: { light: 'github-light', dark: 'github-dark' } })
    return (line ?? []).map((t) => ({ content: t.content, light: t.variants.light.color ?? '', dark: t.variants.dark.color ?? '' }))
  }
}

/**
 * Plain rows as the renderer's rows: the path and the new-side key put back, and every code line
 * showing its raw text until enrichment colours it. This is what a loaded segment paints first
 * (docs/diff-rendering/loading.md § Parsing and highlighting).
 */
export function diffRowsFromPlain(path: string, sha: string | null, plain: readonly PlainDiffRow[]): DiffRow[] {
  return plain.map((row): DiffRow => {
    if (row.kind === 'hunk') return { kind: 'hunk', text: row.text }
    if (row.kind === 'gap') return { ...row, path, sha }
    return { kind: row.kind, path, oldNo: row.oldNo, newNo: row.newNo, raw: row.raw, toks: [{ content: row.raw, light: '', dark: '' }] }
  })
}

// One tokenizable document: the lines of one side of one hunk, and the rows they belong to.
//
// A hunk interleaves two documents. A deleted line belongs to the pre-image, an inserted line to
// the post-image, an unchanged line to both. Tokenizing them in display order would feed the
// grammar a text that never existed, where a deleted `*/` closes a comment for the inserted lines
// below it. So each side is gathered and tokenized as its own document.
//
// Context lines go in both batches, because they carry grammar state to the deletions on one side
// and the insertions on the other. Their row appears as a target twice and the second assignment
// wins, which is safe because the two sides agree on the text by definition. Old side first, so the
// shared context rows end up carrying the post-image's colours, the file as it now stands.
//
// Rows with no line numbers are a patch the parser could not read, shown as its raw lines, and are
// left plain: colouring text that is not the file would be guessing.
type TokenBatch = { code: string; targets: CodeRow[] }

function tokenBatches(rows: readonly DiffRow[]): TokenBatch[] {
  const batches: TokenBatch[] = []
  let oldSide: CodeRow[] = []
  let newSide: CodeRow[] = []
  const close = () => {
    for (const side of [oldSide, newSide]) {
      if (side.length) batches.push({ code: side.map((row) => row.raw).join('\n'), targets: side })
    }
    oldSide = []
    newSide = []
  }
  for (const row of rows) {
    if (!isCodeRow(row)) {
      close()
      continue
    }
    if (row.oldNo == null && row.newNo == null) continue
    if (row.kind !== 'insert') oldSide.push(row)
    if (row.kind !== 'delete') newSide.push(row)
  }
  close()
  return batches
}

/** One file's rows from its whole patch, tokenized a line at a time. A bounded builder for surfaces
 *  that draw one small patch, and for tests; the viewer builds rows per segment instead. */
export function buildDiffRows(file: DiffFile, tokenize: TokenizeLine): DiffRow[] {
  const rows = diffRowsFromPlain(file.path, file.sha, parsePatch(file.path, file.patch))
  for (const row of rows) if (isCodeRow(row)) row.toks = tokenize(row.path, row.raw)
  attachWordDiffs(rows)
  return rows
}

/**
 * The same rows, tokenized a document at a time instead of a line at a time: one message per
 * hunk-side rather than per line (see highlight/worker.ts), which is also what colours multi-line
 * constructs correctly, because shiki carries grammar state across the lines of a single call.
 *
 * Never rejects. tokenizeDocument degrades to plain text rather than throwing.
 */
export async function buildDiffRowsAsync(
  file: DiffFile,
  tokenizeDoc: TokenizeDocument,
  diffWords?: DiffWordsDocument,
): Promise<DiffRow[]> {
  return enrichDiffRows(diffRowsFromPlain(file.path, file.sha, parsePatch(file.path, file.patch)), tokenizeDoc, diffWords)
}

/**
 * Colour rows that are already on screen: syntax tokens per hunk-side and word spans per paired
 * change. Answers new row objects and leaves the ones passed in alone, so a caller holding the plain
 * rows can swap the enriched ones in under the same index without a row ever showing half of each.
 *
 * Never rejects. A tokenizer that fails answers plain text, and a grammar that returns fewer lines
 * than it was sent leaves those rows with their raw text rather than empty.
 */
export async function enrichDiffRows(rows: readonly DiffRow[], tokenizeDoc: TokenizeDocument, diffWords?: DiffWordsDocument): Promise<DiffRow[]> {
  const out = rows.map((row) => (isCodeRow(row) ? { ...row } : row))
  for (const batch of tokenBatches(out)) {
    const path = batch.targets[0]!.path
    const lines = await tokenizeDoc(path, batch.code)
    for (let i = 0; i < batch.targets.length; i++) {
      const toks = lines[i]
      batch.targets[i]!.toks = toks?.length ? toks : [{ content: batch.targets[i]!.raw, light: '', dark: '' }]
    }
  }
  if (diffWords) await attachWordDiffsAsync(out, diffWords)
  else attachWordDiffs(out)
  return out
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
 * The run starts from a cold grammar state at its first line, because this reveals a slice out of
 * the middle of a file. Expanding into the top of a block comment mis-colours until the expansion
 * reaches line 1. Fixing that means tokenizing the whole body and keeping the state.
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
  const targets = wordDiffTargets(rows)
  for (const target of targets) applyWordDiff(target, wordDiff(target.input.oldText, target.input.newText))
}

type WordDiffTarget = { input: WordDiffInput; deleted: CodeRow; inserted: CodeRow }

function wordDiffTargets(rows: DiffRow[]): WordDiffTarget[] {
  const targets: WordDiffTarget[] = []
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
      targets.push({
        input: { oldText: dels[k]!.raw, newText: inss[k]!.raw },
        deleted: dels[k]!,
        inserted: inss[k]!,
      })
    }
    i = n > i ? n : i + 1
  }
  return targets
}

function applyWordDiff(target: WordDiffTarget, result: WordDiffOutput) {
  target.deleted.words = result.del
  target.inserted.words = result.add
}

async function attachWordDiffsAsync(rows: DiffRow[], diffWords: DiffWordsDocument) {
  const targets = wordDiffTargets(rows)
  const results = await diffWords(targets.map((target) => target.input))
  for (let i = 0; i < targets.length; i++) {
    const result = results[i]
    if (result) applyWordDiff(targets[i]!, result)
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

import { diffWordsWithSpace } from 'diff'
import gitdiffParser from 'gitdiff-parser'
import { synth } from '../../diff'
import type { getHighlighter } from '../../shiki'
import { langFor } from '../../shiki'
import type { PullFile, Thread } from '../../queries'

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
export type FileRow = { kind: 'file'; file: PullFile }
export type NoDiffRow = { kind: 'nodiff' }
export type LoadDiffStatus = 'loading' | 'error'
export type LoadDiffRow = { kind: 'load'; file: PullFile; status: LoadDiffStatus }
export type ThreadRowT = { kind: 'thread'; thread: Thread }
// A run of unchanged lines hidden between/above/below hunks. oldNo/newNo advance in lockstep
// (unchanged context), so expansion just slices the head blob from newStart. count is null for the
// bottom gap — its size needs the file's total line count, known only once the body is fetched.
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
export type ParsedFile = { file: PullFile; diff: DiffRow[] }

export const gapId = (gap: Pick<GapRow, 'path' | 'side' | 'oldStart' | 'newStart'>) => `${gap.path}:${gap.side}:${gap.oldStart}:${gap.newStart}`

export type ViewMode = 'unified' | 'split'
export type SplitBand =
  | { kind: 'full'; row: HunkRow | FileRow | NoDiffRow | LoadDiffRow | ThreadRowT | GapRow }
  | { kind: 'pair'; left: CodeRow | null; right: CodeRow | null }

export type TokenizeLine = (path: string, content: string) => Tok[]

export const isCodeRow = (r: Row): r is CodeRow => r.kind === 'normal' || r.kind === 'insert' || r.kind === 'delete'
export const fileAnchor = (path: string) => `diff-file:${path}`

// Virtualizer size estimates per row kind — the single source for these numbers (DiffView's
// fallback estimate imports DIFF_LOAD_ROW_HEIGHT rather than redefining 36).
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

function rawPatchRows(file: PullFile, tokenize: TokenizeLine): DiffRow[] {
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

export function buildDiffRows(file: PullFile, tokenize: TokenizeLine): DiffRow[] {
  if (!file.patch) return []
  let parsed: ReturnType<typeof gitdiffParser.parse>
  try {
    parsed = gitdiffParser.parse(synth(file.path, file.patch))
  } catch {
    return rawPatchRows(file, tokenize)
  }
  const hunks = parsed[0]?.hunks ?? []
  const out: DiffRow[] = []
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
    for (const ch of h.changes) {
      if (ch.type === 'normal') {
        out.push({
          kind: 'normal',
          path: file.path,
          oldNo: ch.oldLineNumber,
          newNo: ch.newLineNumber,
          toks: tokenize(file.path, ch.content),
          raw: ch.content,
        })
      } else if (ch.type === 'insert') {
        out.push({ kind: 'insert', path: file.path, oldNo: null, newNo: ch.lineNumber, toks: tokenize(file.path, ch.content), raw: ch.content })
      } else {
        out.push({ kind: 'delete', path: file.path, oldNo: ch.lineNumber, newNo: null, toks: tokenize(file.path, ch.content), raw: ch.content })
      }
    }
  }
  if (out.length === 0) return rawPatchRows(file, tokenize)
  // Bottom gap: lines after the last hunk to end-of-file. Size is unknown until the body is fetched
  // (count: null); on expand it collapses to nothing if the hunk already reached EOF.
  const last = hunks[hunks.length - 1]
  if (last) out.push({ kind: 'gap', path: file.path, sha: file.sha, side: 'bottom', oldStart: last.oldStart + last.oldLines, newStart: last.newStart + last.newLines, count: null })
  attachWordDiffs(out)
  return out
}

// Slice the hidden lines for a gap out of the full head-file body and tokenize them. Unchanged
// context, so oldNo/newNo step together from the gap's start.
export function expandGap(gap: GapRow, body: string, tokenize: TokenizeLine): CodeRow[] {
  const lines = body.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop() // ponytail: drop one trailing newline, fine for text
  const count = gap.count ?? lines.length - (gap.newStart - 1)
  const rows: CodeRow[] = []
  for (let k = 0; k < count; k++) {
    const raw = lines[gap.newStart - 1 + k]
    if (raw == null) break
    rows.push({ kind: 'normal', path: gap.path, oldNo: gap.oldStart + k, newNo: gap.newStart + k, toks: tokenize(gap.path, raw), raw })
  }
  return rows
}

export function buildRenderableRows(parsed: ParsedFile[], threads: Thread[] | undefined, expanded?: Map<string, CodeRow[]>): Row[] {
  const threadsByPath = new Map<string, Thread[]>()
  for (const thread of threads ?? []) {
    if (!thread.path) continue
    const bucket = threadsByPath.get(thread.path)
    if (bucket) bucket.push(thread)
    else threadsByPath.set(thread.path, [thread])
  }

  const out: Row[] = []
  for (const { file, diff } of parsed) {
    out.push({ kind: 'file', file })
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

function pushCodeRow(out: Row[], row: CodeRow, fileThreads: Thread[]) {
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

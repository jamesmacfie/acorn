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
export type ThreadRowT = { kind: 'thread'; thread: Thread }
export type Row = HunkRow | CodeRow | FileRow | NoDiffRow | ThreadRowT
export type DiffRow = HunkRow | CodeRow
export type ParsedFile = { file: PullFile; diff: DiffRow[] }

export type ViewMode = 'unified' | 'split'
export type SplitBand =
  | { kind: 'full'; row: HunkRow | FileRow | NoDiffRow | ThreadRowT }
  | { kind: 'pair'; left: CodeRow | null; right: CodeRow | null }

export type TokenizeLine = (path: string, content: string) => Tok[]

export const isCodeRow = (r: Row): r is CodeRow => r.kind === 'normal' || r.kind === 'insert' || r.kind === 'delete'
export const fileAnchor = (path: string) => `diff-file:${path}`

const DIFF_LINE_HEIGHT = 20
const DIFF_FILE_HEADER_HEIGHT = 36

export const estimateRowSize = (row: Row | undefined) => {
  if (!row) return DIFF_LINE_HEIGHT
  if (row.kind === 'file') return DIFF_FILE_HEADER_HEIGHT
  if (row.kind === 'thread') return 140
  if (row.kind === 'nodiff') return 28
  return DIFF_LINE_HEIGHT
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
  for (const h of hunks) {
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
  attachWordDiffs(out)
  return out
}

export function buildRenderableRows(parsed: ParsedFile[], threads: Thread[] | undefined): Row[] {
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
      out.push(row)
      if (row.kind === 'hunk') continue
      for (const thread of fileThreads) {
        const onRight = thread.side === 'RIGHT' || thread.side == null
        const anchor = onRight ? row.newNo : row.oldNo
        if (anchor != null && anchor === thread.line) out.push({ kind: 'thread', thread })
      }
    }
    if (diff.length === 0) out.push({ kind: 'nodiff' })
  }
  return out
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
    if (row.kind === 'hunk' || row.kind === 'thread' || row.kind === 'file' || row.kind === 'nodiff') {
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

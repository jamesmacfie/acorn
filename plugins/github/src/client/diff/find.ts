import { isCodeRow, type CodeRow, type Row } from './model'

// In-diff find (⌘F). The diff list is virtualized, so off-screen lines aren't in the DOM and the
// browser/Electron native find can't see them. Instead we search the row *model* (every code row's
// raw text), scroll the virtualizer to matches, and split tokens so the matched substring gets a
// highlight class while keeping its syntax colour — like Monaco's in-file find.

export type FindMatch = { row: CodeRow; rowIndex: number; start: number; end: number }
export type FindHighlight = { ranges: [number, number][]; current: [number, number] | null }

// Every occurrence of `query` across the code rows. Occurrences within a line never overlap (we
// advance past each hit), so a row's ranges stay sorted — markTokens relies on that.
export function collectMatches(rows: Row[], query: string, caseSensitive: boolean): FindMatch[] {
  if (!query) return []
  const needle = caseSensitive ? query : query.toLowerCase()
  const out: FindMatch[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (!isCodeRow(row)) continue
    const hay = caseSensitive ? row.raw : row.raw.toLowerCase()
    let from = 0
    for (;;) {
      const at = hay.indexOf(needle, from)
      if (at < 0) break
      out.push({ row, rowIndex: i, start: at, end: at + needle.length })
      from = at + needle.length
    }
  }
  return out
}

export type MarkedTok<T> = T & { mark: 0 | 1 | 2 }

// Split tokens at match boundaries so matched substrings can be wrapped separately. Tokens'
// contents concatenate back to the line's raw text (both the syntax `toks` and word-diff tokens),
// so char offsets from collectMatches line up. mark: 0 none, 1 hit, 2 current. `ranges` must be
// sorted and non-overlapping.
export function markTokens<T extends { content: string }>(
  toks: T[],
  ranges: [number, number][],
  current: [number, number] | null,
): MarkedTok<T>[] {
  const out: MarkedTok<T>[] = []
  let pos = 0
  for (const tok of toks) {
    const s = pos
    const e = pos + tok.content.length
    let cursor = s
    for (const [rs, re] of ranges) {
      if (re <= s || rs >= e) continue
      const a = Math.max(rs, s)
      const b = Math.min(re, e)
      if (a > cursor) out.push({ ...tok, content: tok.content.slice(cursor - s, a - s), mark: 0 })
      const isCurrent = current != null && rs === current[0] && re === current[1]
      out.push({ ...tok, content: tok.content.slice(a - s, b - s), mark: isCurrent ? 2 : 1 })
      cursor = b
    }
    if (cursor < e) out.push({ ...tok, content: tok.content.slice(cursor - s), mark: 0 })
    pos = e
  }
  return out
}

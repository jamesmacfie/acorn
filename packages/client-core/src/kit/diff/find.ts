// The drawing half of in-diff find (Cmd+F). The source searches the document and answers matches by
// segment and row (features/diff/findController.ts); this splits a row's tokens so the matched
// substring gets a highlight class while keeping its syntax colour, like an editor's in-file find.

export type FindHighlight = { ranges: [number, number][]; current: [number, number] | null }

export type MarkedTok<T> = T & { mark: 0 | 1 | 2 }

// Split tokens at match boundaries so matched substrings can be wrapped separately. Token contents
// concatenate back to the line's raw text, for both the syntax `toks` and word-diff tokens, so char
// offsets from a search match line up. mark is 0 for none, 1 for a hit, 2 for the current one. `ranges`
// must be sorted and non-overlapping.
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

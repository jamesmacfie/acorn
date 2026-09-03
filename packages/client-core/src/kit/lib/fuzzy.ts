// The subsequence scorer the whole product ranks lists with.
//
// It was `paletteModel.ts` until 2026-09-03, and it held two more things: a flat `PaletteItem` union
// and the concatenate-then-filter pair both hosts drew the palette with. The session owns the order
// and the ranking now, because a frame stack cannot be expressed as one concatenation
// (../../host/registries/commands/session.ts), and the union described a row shape nothing produces
// any more.
//
// What is left is spent everywhere: the command graph ranks a command with it, the session ranks a
// search result with it, and four pickers outside the palette reach it through
// `@acorn/plugin-api/client`.

/** Subsequence fuzzy match; contiguous runs and word-start hits score higher. Empty query → `0`, so
 *  everything matches and the caller's own order survives. `null` means no match at all. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  let score = 0
  let ti = 0
  let lastHit = -2
  for (const ch of q) {
    let found = -1
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i
        break
      }
    }
    if (found < 0) return null
    score += found === lastHit + 1 ? 3 : found === 0 || /[\s:./-]/.test(t[found - 1] ?? '') ? 2 : 1
    lastHit = found
    ti = found + 1
  }
  return score
}

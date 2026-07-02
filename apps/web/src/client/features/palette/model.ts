// Command palette model (docs/next 13 §D): pure item-source composition + fuzzy filter, unit
// tested; the ⌘K overlay component is thin glue over this.

export type PaletteItem =
  | { kind: 'run'; id: string; label: string; hint: string; running: boolean }
  | { kind: 'layout'; id: string; label: string; hint: string }
  | { kind: 'action'; id: string; label: string; hint?: string }
  | { kind: 'error'; id: string; label: string } // config parse errors (13 §B) — visible, not invocable

export type PaletteSources = {
  targets: { id: string; command: string; running: boolean }[]
  layouts?: { id: string }[]
  errors: { source: string; message: string }[]
  actions: { id: string; label: string; hint?: string }[]
}

// Errors first (they explain why a target might be missing), then run targets, layouts, actions.
export function composeItems(src: PaletteSources): PaletteItem[] {
  return [
    ...src.errors.map((e, i): PaletteItem => ({ kind: 'error', id: `error:${i}`, label: `config error (${e.source}): ${e.message}` })),
    ...src.targets.map((t): PaletteItem => ({ kind: 'run', id: `run:${t.id}`, label: `${t.running ? 'Stop' : 'Run'}: ${t.id}`, hint: t.command, running: t.running })),
    ...(src.layouts ?? []).map((l): PaletteItem => ({ kind: 'layout', id: `layout:${l.id}`, label: `Layout: ${l.id}`, hint: 'open panes + start target' })),
    ...src.actions.map((a): PaletteItem => ({ kind: 'action', id: a.id, label: a.label, hint: a.hint })),
  ]
}

// Subsequence fuzzy match; contiguous runs and word-start hits score higher. Empty query → all.
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

export function fuzzyFilter(items: PaletteItem[], query: string): PaletteItem[] {
  if (!query.trim()) return items
  return items
    .map((item) => ({ item, score: fuzzyScore(query.trim(), item.label) }))
    .filter((x): x is { item: PaletteItem; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item)
}

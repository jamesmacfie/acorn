// Command palette model (docs/command-palette-and-shortcuts.md): pure item-source composition + fuzzy filter, unit
// tested; the ⌘K overlay component is thin glue over this.

export type PaletteItem =
  | { kind: 'run'; id: string; label: string; hint: string; running: boolean }
  | { kind: 'layout'; id: string; label: string; hint: string }
  | { kind: 'workflow'; id: string; label: string; hint: string } // committed .acorn/workflows (14 P5)
  | { kind: 'task'; id: string; label: string; hint?: string } // Go to task (docs/command-palette-and-shortcuts.md)
  | { kind: 'workspace'; id: string; label: string; hint?: string } // Switch workspace (⌘L)
  | { kind: 'action'; id: string; label: string; hint?: string }
  // A row a third-party plugin's manifest declared (docs/plugins.md).
  // Its own kind rather than a reused one: `action`, `task` and `workspace` are intercepted by core's
  // dispatch, and this row has to reach its contributing source so the host can run its declared verb.
  | { kind: 'plugin'; id: string; label: string; hint?: string }
  | { kind: 'error'; id: string; label: string } // config parse errors (13 §B) — visible, not invocable

export type PaletteSources = {
  // Rows built by `paletteRows` contributions (registries/paletteRows.ts), already in source
  // order. This used to be three typed fields, `targets`, `layouts`, `workflows`, which meant core
  // knew what a run target and a workflow were, and adding a fourth kind of contributed row meant
  // editing this file.
  rows?: PaletteItem[]
  tasks?: { id: string; label: string; hint?: string }[]
  workspaces?: { id: string; label: string; hint?: string }[]
  errors: { source: string; message: string }[]
  actions: { id: string; label: string; hint?: string }[]
}

// Errors first: they explain why a row someone expected is missing, and that is a property of the
// whole list, so no single contributing source can produce it. Then contributed rows, then
// actions (panes/terminal/archive), then switch-workspace and Go-to-task last, since those are
// navigation, not commands.
export function composeItems(src: PaletteSources): PaletteItem[] {
  return [
    ...src.errors.map((e, i): PaletteItem => ({ kind: 'error', id: `error:${i}`, label: `config error (${e.source}): ${e.message}` })),
    ...(src.rows ?? []),
    ...src.actions.map((a): PaletteItem => ({ kind: 'action', id: a.id, label: a.label, hint: a.hint })),
    ...(src.workspaces ?? []).map((w): PaletteItem => ({ kind: 'workspace', id: `workspace:${w.id}`, label: w.label, hint: w.hint })),
    ...(src.tasks ?? []).map((t): PaletteItem => ({ kind: 'task', id: `task:${t.id}`, label: t.label, hint: t.hint })),
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

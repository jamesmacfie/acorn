// Pure workspace-tab logic — no Solid, no fetch — so it's unit-testable in plain Node.
export const PREFS_KEY = 'workspace:tabs'

export type Tab = { id: string; icon: string; path: string }
export type TabsState = { tabs: Tab[]; activeId: string }

// Generic glyphs that read on the flat monochrome rail; new tabs cycle through these.
export const GLYPHS = ['◆', '●', '■', '▲', '★', '✦', '❖', '◈', '⬟', '✚', '◇', '◉'] as const

export function serializeTabs(state: TabsState): string {
  return JSON.stringify(state)
}

// Parse a stored blob; returns null for missing/garbage/empty so the caller can fall back to a seed.
export function parseTabs(raw: string | undefined): TabsState | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object') return null
    const { tabs, activeId } = v as Partial<TabsState>
    if (!Array.isArray(tabs)) return null
    const clean = tabs.filter((t): t is Tab => !!t && typeof t.id === 'string' && typeof t.icon === 'string' && typeof t.path === 'string')
    if (clean.length === 0) return null
    const active = typeof activeId === 'string' && clean.some((t) => t.id === activeId) ? activeId : clean[0].id
    return { tabs: clean, activeId: active }
  } catch {
    return null
  }
}

// Write `path` into the active tab (returns the same reference if nothing changed).
export function withLocation(state: TabsState, path: string): TabsState {
  const active = state.tabs.find((t) => t.id === state.activeId)
  if (!active || active.path === path) return state
  return { ...state, tabs: state.tabs.map((t) => (t.id === state.activeId ? { ...t, path } : t)) }
}

export function newTab(id: string, path: string, index: number): Tab {
  return { id, icon: GLYPHS[index % GLYPHS.length], path }
}

// Pull owner/repo out of a tab's router path (`/owner/repo`, `/owner/repo/123`, `/owner/repo/new`,
// or `/`). Used to scope agent-activity indicators to the tab's repo.
export function repoOf(path: string): { owner?: string; repo?: string } {
  const [, owner, repo] = path.split('/')
  return { owner: owner || undefined, repo: repo || undefined }
}

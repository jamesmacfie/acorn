// Workspace tabs: a small user-scoped list persisted as a JSON blob in the `prefs` table
// (key `workspace:tabs`), reusing GET/PUT /api/prefs. Each tab remembers its full router path so
// switching tabs restores the exact repo/PR/diff you were on. Module-level signals match the
// codebase's signals-only style (no context provider). Pure logic lives in ./model.
import { createSignal } from 'solid-js'
import { setPref } from '../../mutations'
import { GLYPHS, newTab, PREFS_KEY, parseTabs, serializeTabs, type Tab, withLocation } from './model'

export { GLYPHS, PREFS_KEY, type Tab }

const [tabs, setTabs] = createSignal<Tab[]>([])
const [activeId, setActiveId] = createSignal<string>('')

export { activeId, tabs }

let seeded = false
let saveTimer: ReturnType<typeof setTimeout> | undefined

// ponytail: 400ms debounce; recordLocation fires on every navigation. Drop it if writes feel laggy.
function persist() {
  if (!seeded) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void setPref(PREFS_KEY, serializeTabs({ tabs: tabs(), activeId: activeId() })), 400)
}

// Seed once from the prefs blob; if absent/garbage, start with a single tab at the current path.
export function seedFromPrefs(raw: string | undefined, currentPath: string): void {
  if (seeded) return
  seeded = true
  const parsed = parseTabs(raw) ?? { tabs: [newTab(crypto.randomUUID(), currentPath, 0)], activeId: '' }
  if (!parsed.activeId) parsed.activeId = parsed.tabs[0].id
  setTabs(parsed.tabs)
  setActiveId(parsed.activeId)
}

export function selectTab(id: string): void {
  setActiveId(id)
  persist()
}

export function addTab(path = '/'): Tab {
  const tab = newTab(crypto.randomUUID(), path, tabs().length)
  setTabs([...tabs(), tab])
  setActiveId(tab.id)
  persist()
  return tab
}

export function setIcon(id: string, icon: string): void {
  setTabs(tabs().map((t) => (t.id === id ? { ...t, icon } : t)))
  persist()
}

// Always keep ≥1 tab; closing the active tab selects a neighbour.
export function removeTab(id: string): void {
  const list = tabs()
  if (list.length <= 1) return
  const idx = list.findIndex((t) => t.id === id)
  const next = list.filter((t) => t.id !== id)
  setTabs(next)
  if (activeId() === id) setActiveId((next[idx] ?? next[idx - 1] ?? next[0]).id)
  persist()
}

// Track navigation into the active tab so it restores where you were.
export function recordLocation(path: string): void {
  const current = { tabs: tabs(), activeId: activeId() }
  const updated = withLocation(current, path)
  if (updated === current) return
  setTabs(updated.tabs)
  persist()
}

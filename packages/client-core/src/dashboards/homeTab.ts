import { createSignal } from 'solid-js'
import { PrefKeys } from '../persistence/prefKeys'
import { appStateBinding, type PersistedStateSlice } from '../persistence/persistedState'
import { MAX_TABS, type DashboardTab } from './persist'

// The tab bar's own state and arithmetic. Everything a tab IS lives in `persist.ts`: a tab is the
// placement scope `home/<tabId>` and a name in the `tabs` list.
//
// Which tab is active is device view state (docs/dashboards.md § Placements): it never enters the
// node blob, unlike the composition it points into.
//
// Create, rename and reorder are all one write (`setHomeTabs`), so each verb only has to decide
// what list to hand over. That keeps the interesting part testable without a DOM; this suite
// renders no components.

const [activeHomeTab, setActiveHomeTab] = createSignal('')
export { activeHomeTab, setActiveHomeTab }

/** The grid Home draws is the tab bar's `tabpanel`. One id because Home has one grid. */
export const HOME_TAB_PANEL_ID = 'dash-home-panel'

/** `''` is the default tab, and an empty id fragment is not a DOM id. */
export const homeTabDomId = (tabId: string): string => `dash-home-tab-${tabId || 'default'}`

const NEW_TAB_NAME = 'New dashboard'

/** `New dashboard`, `New dashboard 2`, and so on, bounded by the tab cap, so there is always a free
 *  one. */
const uniqueName = (tabs: readonly DashboardTab[], base: string): string => {
  const taken = new Set(tabs.map((tab) => tab.name))
  const candidates = [base, ...Array.from({ length: MAX_TABS }, (_, index) => `${base} ${index + 2}`)]
  return candidates.find((name) => !taken.has(name)) ?? base
}

/** The list that creating a dashboard writes, plus the new tab's id (docs/dashboards.md §
 *  Placements: creating the first extra dashboard). */
export function addTab(tabs: readonly DashboardTab[], name = ''): { tabs: DashboardTab[]; id: string } {
  const base = tabs.length ? [...tabs] : [{ id: '', name: 'Home' }]
  const id = crypto.randomUUID().slice(0, 8)
  return { tabs: [...base, { id, name: uniqueName(base, name.trim() || NEW_TAB_NAME) }], id }
}

export const renameTab = (tabs: readonly DashboardTab[], id: string, name: string): DashboardTab[] =>
  tabs.map((tab) => (tab.id === id ? { ...tab, name } : tab))

/** Reorder as a swap with the neighbour, the menu-first form of drag and the only form. */
export function shiftTab(tabs: readonly DashboardTab[], id: string, delta: -1 | 1): DashboardTab[] {
  const next = [...tabs]
  const index = next.findIndex((tab) => tab.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export const homeTabSlice: PersistedStateSlice<string> = {
  id: 'core.home-tab',
  key: PrefKeys.homeTab,
  scope: 'app',
  restore: 'view',
  version: 1,
  codec: { parse: (raw) => (typeof raw === 'string' ? raw : ''), serialize: (value) => value },
  empty: () => '',
  // A remembered tab that has since been deleted falls back to the default tab rather than drawing
  // an empty grid (docs/dashboards.md § Placements).
  unknownIds: 'retain-inert',
  maxBytes: 128,
  binding: appStateBinding(activeHomeTab, setActiveHomeTab),
}

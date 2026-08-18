import { createSignal } from 'solid-js'
import { PrefKeys } from '../persistence/prefKeys'
import { appStateBinding, type PersistedStateSlice } from '../persistence/persistedState'
import { MAX_TABS, type DashboardTab } from './persist'

// The tab bar's own state and arithmetic (docs/future/dashboards/tabs.md § UX). Everything a tab IS
// lives in `persist.ts` — a tab is the placement scope `home/<tabId>` and a name in the `tabs` list.
// What is here is the two things that are NOT the model:
//
//   WHICH TAB YOU ARE LOOKING AT IS VIEW STATE, PER DEVICE. It never enters the node blob: the
//   composition is shared with every client paired with the node, but which of its dashboards this
//   screen happens to be reading is a property of this screen. Same posture, same machinery and the
//   same device-pref list as `core.last-source`.
//
//   THE LIST TRANSFORMS ARE PURE. Create, rename and reorder are all one write (`setHomeTabs`), so
//   the interesting part of each verb is what list it hands over — which is testable without a DOM,
//   and this suite renders no components.

const [activeHomeTab, setActiveHomeTab] = createSignal('')
export { activeHomeTab, setActiveHomeTab }

/** The grid Home draws is the tab bar's `tabpanel`. One id because Home has one grid. */
export const HOME_TAB_PANEL_ID = 'dash-home-panel'

/** `''` is the default tab, and an empty id fragment is not a DOM id. */
export const homeTabDomId = (tabId: string): string => `dash-home-tab-${tabId || 'default'}`

const NEW_TAB_NAME = 'New dashboard'

/** `New dashboard`, `New dashboard 2`, … — bounded by the tab cap, so there is always a free one. */
const uniqueName = (tabs: readonly DashboardTab[], base: string): string => {
  const taken = new Set(tabs.map((tab) => tab.name))
  const candidates = [base, ...Array.from({ length: MAX_TABS }, (_, index) => `${base} ${index + 2}`)]
  return candidates.find((name) => !taken.has(name)) ?? base
}

/** The list that creating a dashboard writes, plus the new tab's id.
 *
 *  Creating the SECOND dashboard is what first writes the key at all, so the default tab has to be
 *  named on the way past: it is `home` either way, but a bar whose first tab has no name is a bar
 *  with a hole in it.
 *
 *  A NAME is optional and still goes through `uniqueName`, so the caller cannot mint two tabs that read
 *  the same — the wizard asks for one, the tab bar's `+` does not, and neither has to think about it. */
export function addTab(tabs: readonly DashboardTab[], name = ''): { tabs: DashboardTab[]; id: string } {
  const base = tabs.length ? [...tabs] : [{ id: '', name: 'Home' }]
  const id = crypto.randomUUID().slice(0, 8)
  return { tabs: [...base, { id, name: uniqueName(base, name.trim() || NEW_TAB_NAME) }], id }
}

export const renameTab = (tabs: readonly DashboardTab[], id: string, name: string): DashboardTab[] =>
  tabs.map((tab) => (tab.id === id ? { ...tab, name } : tab))

/** Reorder as a swap with the neighbour — the menu-first form of drag, and the only form. */
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
  // A saved id naming a tab that is gone is not corrected here — the renderer falls back to the
  // default tab, and the stored value survives a client that could not see the tab yet.
  unknownIds: 'retain-inert',
  maxBytes: 128,
  binding: appStateBinding(activeHomeTab, setActiveHomeTab),
}

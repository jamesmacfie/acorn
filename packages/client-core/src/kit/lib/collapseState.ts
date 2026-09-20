import { createSignal, type Accessor } from 'solid-js'
import { readLocal, writeLocal } from './deviceStorage'

// A collapsed sidebar: the list column narrowed to the width of the icon rails, where each row keeps
// one mark and gives its name back through the tooltip.
//
// One signal per sidebar, held here under the sidebar's key rather than inside the column, because
// the column and its rows both have to read it and neither can reach the other. A row is written in
// the caller's JSX and handed to `ListDetail` as an element that was already created, so no provider
// this node could render would own it, and context never arrives. Keying the state instead is the
// same answer `host/layouts/state.ts` gives for per-pane layout state, for the same reason.
//
// Stored per device, the shape `Fold`'s `persistKey` already uses (../components/layout/Fold.tsx).
// Where a reader left a column is this installation's own, it never reaches a node, and a terminal
// with nowhere to keep it reads `false` forever and draws the full column, which is what that host
// wants anyway.

const storageKey = (key: string): string => `sidebar:${key}`

/** Expanded removes the key rather than writing a zero: there is no third state to tell apart, so the
 *  absent key and the false one mean the same thing. */
const readCollapsed = (key: string): boolean => readLocal(storageKey(key)) === '1'

const columns = new Map<string, [Accessor<boolean>, (collapsed: boolean) => void]>()

/** This sidebar's collapse, created on first ask and seeded from what was stored. The setter writes
 *  through, so a caller never has to remember to persist. */
export function sidebarCollapse(key: string): [Accessor<boolean>, (collapsed: boolean) => void] {
  const found = columns.get(key)
  if (found) return found
  const [collapsed, set] = createSignal(readCollapsed(key))
  const entry: [Accessor<boolean>, (collapsed: boolean) => void] = [collapsed, (next) => {
    set(next)
    writeLocal(storageKey(key), next ? '1' : '')
  }]
  columns.set(key, entry)
  return entry
}

/** The key the `list-detail` layout collapses a pane's list column under. A pane's own list region
 *  needs the same key to draw its rows' rail forms, and the layout has only the pane id to build it
 *  from, so the spelling lives here rather than in both. Namespaced because a pane id and a browse
 *  source id are different things that can read the same. */
export const paneCollapseKey = (paneId: string): string => `pane:${paneId}`

/** Read it without being able to change it, for a row or a header that only needs to know. */
export const sidebarCollapsed = (key: string): Accessor<boolean> => sidebarCollapse(key)[0]

/** Test seam. The map outlives any one render, the way the layout state map does. */
export function _resetSidebarCollapse(): void {
  columns.clear()
}

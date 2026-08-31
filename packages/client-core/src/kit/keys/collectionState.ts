// Where every collection's `active`, `selected` and `offset` live: in the host, keyed by the
// collection's id and by each item's own key.
//
// This is ratatui's `ListState` with the host holding it (docs/command-palette-and-shortcuts.md § Focus and typing
// § Collection state is the host's). Keys, never indices: a list rebuilt from a new response is a
// new array of new objects, and an index into it points at whatever moved into that slot. Keying by
// the item's own key is what makes a refresh keep your place, and it is the standing fix for the
// `<For>`-versus-`<Index>` defocus bug — the state is outside the rows, so a remount cannot take it.
//
// Module-level, like the registries and `layouts/state.ts`, and session-only for the same reason:
// where you are in a list is a reading posture, not a preference.

import { createStore, reconcile } from 'solid-js/store'

export type CollectionState = {
  /** Where roving focus is. Host-owned always; a plugin never writes it. */
  active: string | null
  /** What is picked. Host-owned unless the node declares `controlled`. */
  selected: string | null
  /** Scroll, in pixels, for a collection that virtualises. */
  offset: number
}

const EMPTY: CollectionState = { active: null, selected: null, offset: 0 }

const [states, setStates] = createStore<Record<string, CollectionState>>({})

/** One collection's state. Reactive, and never undefined: an unvisited collection reads as empty. */
export const collectionState = (id: string): CollectionState => states[id] ?? EMPTY

export function setActiveItem(id: string, key: string | null): void {
  setStates(id, (current) => ({ ...(current ?? EMPTY), active: key }))
}

export function setSelectedItem(id: string, key: string | null): void {
  setStates(id, (current) => ({ ...(current ?? EMPTY), selected: key }))
}

export function setCollectionOffset(id: string, offset: number): void {
  setStates(id, (current) => ({ ...(current ?? EMPTY), offset }))
}

/** Test seam, and the eviction hook a host with a lifecycle would call.
 *
 *  Through `reconcile`, because a store setter handed a plain object *merges* it: `setStates(() => ({}))`
 *  reads as "replace with nothing" and does nothing at all, which left a suite's second test holding
 *  the first one's caret. Found by the terminal host, whose whole suite is one process. */
export function _resetCollectionState(): void {
  setStates(reconcile({}))
}

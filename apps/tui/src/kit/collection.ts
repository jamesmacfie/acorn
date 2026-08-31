import { createSignal, onCleanup } from 'solid-js'
import type { CollectionItem } from '@acorn/client-core/kit/keys/collection.ts'

// Collections without a DOM, at the size phase 0 needs.
//
// The shared half of client-core's `collection.ts` — the intents, and a place kept by the item's own
// key — is what belongs here; its element half (`focus()`, `scrollIntoView`, the `aria-*` and
// `tabindex` getters) is DOM all the way down. Phase 2 splits that file so both hosts import the
// intent half. This is the spike's stand-in, and it is deliberately one store for every `Rows` on
// screen rather than one per node: a pane's list is drawn as several groups (Notes draws three), and
// in a terminal the arrows walk what is drawn, in the order it is drawn.
//
// What is missing on purpose: type-ahead, the page keys, expansion, and any notion of scrolling a row
// into view. Phase 1 has the cell buffer to assert against; guessing at them here would be guessing.

export type ItemProps = { readonly key: string }

type Group = { id: string; items: readonly CollectionItem[]; activate?: (key: string) => void; select?: (key: string) => void }

const groups: Group[] = []
// What one row does when it is opened.
//
// On the DOM a `Row` is a button or an anchor, so Enter on the focused row raises a click and the
// row's own `onPress` runs; `Rows.onActivate` is the other way of saying it and most panes use
// neither. There is no element here, so the row hands its handler over and the host routes the
// intent. Keyed by the item's key, which is the same thing everything else in this file is keyed by.
const presses = new Map<string, () => void>()
const [activeKey, setActiveKey] = createSignal<string | null>(null)

/** Every enabled item across every mounted collection, in mount order. */
const walk = (): { group: Group; item: CollectionItem }[] =>
  groups.flatMap((group) => group.items.filter((item) => !item.disabled).map((item) => ({ group, item })))

export const active = activeKey

export function registerRowPress(key: string, press: () => void): void {
  presses.set(key, press)
  onCleanup(() => { if (presses.get(key) === press) presses.delete(key) })
}

export function registerRows(group: Group): void {
  groups.push(group)
  onCleanup(() => {
    const at = groups.indexOf(group)
    if (at >= 0) groups.splice(at, 1)
  })
}

/** Move by one, wrapping. Selecting follows the active row, which is what a list with no pointer
 *  wants: there is no second way to say "this one".
 *
 *  With nothing active yet, the first `next` lands on the first row rather than the second, and the
 *  first `prev` on the last. */
export function move(delta: number): boolean {
  const all = walk()
  if (!all.length) return false
  const at = all.findIndex((entry) => entry.item.key === activeKey())
  const next = at < 0
    ? all[delta > 0 ? 0 : all.length - 1]
    : all[((at + delta) + all.length) % all.length]
  setActiveKey(next.item.key)
  next.group.select?.(next.item.key)
  return true
}

export function activate(): boolean {
  const key = activeKey()
  if (!key) return false
  const entry = walk().find((candidate) => candidate.item.key === key)
  if (!entry) return false
  const press = presses.get(key)
  if (!entry.group.activate && !press) return false
  entry.group.activate?.(key)
  press?.()
  return true
}

/** Test seam: the registry outlives a single render otherwise. */
export function _resetCollections(): void {
  groups.length = 0
  presses.clear()
  setActiveKey(null)
}

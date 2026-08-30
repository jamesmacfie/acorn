import { createSignal, type Accessor } from 'solid-js'

// Per-pane layout state: which tab a `tabs` pane is showing, where a `list-detail` or `stack-split`
// pane's handle sits. Held by the host under the pane id, not by the pane, so a pane that unmounts and
// comes back finds its posture where it left it.
//
// Session-only, and deliberately: it is a reading posture rather than a preference, and persisting one
// needs a scope, an eviction rule and a prefs key that nobody has asked for. That is exactly what the
// splitter in the composed database pane did, and this generalises it rather than changing it.
//
// Module-level, like the registries, so two panes with the same id in two tasks share a value. They
// share the pane id everywhere else too, including the persisted task layout.

const cells = new Map<string, [Accessor<unknown>, (next: unknown) => void]>()

/** The signal for one piece of a pane's layout state, created on first ask. */
export function layoutState<T>(paneId: string, name: string, initial: T): [Accessor<T>, (next: T) => void] {
  const key = `${paneId}:${name}`
  let cell = cells.get(key)
  if (!cell) {
    const [read, write] = createSignal<unknown>(initial)
    // The updater form, because a caller storing a function would have the setter call it.
    cell = [read, (next) => write(() => next)]
    cells.set(key, cell)
  }
  return cell as [Accessor<T>, (next: T) => void]
}

/** Show one tab of a `tabs` pane, from outside the layout.
 *
 * A pane whose panels cross-reference each other — github's conversation sending the reader to a line
 * of the diff — has to be able to say which tab it means. The state is the host's either way; this is
 * the door to it, and the only one, so a pane still cannot reach for the layout itself. */
export function selectPaneTab(paneId: string, tabId: string): void {
  layoutState<string>(paneId, 'tab', '')[1](tabId)
}

/** Test seam. The map is module-level, so a suite asserting on a fresh pane must not inherit one. */
export function _resetLayoutState(): void {
  cells.clear()
}

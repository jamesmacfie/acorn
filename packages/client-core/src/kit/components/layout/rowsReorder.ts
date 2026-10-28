import { createMemo, createSignal } from 'solid-js'
import type { CollectionItem } from '../../keys/collectionIntents'

// A reorderable `Rows`, minus anything a host draws: the order being saved, the move itself, and what
// a screen reader hears. Both hosts read it, so a keyboard move means the same thing in a window and a
// terminal. The DOM host adds the grip and the drag (./Rows.tsx).

/** A row of a reorderable `Rows`. `fixed` keeps it where it is, with no grip, and leaves its key out of
 *  the order the caller saves. */
export type ReorderableItem = CollectionItem & { fixed?: boolean }

export type ReorderPosition = 'before' | 'after'

/** `save` is the caller's `onReorder`, read at the moment of a move so a list can stop offering it. */
export function createRowsReorder<T extends ReorderableItem>(options: {
  items: () => readonly T[]
  save: () => ((keys: string[]) => Promise<unknown>) | undefined
  /** After a move settles, with the moved key, so the host can put focus back on it. */
  settled?: (key: string) => void
}) {
  const [pending, setPending] = createSignal<string[]>()
  const [announcement, setAnnouncement] = createSignal('')
  const movable = () =>
    options
      .items()
      .filter((item) => !item.fixed)
      .map((item) => item.key)

  // While a save runs the rows show where they are going. A fixed row keeps its slot, and a row that
  // arrived during the save goes after the ones that were moved.
  const shown = createMemo(() => {
    const keys = pending()
    const items = options.items()
    if (!keys) return items
    const byKey = new Map(items.filter((item) => !item.fixed).map((item) => [item.key, item]))
    const queue = [
      ...keys.flatMap((key) => byKey.get(key) ?? []),
      ...[...byKey.values()].filter((item) => !keys.includes(item.key)),
    ]
    return items.map((item) => (item.fixed ? item : queue.shift()!))
  })

  async function move(key: string, target: string, position: ReorderPosition) {
    const save = options.save()
    const keys = movable()
    if (!save || pending() || key === target || !keys.includes(key) || !keys.includes(target)) return
    const next = keys.filter((each) => each !== key)
    next.splice(next.indexOf(target) + (position === 'after' ? 1 : 0), 0, key)
    if (next.every((each, index) => each === keys[index])) return
    setPending(next)
    setAnnouncement('Saving order…')
    try {
      await save(next)
      setAnnouncement('Order saved.')
    } catch {
      // The caller has the reason and shows it. The list goes back to the order it was given.
      setAnnouncement('Order not saved.')
    } finally {
      setPending(undefined)
      options.settled?.(key)
    }
  }

  /** One place up or down, for the menu and the keys. False when there is nowhere to go. */
  function shift(key: string, delta: -1 | 1): boolean {
    const keys = movable()
    const at = keys.indexOf(key)
    const target = at >= 0 ? keys[at + delta] : undefined
    if (!target || pending()) return false
    void move(key, target, delta === -1 ? 'before' : 'after')
    return true
  }

  return {
    shown,
    move,
    shift,
    busy: () => !!pending(),
    announcement,
    /** Where a movable row sits among the movable rows, so its menu can say it has nowhere to go. */
    edges: (key: string) => {
      const keys = movable()
      return { first: keys[0] === key, last: keys[keys.length - 1] === key }
    },
  }
}

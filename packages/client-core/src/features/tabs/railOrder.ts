export type RailOrder = {
  pinned: string[] // task ids pinned to the top, in pinned order
  order: string[] // manual order for the rest; unknown ids keep their tasks.sort order after these
  sources?: string[] // source ids, independent of the task order above
}

export type RailDropPosition = 'before' | 'after'

export const EMPTY_RAIL_ORDER: RailOrder = { pinned: [], order: [] }

export function parseRailOrder(json: string | undefined): RailOrder {
  if (!json) return EMPTY_RAIL_ORDER
  try {
    const v = JSON.parse(json) as Partial<RailOrder>
    return {
      pinned: Array.isArray(v.pinned) ? v.pinned.filter((x): x is string => typeof x === 'string') : [],
      order: Array.isArray(v.order) ? v.order.filter((x): x is string => typeof x === 'string') : [],
      ...(Array.isArray(v.sources) ? { sources: v.sources.filter((x): x is string => typeof x === 'string') } : {}),
    }
  } catch {
    return EMPTY_RAIL_ORDER
  }
}

export const serializeRailOrder = (o: RailOrder): string => JSON.stringify(o)

// Partition + sort: pinned first (their saved order), then the manual order, then anything the
// prefs don't know about in the given (tasks.sort) order.
export function applyRailOrder<T extends { id: string }>(tasks: T[], order: RailOrder): T[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const used = new Set<string>()
  const out: T[] = []
  for (const id of order.pinned) {
    const t = byId.get(id)
    if (t && !used.has(id)) {
      out.push(t)
      used.add(id)
    }
  }
  for (const id of order.order) {
    const t = byId.get(id)
    if (t && !used.has(id)) {
      out.push(t)
      used.add(id)
    }
  }
  for (const t of tasks) if (!used.has(t.id)) out.push(t)
  return out
}

export const isPinned = (order: RailOrder, id: string): boolean => order.pinned.includes(id)

/** Keep newly installed sources after the saved order, in their registry order. */
export function applySourceOrder<T extends { id: string }>(sources: T[], order: RailOrder): T[] {
  if (!order.sources?.length) return sources
  const positions = new Map(order.sources.map((id, index) => [id, index]))
  return [...sources].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity))
}

/** A drag among the icons on show, written back over every available source so a hidden one keeps
 *  its slot. `all` is the full order as it stands; `shown` is the visible subset in its new order. */
export function reorderShownSources(all: readonly string[], shown: readonly string[]): string[] {
  const visible = new Set(shown)
  let next = 0
  return all.map((id) => (visible.has(id) ? shown[next++]! : id))
}

export function pinTask(order: RailOrder, id: string): RailOrder {
  if (order.pinned.includes(id)) return order
  return { pinned: [...order.pinned, id], order: order.order.filter((x) => x !== id) }
}

export function unpinTask(order: RailOrder, id: string): RailOrder {
  if (!order.pinned.includes(id)) return order
  return { pinned: order.pinned.filter((x) => x !== id), order: [id, ...order.order.filter((x) => x !== id)] }
}

// Drag-reorder: place `id` on the chosen edge of `targetId`. Cross-partition drags adopt the target
// partition, so either edge of a pinned row pins and either edge of an unpinned row unpins. The full
// visible id list is materialised into the pref so the round-trip is stable. Saved ids outside the
// current rail stay in place, since another workspace may have its own manual order.
export function moveTask(
  order: RailOrder,
  visibleIds: string[],
  id: string,
  targetId: string,
  position: RailDropPosition,
): RailOrder {
  if (id === targetId) return order
  const pinnedSet = new Set(order.pinned)
  const visibleSet = new Set(visibleIds)
  const rest = visibleIds.filter((x) => !pinnedSet.has(x))
  const targetPinned = pinnedSet.has(targetId)
  const withoutId = (list: string[]) => list.filter((x) => x !== id)
  const replaceVisible = (saved: string[], reordered: string[]): string[] => {
    const result: string[] = []
    let next = 0
    for (const savedId of saved) {
      if (!visibleSet.has(savedId)) result.push(savedId)
      else if (next < reordered.length) result.push(reordered[next++]!)
    }
    return [...result, ...reordered.slice(next)]
  }
  const insert = (list: string[]): string[] => {
    const base = withoutId(list)
    const targetIndex = base.indexOf(targetId)
    if (targetIndex < 0) return [...base, id]
    const insertAt = targetIndex + (position === 'after' ? 1 : 0)
    return [...base.slice(0, insertAt), id, ...base.slice(insertAt)]
  }
  const pinnedHere = order.pinned.filter((x) => visibleSet.has(x))
  return {
    pinned: replaceVisible(order.pinned, targetPinned ? insert(pinnedHere) : withoutId(pinnedHere)),
    order: replaceVisible(order.order, targetPinned ? withoutId(rest) : insert(rest)),
    ...(order.sources ? { sources: order.sources } : {}),
  }
}

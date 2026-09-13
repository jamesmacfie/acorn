export type RailOrder = {
  pinned: string[] // task ids pinned to the top, in pinned order
  order: string[] // manual order for the rest; unknown ids keep their tasks.sort order after these
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
// visible id list is materialised into the pref so the round-trip is stable.
export function moveTask(
  order: RailOrder,
  visibleIds: string[],
  id: string,
  targetId: string,
  position: RailDropPosition,
): RailOrder {
  if (id === targetId) return order
  const pinnedSet = new Set(order.pinned)
  const rest = visibleIds.filter((x) => !pinnedSet.has(x))
  const targetPinned = pinnedSet.has(targetId)
  const withoutId = (list: string[]) => list.filter((x) => x !== id)
  const insert = (list: string[]): string[] => {
    const base = withoutId(list)
    const targetIndex = base.indexOf(targetId)
    if (targetIndex < 0) return [...base, id]
    const insertAt = targetIndex + (position === 'after' ? 1 : 0)
    return [...base.slice(0, insertAt), id, ...base.slice(insertAt)]
  }
  if (targetPinned) return { pinned: insert(order.pinned.filter((x) => visibleIds.includes(x) || x === id)), order: withoutId(rest) }
  return { pinned: withoutId(order.pinned), order: insert(rest) }
}

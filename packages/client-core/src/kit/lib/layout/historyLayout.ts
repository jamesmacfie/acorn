/** History geometry uses only immutable commit IDs and parent relationships. */
export type HistoryNode = { id: string; parents: readonly string[] }
export type HistoryEdge = { from: number; to: number; start: 'top' | 'center'; end: 'center' | 'bottom'; continuation: boolean }
export type HistorySlot = {
  id: string
  lane: number
  edges: HistoryEdge[]
  lanes: number
  continuation: boolean
  disconnected: boolean
}

/** The drawing shows eight lanes; further lanes are counted, never folded onto another line. */
export const HISTORY_VISIBLE_LANES = 8

/** Each row joins the lanes arriving from above to the lanes leaving below. */
export function historyLayout(nodes: readonly HistoryNode[], connected: boolean, hasMore: boolean, hasPrevious = false): HistorySlot[] {
  if (!connected) return nodes.map((node) => ({ id: node.id, lane: 0, edges: [], lanes: 1,
    continuation: false, disconnected: node.parents.length > 0 }))

  const visible = new Set(nodes.map((node) => node.id))
  let active: string[] = []
  return nodes.map((node, index) => {
    const hadIncoming = active.includes(node.id)
    if (!hadIncoming) active = [...active, node.id]
    const incoming = active
    const lane = incoming.indexOf(node.id)
    const parents = node.parents.filter((id) => visible.has(id) || hasMore)
    const outgoing = incoming.filter((id) => id !== node.id)
    outgoing.splice(lane, 0, ...parents.filter((id) => !outgoing.includes(id)))
    const edges: HistoryEdge[] = incoming.flatMap((id, from) => id === node.id ? [] : [{
      from, to: outgoing.indexOf(id), start: 'top' as const, end: 'bottom' as const, continuation: false,
    }])
    if (hadIncoming) edges.push({ from: lane, to: lane, start: 'top', end: 'center', continuation: false })
    else if (index === 0 && hasPrevious) edges.push({ from: lane, to: lane, start: 'top', end: 'center', continuation: true })
    for (const parent of parents) edges.push({ from: lane, to: outgoing.indexOf(parent), start: 'center', end: 'bottom',
      continuation: !visible.has(parent) })
    active = outgoing
    return { id: node.id, lane, edges, lanes: Math.max(incoming.length, outgoing.length),
      continuation: edges.some((edge) => edge.continuation), disconnected: false }
  })
}

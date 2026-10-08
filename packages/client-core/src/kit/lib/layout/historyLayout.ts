/** Neutral commit rows. The kit knows only immutable IDs and parent relationships. */
export type HistoryNode = { id: string; parents: readonly string[] }
export type HistorySlot = { id: string; lane: number; lanes: number[]; parentLanes: number[]; continuation: boolean; disconnected: boolean }

/** Walk newest first. A parent keeps its child's lane; extra parents open adjacent lanes. */
export function historyLayout(nodes: readonly HistoryNode[], connected: boolean, hasMore: boolean): HistorySlot[] {
  const visible = new Set(nodes.map((node) => node.id))
  const active: string[] = []
  return nodes.map((node) => {
    let lane = active.indexOf(node.id)
    if (lane < 0) { active.unshift(node.id); lane = 0 }
    const lanes = active.map((_, index) => index)
    const parents = connected ? node.parents.filter((id) => visible.has(id) || hasMore) : []
    active.splice(lane, 1, ...parents.filter((id) => !active.includes(id) || id === node.id))
    for (let index = active.length - 1; index >= 0; index--) if (active.indexOf(active[index]!) !== index) active.splice(index, 1)
    return { id: node.id, lane, lanes, parentLanes: parents.map((id) => active.indexOf(id)).filter((index) => index >= 0),
      continuation: parents.some((id) => !visible.has(id)), disconnected: !connected && node.parents.length > 0 }
  })
}

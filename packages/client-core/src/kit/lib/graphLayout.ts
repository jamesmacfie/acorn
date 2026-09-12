// Where a graph's cards sit and how the wire between two of them is drawn, in content coordinates.
//
// Pure geometry: no components, no measuring, no host. The `Graph` node owns pan and zoom and this
// owns the shape underneath, which is what lets the terminal host read the ranks out of the same
// function and indent a list by them (docs/ui-design.md § Every node at 80 by 24).
//
// The numbers are proliferate's, copied rather than re-derived, from
// `references/proliferate/apps/packages/product-client/src/domain/workflows/graph-layout.ts`: 200 by
// 92 cards on a 22 px grid, a rank gap of 60 and a lane pitch of 236.

/** Card geometry: 200×92 cards on a 22px grid. */
export const GRAPH_CARD_W = 200
export const GRAPH_CARD_H = 92
export const GRAPH_GRID = 22
/** Vertical pitch between ranks (card height plus room for the wire). */
const RANK_GAP = 60
/** Horizontal pitch between lanes (card width plus a gutter). */
const LANE_PITCH = 236

/** How far a reader may zoom out and in. Below the floor a label is unreadable; above the ceiling a
 *  card is bigger than it is on the page and nothing is gained. */
export const GRAPH_ZOOM_MIN = 0.35
export const GRAPH_ZOOM_MAX = 1.5

export type GraphPoint = { x: number; y: number }
export type GraphEdgeRef = { from: string; to: string }

/** A card, placed. `rank` is how many steps it is from a root, which is the indentation a host with
 *  no pixels draws instead of a position. */
export type PlacedCard = { id: string; x: number; y: number; rank: number; parents: readonly string[] }
export type PlacedEdge = { from: string; to: string; path: string; control: GraphPoint }
export type GraphLayout = {
  cards: readonly PlacedCard[]
  at: (id: string) => PlacedCard | undefined
  edges: readonly PlacedEdge[]
  width: number
  height: number
}

/** How far each node is from a root: 0 for a node nothing points at, otherwise one past the deepest
 *  thing that does. A cycle is not a crash — the node that closes it is treated as a root, the same
 *  answer the workflows editor's list gives, so a broken graph still draws every card it has. */
export function graphRanks(ids: readonly string[], edges: readonly GraphEdgeRef[]): Map<string, number> {
  const known = new Set(ids)
  const parents = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const edge of edges) {
    if (known.has(edge.from) && known.has(edge.to)) parents.get(edge.to)!.push(edge.from)
  }
  const ranks = new Map<string, number>()
  const visiting = new Set<string>()
  const rankOf = (id: string): number => {
    const held = ranks.get(id)
    if (held !== undefined) return held
    if (visiting.has(id)) return 0
    visiting.add(id)
    const above = parents.get(id) ?? []
    const rank = above.length ? 1 + Math.max(...above.map(rankOf)) : 0
    visiting.delete(id)
    ranks.set(id, rank)
    return rank
  }
  for (const id of ids) rankOf(id)
  return ranks
}

/** The parents of each node, in the order the edges were given. */
export function graphParents(ids: readonly string[], edges: readonly GraphEdgeRef[]): Map<string, string[]> {
  const known = new Set(ids)
  const parents = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const edge of edges) {
    if (known.has(edge.from) && known.has(edge.to)) parents.get(edge.to)!.push(edge.from)
  }
  return parents
}

/** A vertical cubic between two ports: out of the source's bottom, into the target's top, with the
 *  control points pulled straight down and up so the curve reads as flow rather than as slack. */
const edgePath = (from: GraphPoint, to: GraphPoint): string => {
  const pull = Math.max(24, (to.y - from.y) / 2)
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + pull}, ${to.x} ${to.y - pull}, ${to.x} ${to.y}`
}

const bottomPort = (card: PlacedCard): GraphPoint => ({ x: card.x + GRAPH_CARD_W / 2, y: card.y + GRAPH_CARD_H })
const topPort = (card: PlacedCard): GraphPoint => ({ x: card.x + GRAPH_CARD_W / 2, y: card.y })

/** Points along an edge tried when looking for wire no card covers. */
const EDGE_SAMPLES = 41

/** Strictly inside: a port sits on the border and is not covered by the card it belongs to. */
const covers = (card: PlacedCard, x: number, y: number): boolean =>
  x > card.x && x < card.x + GRAPH_CARD_W && y > card.y && y < card.y + GRAPH_CARD_H

/**
 * The middle of the longest stretch of an edge that no card covers.
 *
 * An author may wire two cards that are not neighbours on screen, and that edge runs behind whatever
 * sits between them. A control pinned to the geometric midpoint then lands on another card: invisible
 * there, and still first in line for the pointer, which is how a card in the middle of a chain stops
 * being clickable. An edge with no open stretch keeps its midpoint, because there is no better point
 * and the cards are drawn above the controls anyway.
 */
function edgeControl(from: GraphPoint, to: GraphPoint, cards: readonly PlacedCard[]): GraphPoint {
  let bestStart = -1
  let bestEnd = -1
  let runStart = -1
  for (let sample = 0; sample < EDGE_SAMPLES; sample += 1) {
    const ratio = sample / (EDGE_SAMPLES - 1)
    const x = from.x + (to.x - from.x) * ratio
    const y = from.y + (to.y - from.y) * ratio
    if (cards.some((card) => covers(card, x, y))) {
      runStart = -1
      continue
    }
    if (runStart === -1) runStart = sample
    if (sample - runStart >= bestEnd - bestStart) {
      bestStart = runStart
      bestEnd = sample
    }
  }
  if (bestStart === -1) return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const ratio = ((bestStart + bestEnd) / 2) / (EDGE_SAMPLES - 1)
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }
}

/**
 * Cards and wires for a graph, deterministic from its edges.
 *
 * Rank down, lane across: a node sits one rank below the deepest thing it waits on, and shares that
 * rank with its siblings in the order they were given. A position in `positions` wins for its own
 * card and changes nothing about anyone else's, which is what makes hand placement an override of
 * this layout rather than a replacement for it.
 */
export function layoutGraph(
  ids: readonly string[],
  edges: readonly GraphEdgeRef[],
  positions: Readonly<Record<string, GraphPoint>> = {},
): GraphLayout {
  const ranks = graphRanks(ids, edges)
  const parents = graphParents(ids, edges)
  const lanes = new Map<number, number>()
  const cards = ids.map((id): PlacedCard => {
    const rank = ranks.get(id) ?? 0
    const lane = lanes.get(rank) ?? 0
    lanes.set(rank, lane + 1)
    const put = positions[id]
    return {
      id,
      x: put?.x ?? lane * LANE_PITCH,
      y: put?.y ?? rank * (GRAPH_CARD_H + RANK_GAP),
      rank,
      parents: parents.get(id) ?? [],
    }
  })
  const byId = new Map(cards.map((card) => [card.id, card]))
  const wires = edges.flatMap((edge): PlacedEdge[] => {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) return []
    const start = bottomPort(from)
    const end = topPort(to)
    return [{ from: edge.from, to: edge.to, path: edgePath(start, end), control: edgeControl(start, end, cards) }]
  })
  return {
    cards,
    at: (id: string) => byId.get(id),
    edges: wires,
    // Measured from the placements rather than from the ranks: a card dragged right or down has to
    // grow the content the canvas pans over and fits to.
    width: cards.reduce((max, card) => Math.max(max, card.x + GRAPH_CARD_W), 0),
    height: cards.reduce((max, card) => Math.max(max, card.y + GRAPH_CARD_H), 0),
  }
}

/** A dragged card lands on the grid, so two cards put down by hand line up with each other. */
export const snapToGrid = (value: number): number => Math.round(value / GRAPH_GRID) * GRAPH_GRID

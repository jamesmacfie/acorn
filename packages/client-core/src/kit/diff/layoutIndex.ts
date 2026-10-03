// The diff's geometry as two domains (docs/diff-rendering/geometry.md § Row geometry).
//
// An item is a file header, a segment of code rows, or a slice of revealed context. Its fixed height
// comes from the topology and is exact: code never wraps, so a row is always one line. Those heights
// go into a prefix array once, and are rebuilt only when the list of items itself changes, which is an
// explicit, rare event: a new document, a collapsed file, an opened gap, or a change of projection.
//
// What can change height, threads and the notes, marks and composers under a line, is the dynamic
// side. Each item has a short list of dynamic blocks, and the sum of each item's blocks sits in a
// Fenwick tree, so a block that resizes updates one item's total in O(log items). Nothing is done for
// the rows below it. An item's top is its fixed start plus the dynamic prefix before it:
//
//   top(i) = fixedStart(i) + dynamicPrefix(i)
//
// Inside an item, a block sits at a point in the item's fixed rows (`at`, in pixels of code rows
// only): a note sits after the line it annotates, and a thread after the line it is anchored to. That
// makes a place in the item a fixed coordinate or a block and an offset into it, and the two
// functions below that convert between places and pixels are inverses.
//
// Pure: no DOM, no Solid. The reactive layer is features/diff/diffLayout.ts.

/** One dynamic block as the geometry holds it: where it sits in its item's fixed rows, and how tall it
 *  is taken to be now. */
export type DiffLayoutBlock = { id: string; at: number; height: number }

/** A point in the document: a fixed coordinate inside an item, or an offset into one of its blocks. */
export type DiffLayoutPoint =
  | { index: number; fixed: number }
  | { index: number; block: string; offset: number }

export function createDiffLayoutIndex() {
  let count = 0
  // fixedStart[i] is the sum of the fixed heights before item i; the last entry is the fixed total.
  let fixedStart = new Float64Array(1)
  // Each item's dynamic total, and the Fenwick tree over them (1-based).
  let dynamic = new Float64Array(0)
  let tree = new Float64Array(1)
  let dynamicTotal = 0
  let blocks: (readonly DiffLayoutBlock[] | undefined)[] = []
  /** For the health reading and the tests: how often the fixed side was rebuilt, and how many tree
   *  nodes the dynamic side has written. */
  const stats = { fixedRebuilds: 0, treeWrites: 0 }

  const sum = (list: readonly DiffLayoutBlock[] | undefined) => {
    let total = 0
    for (const block of list ?? []) total += block.height
    return total
  }

  const add = (index: number, delta: number) => {
    for (let node = index + 1; node <= count; node += node & -node) {
      tree[node]! += delta
      stats.treeWrites++
    }
    dynamicTotal += delta
  }

  /** The dynamic heights of every item before `index`. */
  const dynamicBefore = (index: number) => {
    let total = 0
    for (let node = index; node > 0; node -= node & -node) total += tree[node]!
    return total
  }

  const top = (index: number) => fixedStart[index]! + dynamicBefore(index)
  const fixedSize = (index: number) => fixedStart[index + 1]! - fixedStart[index]!

  /** The item under a pixel offset: the last one whose top is at or above it. -1 when empty. A binary
   *  search over tops that each cost O(log items). */
  const indexAt = (offset: number): number => {
    if (!count) return -1
    let low = 0
    let high = count - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (top(middle) <= offset) low = middle
      else high = middle - 1
    }
    return low
  }

  return {
    stats,
    get count() {
      return count
    },

    /**
     * Lay out a new list of items: their exact fixed heights, and each one's blocks if it has any. The
     * only operation that costs O(items), and the only one that touches the fixed side.
     */
    rebuild(fixedHeights: ArrayLike<number>, blocksOf?: (index: number) => readonly DiffLayoutBlock[] | undefined) {
      count = fixedHeights.length
      fixedStart = new Float64Array(count + 1)
      for (let index = 0; index < count; index++) fixedStart[index + 1] = fixedStart[index]! + fixedHeights[index]!
      dynamic = new Float64Array(count)
      blocks = []
      tree = new Float64Array(count + 1)
      dynamicTotal = 0
      for (let index = 0; index < count; index++) {
        const list = blocksOf?.(index)
        if (!list?.length) continue
        blocks[index] = list
        dynamic[index] = sum(list)
        dynamicTotal += dynamic[index]!
      }
      // The linear Fenwick build: each node pushes its total up to its parent once.
      for (let node = 1; node <= count; node++) {
        tree[node]! += dynamic[node - 1]!
        const parent = node + (node & -node)
        if (parent <= count) tree[parent]! += tree[node]!
      }
      stats.fixedRebuilds++
    },

    /** Replace one item's blocks, in the order they are drawn. Answers how much the item's height
     *  changed. O(its blocks + log items). */
    setBlocks(index: number, list: readonly DiffLayoutBlock[]): number {
      if (index < 0 || index >= count) return 0
      blocks[index] = list.length ? list : undefined
      const delta = sum(list) - dynamic[index]!
      if (delta !== 0) {
        dynamic[index] = dynamic[index]! + delta
        add(index, delta)
      }
      return delta
    },

    blocks: (index: number): readonly DiffLayoutBlock[] => blocks[index] ?? [],
    top,
    fixedSize,
    /** Where item `index` starts if no block anywhere had any height. */
    fixedTop: (index: number) => fixedStart[index]!,
    size: (index: number) => fixedSize(index) + dynamic[index]!,
    total: () => fixedStart[count]! + dynamicTotal,

    indexAt,

    /** The place under a pixel offset. */
    pointAt(offset: number): DiffLayoutPoint | null {
      if (!count) return null
      const index = indexAt(offset)
      const local = Math.max(0, offset - top(index))
      let shift = 0
      for (const block of blocks[index] ?? []) {
        const start = block.at + shift
        if (local < start) break
        if (local < start + block.height) return { index, block: block.id, offset: local - start }
        shift += block.height
      }
      return { index, fixed: Math.min(Math.max(0, local - shift), fixedSize(index)) }
    },

    /** The pixel offset of a place, or null when the block it names is not in that item. */
    offsetOf(point: DiffLayoutPoint): number | null {
      if (point.index < 0 || point.index >= count) return null
      let shift = 0
      if ('fixed' in point) {
        for (const block of blocks[point.index] ?? []) {
          if (block.at > point.fixed) break
          shift += block.height
        }
        return top(point.index) + point.fixed + shift
      }
      for (const block of blocks[point.index] ?? []) {
        if (block.id === point.block) return top(point.index) + block.at + shift + point.offset
        shift += block.height
      }
      return null
    },
  }
}

export type DiffLayoutIndex = ReturnType<typeof createDiffLayoutIndex>

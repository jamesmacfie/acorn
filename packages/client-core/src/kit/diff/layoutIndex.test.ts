import { describe, expect, it } from 'vitest'
import { createDiffLayoutIndex, type DiffLayoutBlock, type DiffLayoutPoint } from './layoutIndex'

// The diff's two geometry domains, without a DOM (./layoutIndex.ts): exact fixed heights that a block
// resize never touches, and dynamic blocks whose resize costs O(log items).

/** mulberry32, so every run draws the same document. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A million rows as 64-row segments, one file header every 50 segments. Unified and split differ
 *  in height the way their row and band counts do. */
function millionRows(mode: 'unified' | 'split'): number[] {
  const heights: number[] = []
  let rows = 0
  while (rows < 1_000_000) {
    if (heights.length % 51 === 0) heights.push(36)
    const count = Math.min(64, 1_000_000 - rows)
    heights.push((mode === 'split' ? Math.ceil(count * 0.8) : count) * 20)
    rows += count
  }
  return heights
}

/** 400 blocks placed in random segments, at row boundaries inside them. */
function placeBlocks(heights: readonly number[], next: () => number, count = 400): Map<number, DiffLayoutBlock[]> {
  const byItem = new Map<number, DiffLayoutBlock[]>()
  for (let n = 0; n < count; n++) {
    const index = Math.floor(next() * heights.length)
    const rows = Math.floor(heights[index]! / 20)
    const list = byItem.get(index) ?? []
    list.push({ id: `t:${n}`, at: Math.floor(next() * (rows + 1)) * 20, height: 50 + Math.floor(next() * 300) })
    list.sort((a, b) => a.at - b.at)
    byItem.set(index, list)
  }
  return byItem
}

/** The obvious implementation: sum everything, every time. */
function reference(heights: readonly number[], blocks: ReadonlyMap<number, readonly DiffLayoutBlock[]>) {
  const size = (index: number) => heights[index]! + (blocks.get(index) ?? []).reduce((total, block) => total + block.height, 0)
  const top = (index: number) => {
    let total = 0
    for (let at = 0; at < index; at++) total += size(at)
    return total
  }
  return { top, size, total: () => top(heights.length) }
}

/** Every place a point can be in: fixed coordinates short of each item's end, and offsets inside
 *  each block. */
function somePoints(heights: readonly number[], blocks: ReadonlyMap<number, readonly DiffLayoutBlock[]>, next: () => number, count: number): DiffLayoutPoint[] {
  const points: DiffLayoutPoint[] = []
  const withBlocks = [...blocks.entries()].filter(([, list]) => list.some((block) => block.height > 0))
  for (let n = 0; n < count; n++) {
    if (n % 2 && withBlocks.length) {
      const [index, list] = withBlocks[Math.floor(next() * withBlocks.length)]!
      const block = list.filter((candidate) => candidate.height > 0)[Math.floor(next() * list.filter((candidate) => candidate.height > 0).length)]!
      points.push({ index, block: block.id, offset: Math.floor(next() * block.height) })
    } else {
      const index = Math.floor(next() * heights.length)
      points.push({ index, fixed: Math.floor(next() * heights[index]!) })
    }
  }
  return points
}

describe('the diff layout index', () => {
  it('resizes a block among a million rows without touching fixed geometry, in logarithmic work', () => {
    const next = random(7)
    const heights = millionRows('unified')
    const blocks = placeBlocks(heights, next)
    const index = createDiffLayoutIndex()
    index.rebuild(heights, (at) => blocks.get(at))
    const fixedBefore = heights.map((_, at) => index.fixedTop(at))
    const bound = Math.ceil(Math.log2(heights.length)) + 1

    const withBlocks = [...blocks.keys()]
    let maxWrites = 0
    for (let update = 0; update < 2_000; update++) {
      const at = withBlocks[Math.floor(next() * withBlocks.length)]!
      const list = blocks.get(at)!.map((block, n) => (n === 0 ? { ...block, height: Math.floor(next() * 600) } : block))
      blocks.set(at, list)
      const writes = index.stats.treeWrites
      index.setBlocks(at, list)
      maxWrites = Math.max(maxWrites, index.stats.treeWrites - writes)
    }

    expect(index.stats.fixedRebuilds).toBe(1)
    expect(maxWrites).toBeLessThanOrEqual(bound)
    expect(heights.every((_, at) => index.fixedTop(at) === fixedBefore[at])).toBe(true)
    // And the dynamic side still adds up.
    const dynamic = [...blocks.values()].flat().reduce((total, block) => total + block.height, 0)
    expect(index.total()).toBe(fixedBefore.at(-1)! + heights.at(-1)! + dynamic)
  })

  it.each(['unified', 'split'] as const)('turns places into offsets and back again in %s', (mode) => {
    const next = random(mode === 'unified' ? 11 : 13)
    const heights = millionRows(mode)
    const blocks = placeBlocks(heights, next)
    const index = createDiffLayoutIndex()
    index.rebuild(heights, (at) => blocks.get(at))
    for (const point of somePoints(heights, blocks, next, 2_000)) {
      const offset = index.offsetOf(point)
      expect(offset).not.toBeNull()
      expect(index.pointAt(offset!)).toEqual(point)
      // Moving down inside the same place stays in it, by the same distance.
      const room = 'fixed' in point
        ? heights[point.index]! - point.fixed
        : blocks.get(point.index)!.find((block) => block.id === point.block)!.height - point.offset
      const step = Math.min(room - 1, 7)
      if (step <= 0) continue
      const moved = index.pointAt(offset! + step)!
      if ('fixed' in point && 'fixed' in moved) expect(moved.fixed).toBe(point.fixed + step)
      if ('block' in point) expect(moved).toEqual({ ...point, offset: point.offset + step })
    }
  })

  it('matches a slow reference through inserts, resizes, removals, collapse, expansion and a change of projection', () => {
    const next = random(21)
    for (let round = 0; round < 40; round++) {
      let heights = Array.from({ length: 5 + Math.floor(next() * 30) }, () => (1 + Math.floor(next() * 64)) * 20)
      let blocks = placeBlocks(heights, next, 1 + Math.floor(next() * 12))
      const index = createDiffLayoutIndex()
      index.rebuild(heights, (at) => blocks.get(at))

      const check = () => {
        const slow = reference(heights, blocks)
        expect(index.total()).toBe(slow.total())
        for (let at = 0; at < heights.length; at++) {
          expect(index.top(at)).toBe(slow.top(at))
          expect(index.size(at)).toBe(slow.size(at))
        }
        for (let n = 0; n < 20; n++) {
          const offset = Math.floor(next() * slow.total())
          const item = index.indexAt(offset)
          expect(slow.top(item)).toBeLessThanOrEqual(offset)
          expect(slow.top(item) + slow.size(item)).toBeGreaterThan(offset)
        }
      }

      for (let step = 0; step < 30; step++) {
        const at = Math.floor(next() * heights.length)
        const list = [...(blocks.get(at) ?? [])]
        const action = next()
        if (action < 0.3) {
          // Insert: a composer opening, or a thread arriving.
          list.push({ id: `new:${round}:${step}`, at: Math.floor(next() * (heights[at]! / 20 + 1)) * 20, height: Math.floor(next() * 200) })
          list.sort((a, b) => a.at - b.at)
        } else if (action < 0.6 && list.length) {
          list[0] = { ...list[0]!, height: Math.floor(next() * 400) }
        } else if (action < 0.75 && list.length) {
          list.pop()
        } else if (action < 0.85) {
          // Collapse a file: items leave, and their blocks with them.
          const from = Math.floor(next() * heights.length)
          const gone = Math.min(heights.length - 1, from + 1 + Math.floor(next() * 3))
          heights = heights.filter((_, n) => n <= from || n > gone)
          blocks = new Map([...blocks].flatMap(([n, own]) => (n <= from ? [[n, own]] : n > gone ? [[n - (gone - from), own]] : [])))
          index.rebuild(heights, (n) => blocks.get(n))
          check()
          continue
        } else if (action < 0.93) {
          // Expand one: items come back in.
          const from = Math.floor(next() * heights.length)
          const added = Array.from({ length: 1 + Math.floor(next() * 3) }, () => (1 + Math.floor(next() * 64)) * 20)
          heights = [...heights.slice(0, from + 1), ...added, ...heights.slice(from + 1)]
          blocks = new Map([...blocks].map(([n, own]) => [n <= from ? n : n + added.length, own]))
          index.rebuild(heights, (n) => blocks.get(n))
          check()
          continue
        } else {
          // Split has fewer, differently sized rows: a new fixed side, the same blocks.
          heights = heights.map((height) => Math.max(20, Math.ceil(height * 0.8 / 20) * 20))
          blocks = new Map([...blocks].map(([n, own]) => [n, own.map((block) => ({ ...block, at: Math.min(block.at, heights[n]!) }))]))
          index.rebuild(heights, (n) => blocks.get(n))
          check()
          continue
        }
        if (list.length) blocks.set(at, list)
        else blocks.delete(at)
        index.setBlocks(at, list)
        check()
      }
    }
  })

  it('keeps two blocks on one line apart by identity', () => {
    const index = createDiffLayoutIndex()
    // Two threads under the same line, and a note on it: the same `at`, three identities.
    const blocks = [
      { id: 'l:new:12:src/a.ts', at: 40, height: 20 },
      { id: 't:first', at: 40, height: 100 },
      { id: 't:second', at: 40, height: 60 },
    ]
    index.rebuild([36, 200])
    index.setBlocks(1, blocks)
    expect(index.offsetOf({ index: 1, block: 't:first', offset: 0 })).toBe(36 + 40 + 20)
    expect(index.offsetOf({ index: 1, block: 't:second', offset: 0 })).toBe(36 + 40 + 120)
    expect(index.pointAt(36 + 40 + 20 + 99)).toEqual({ index: 1, block: 't:first', offset: 99 })
    expect(index.pointAt(36 + 40 + 120)).toEqual({ index: 1, block: 't:second', offset: 0 })
    // The row after the line starts below all three.
    expect(index.offsetOf({ index: 1, fixed: 40 })).toBe(36 + 40 + 180)
    expect(index.pointAt(36 + 40 + 180)).toEqual({ index: 1, fixed: 40 })
  })
})

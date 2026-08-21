import { describe, expect, it } from 'vitest'
import {
  applyMove,
  applyResize,
  clampRect,
  collides,
  compact,
  COLS,
  firstFit,
  normalize,
  readingOrder,
  sizeFor,
  sizePresets,
  type PanelLayout,
  type PanelSize,
  type Rect,
} from './layout'

// The layout algorithms are where the risk of the whole grid lives. The components above them are
// pointer arithmetic and CSS, which this repo's vitest (node, no Solid plugin) cannot check anyway.

const size = (over: Partial<PanelSize> = {}): PanelSize => ({ minW: 1, minH: 1, w: 2, h: 2, ...over })
const uniform = (value: PanelSize = size()) => () => value

const layoutOf = (rects: Record<string, Rect>, extra: string[] = []): PanelLayout => ({
  order: [...Object.keys(rects), ...extra],
  rects,
})

const at = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

describe('collides', () => {
  it('is true only where the rects overlap on both axes', () => {
    expect(collides(at(0, 0, 2, 2), at(1, 1, 2, 2))).toBe(true)
    expect(collides(at(0, 0, 2, 2), at(2, 0, 2, 2))).toBe(false)
    expect(collides(at(0, 0, 2, 2), at(0, 2, 2, 2))).toBe(false)
  })

  it('does not count a shared edge as an overlap', () => {
    expect(collides(at(0, 0, 6, 4), at(6, 0, 6, 4))).toBe(false)
  })
})

describe('clampRect', () => {
  it('floors to integers', () => {
    expect(clampRect({ x: 1.9, y: 2.4, w: 3.7, h: 2.2 }, size())).toEqual(at(1, 2, 3, 2))
  })

  it('applies the minimums', () => {
    expect(clampRect(at(0, 0, 1, 1), size({ minW: 4, minH: 3 }))).toEqual(at(0, 0, 4, 3))
  })

  it('keeps x + w inside the columns, losing width first', () => {
    expect(clampRect(at(0, 0, 99, 2), size())).toEqual(at(0, 0, COLS, 2))
    expect(clampRect(at(10, 0, 6, 2), size())).toEqual(at(6, 0, 6, 2))
  })

  it('never goes negative', () => {
    expect(clampRect({ x: -4, y: -9, w: 2, h: 2 }, size())).toEqual(at(0, 0, 2, 2))
  })
})

describe('readingOrder', () => {
  it('sorts by row, then column', () => {
    const layout = layoutOf({ c: at(0, 4, 2, 2), a: at(6, 0, 2, 2), b: at(0, 0, 2, 2) })
    expect(readingOrder(layout)).toEqual(['b', 'a', 'c'])
  })

  it('skips ids with no rect, and breaks ties on the id so every client agrees', () => {
    const layout = layoutOf({ z: at(0, 0, 2, 2), a: at(0, 0, 2, 2) }, ['ghost'])
    expect(readingOrder(layout)).toEqual(['a', 'z'])
  })
})

describe('firstFit', () => {
  it('takes the origin on an empty grid', () => {
    expect(firstFit([], { w: 4, h: 2 })).toEqual(at(0, 0, 4, 2))
  })

  it('fills the gap beside an existing panel before going below it', () => {
    expect(firstFit([at(0, 0, 6, 4)], { w: 6, h: 2 })).toEqual(at(6, 0, 6, 2))
  })

  it('drops below everything when the row cannot hold it', () => {
    expect(firstFit([at(0, 0, 8, 3)], { w: 8, h: 2 })).toEqual(at(0, 3, 8, 2))
  })

  it('clamps a size wider than the grid rather than failing to place it', () => {
    expect(firstFit([], { w: 99, h: 1 })).toEqual(at(0, 0, COLS, 1))
  })
})

describe('compact', () => {
  it('floats every panel up to the top', () => {
    const out = compact(layoutOf({ a: at(0, 5, 4, 2), b: at(4, 9, 4, 2) }))
    expect(out.rects).toEqual({ a: at(0, 0, 4, 2), b: at(4, 0, 4, 2) })
  })

  it('stacks rather than overlaps when two panels share a column', () => {
    const out = compact(layoutOf({ a: at(0, 3, 4, 2), b: at(0, 8, 4, 2) }))
    expect(out.rects).toEqual({ a: at(0, 0, 4, 2), b: at(0, 2, 4, 2) })
  })

  it('is vertical only — a deliberate gap within a row survives', () => {
    const out = compact(layoutOf({ a: at(0, 0, 3, 2), b: at(8, 4, 3, 2) }))
    expect(out.rects.b).toEqual(at(8, 0, 3, 2))
  })

  it('is its own fixed point', () => {
    const once = compact(layoutOf({ a: at(0, 4, 4, 2), b: at(0, 9, 4, 3) }))
    expect(compact(once).rects).toEqual(once.rects)
  })
})

describe('normalize', () => {
  it('auto-places every panel when the blob carries no geometry at all — the migration case', () => {
    const out = normalize({ order: ['a', 'b', 'c'], rects: {} }, uniform(size({ w: 6, h: 4 })))
    expect(out.rects).toEqual({ a: at(0, 0, 6, 4), b: at(6, 0, 6, 4), c: at(0, 4, 6, 4) })
  })

  it('auto-places only the panels that are missing a rect', () => {
    const out = normalize(
      { order: ['a', 'b'], rects: { a: at(0, 0, 6, 4) } },
      uniform(size({ w: 6, h: 4 })),
    )
    expect(out.rects.a).toEqual(at(0, 0, 6, 4))
    expect(out.rects.b).toEqual(at(6, 0, 6, 4))
  })

  it('resolves an overlap left by a partial write by pushing down, never sideways', () => {
    const out = normalize(layoutOf({ a: at(0, 0, 6, 4), b: at(2, 1, 6, 2) }), uniform())
    expect(out.rects.a).toEqual(at(0, 0, 6, 4))
    expect(out.rects.b).toEqual(at(2, 4, 6, 2))
  })

  it('raises a rect below its view kind minimum without moving it', () => {
    const out = normalize(layoutOf({ a: at(3, 0, 1, 1) }), uniform(size({ minW: 4, minH: 3 })))
    expect(out.rects.a).toEqual(at(3, 0, 4, 3))
  })

  it('produces a layout with no two panels overlapping, whatever it was handed', () => {
    const out = normalize(
      layoutOf({ a: at(0, 0, 12, 4), b: at(0, 0, 12, 4), c: at(1, 1, 4, 4) }),
      uniform(),
    )
    const rects = Object.values(out.rects)
    for (const [index, rect] of rects.entries()) {
      for (const other of rects.slice(index + 1)) expect(collides(rect, other)).toBe(false)
    }
  })

  it('is its own fixed point', () => {
    const once = normalize(layoutOf({ a: at(0, 0, 6, 4), b: at(2, 2, 6, 4) }), uniform())
    expect(normalize(once, uniform()).rects).toEqual(once.rects)
  })
})

describe('applyMove', () => {
  it('pushes what it lands on down, and gravity closes the gap behind it', () => {
    const layout = layoutOf({ a: at(0, 0, 6, 2), b: at(0, 2, 6, 2) })
    const out = applyMove(layout, 'a', at(0, 2, 6, 2), uniform())
    expect(out.rects.a).toEqual(at(0, 0, 6, 2))
    expect(out.rects.b).toEqual(at(0, 2, 6, 2))
  })

  it('drops a panel into free space beside its neighbour without moving it', () => {
    const layout = layoutOf({ a: at(0, 0, 6, 2), b: at(0, 2, 6, 2) })
    const out = applyMove(layout, 'b', at(6, 0, 6, 2), uniform())
    expect(out.rects).toEqual({ a: at(0, 0, 6, 2), b: at(6, 0, 6, 2) })
  })

  it('pushes a chain of neighbours down rather than swapping any of them', () => {
    const layout = layoutOf({ a: at(0, 0, 12, 2), b: at(0, 2, 12, 2), c: at(0, 4, 12, 2) })
    const out = applyMove(layout, 'c', at(0, 0, 12, 2), uniform())
    expect(out.rects.c).toEqual(at(0, 0, 12, 2))
    expect(out.rects.a).toEqual(at(0, 2, 12, 2))
    expect(out.rects.b).toEqual(at(0, 4, 12, 2))
  })

  it('clamps a candidate dragged past the right edge instead of wrapping it', () => {
    const out = applyMove(layoutOf({ a: at(0, 0, 4, 2) }), 'a', at(11, 0, 4, 2), uniform())
    expect(out.rects.a).toEqual(at(8, 0, 4, 2))
  })
})

describe('applyResize', () => {
  it('pushes an overlapped neighbour right when the panel widens', () => {
    const layout = layoutOf({ a: at(0, 0, 4, 2), b: at(4, 0, 4, 2) })
    const out = applyResize(layout, 'a', at(0, 0, 6, 2), uniform())
    expect(out.rects.a).toEqual(at(0, 0, 6, 2))
    expect(out.rects.b).toEqual(at(6, 0, 4, 2))
  })

  it('stops the handle at the widest width whose push chain still fits — never wraps a neighbour', () => {
    const layout = layoutOf({ a: at(0, 0, 4, 2), b: at(4, 0, 4, 2), c: at(8, 0, 4, 2) })
    const out = applyResize(layout, 'a', at(0, 0, 9, 2), uniform())
    expect(out.rects.a).toEqual(at(0, 0, 4, 2))
    expect(out.rects.b).toEqual(at(4, 0, 4, 2))
    expect(out.rects.c).toEqual(at(8, 0, 4, 2))
  })

  it('takes the space a neighbour can still be pushed into', () => {
    const layout = layoutOf({ a: at(0, 0, 4, 2), b: at(4, 0, 4, 2) })
    const out = applyResize(layout, 'a', at(0, 0, 9, 2), uniform())
    expect(out.rects.a).toEqual(at(0, 0, 8, 2))
    expect(out.rects.b).toEqual(at(8, 0, 4, 2))
  })

  it('pushes down, unbounded, when the panel grows taller', () => {
    const layout = layoutOf({ a: at(0, 0, 6, 2), b: at(0, 2, 6, 2) })
    const out = applyResize(layout, 'a', at(0, 0, 6, 5), uniform())
    expect(out.rects.a).toEqual(at(0, 0, 6, 5))
    expect(out.rects.b).toEqual(at(0, 5, 6, 2))
  })

  it('refuses to shrink a panel below its view kind minimum', () => {
    const out = applyResize(layoutOf({ a: at(0, 0, 6, 4) }), 'a', at(0, 0, 1, 1), uniform(size({ minW: 4, minH: 3 })))
    expect(out.rects.a).toEqual(at(0, 0, 4, 3))
  })
})

describe('sizeFor', () => {
  it('gives a board the full width and a stat a corner', () => {
    expect(sizeFor('board').w).toBe(COLS)
    expect(sizeFor('stat').w).toBeLessThan(sizeFor('table').w)
  })

  it('falls back for a view kind this build cannot draw, so an inert panel still has a rect', () => {
    expect(sizeFor('sankey-diagram')).toEqual(sizeFor('list'))
  })
})

describe('the wizard size presets', () => {
  it('offers three widths over the kind\'s own defaults, at the kind\'s height', () => {
    const presets = sizePresets('stat')
    expect([presets.s.w, presets.m.w, presets.l.w]).toEqual([sizeFor('stat').minW, sizeFor('stat').w, COLS])
    expect([presets.s.h, presets.m.h, presets.l.h]).toEqual([sizeFor('stat').h, sizeFor('stat').h, sizeFor('stat').h])
  })

  it('never offers a rect below the kind\'s minimum or past the grid', () => {
    for (const kind of ['stat', 'list', 'table', 'board', 'chart', 'made-up']) {
      const size = sizeFor(kind)
      for (const rect of Object.values(sizePresets(kind))) {
        expect(rect.w).toBeGreaterThanOrEqual(size.minW)
        expect(rect.w).toBeLessThanOrEqual(COLS)
        expect(rect.h).toBeGreaterThanOrEqual(size.minH)
      }
    }
  })

  it('is a starting rect the ordinary path accepts, not a shape of its own', () => {
    // The commit runs through `normalize` like every other rect, so a preset can never produce a
    // layout the grid would refuse.
    const layout = normalize({ order: ['a'], rects: { a: sizePresets('board').l } }, () => sizeFor('board'))
    expect(layout.rects.a).toEqual({ x: 0, y: 0, w: COLS, h: sizeFor('board').h })
  })
})

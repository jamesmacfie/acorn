import { describe, expect, it } from 'vitest'
import { applyRailOrder, EMPTY_RAIL_ORDER, moveTask, parseRailOrder, pinTask, serializeRailOrder, unpinTask } from './railOrder'

const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

describe('applyRailOrder', () => {
  it('keeps tasks.sort order with no prefs', () => {
    expect(applyRailOrder(tasks, EMPTY_RAIL_ORDER).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('partitions pinned first, then manual order, then unknowns', () => {
    const order = { pinned: ['c'], order: ['b'] }
    expect(applyRailOrder(tasks, order).map((t) => t.id)).toEqual(['c', 'b', 'a', 'd'])
  })
  it('ignores stale ids in the pref', () => {
    const order = { pinned: ['gone'], order: ['also-gone', 'b'] }
    expect(applyRailOrder(tasks, order).map((t) => t.id)).toEqual(['b', 'a', 'c', 'd'])
  })
})

describe('pin/unpin', () => {
  it('pin moves the id to the pinned partition; unpin returns it to the top of the rest', () => {
    let o = pinTask(EMPTY_RAIL_ORDER, 'c')
    expect(applyRailOrder(tasks, o).map((t) => t.id)).toEqual(['c', 'a', 'b', 'd'])
    o = unpinTask(o, 'c')
    expect(o.pinned).toEqual([])
    expect(applyRailOrder(tasks, o).map((t) => t.id)).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('moveTask (drag-reorder)', () => {
  it('reorders within the unpinned partition', () => {
    const visible = ['a', 'b', 'c', 'd']
    const o = moveTask(EMPTY_RAIL_ORDER, visible, 'd', 'b')
    expect(applyRailOrder(tasks, o).map((t) => t.id)).toEqual(['a', 'd', 'b', 'c'])
  })
  it('dragging onto a pinned row pins the task', () => {
    const start = pinTask(EMPTY_RAIL_ORDER, 'a')
    const visible = applyRailOrder(tasks, start).map((t) => t.id)
    const o = moveTask(start, visible, 'c', 'a')
    expect(o.pinned).toEqual(['c', 'a'])
  })
  it('null beforeId drops at the end', () => {
    const visible = ['a', 'b', 'c', 'd']
    const o = moveTask(EMPTY_RAIL_ORDER, visible, 'a', null)
    expect(applyRailOrder(tasks, o).map((t) => t.id)).toEqual(['b', 'c', 'd', 'a'])
  })
})

describe('persistence round-trip', () => {
  it('serialize → parse is identity; junk parses to empty', () => {
    const o = { pinned: ['x'], order: ['y', 'z'] }
    expect(parseRailOrder(serializeRailOrder(o))).toEqual(o)
    expect(parseRailOrder(undefined)).toEqual(EMPTY_RAIL_ORDER)
    expect(parseRailOrder('{bad')).toEqual(EMPTY_RAIL_ORDER)
    expect(parseRailOrder('{"pinned":"no","order":[1,"ok"]}')).toEqual({ pinned: [], order: ['ok'] })
  })
})

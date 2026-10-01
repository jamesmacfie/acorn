import { describe, expect, it } from 'vitest'
import { applyRailOrder, applySourceOrder, EMPTY_RAIL_ORDER, moveTask, parseRailOrder, pinTask, serializeRailOrder, unpinTask } from './railOrder'

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
  it('places a task before another task', () => {
    const visible = ['a', 'b', 'c', 'd']
    const o = moveTask(EMPTY_RAIL_ORDER, visible, 'd', 'b', 'before')
    expect(applyRailOrder(tasks, o).map((t) => t.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('places a task after another task', () => {
    const visible = ['a', 'b', 'c', 'd']
    const o = moveTask(EMPTY_RAIL_ORDER, visible, 'a', 'b', 'after')
    expect(applyRailOrder(tasks, o).map((t) => t.id)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('can place a task after the final task', () => {
    const visible = ['a', 'b', 'c', 'd']
    const o = moveTask(EMPTY_RAIL_ORDER, visible, 'a', 'd', 'after')
    expect(applyRailOrder(tasks, o).map((t) => t.id)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('preserves another workspace order when tasks are dragged in both workspaces', () => {
    const first = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]
    const second = [{ id: 'b1' }, { id: 'b2' }]
    const firstOrder = moveTask(EMPTY_RAIL_ORDER, first.map((task) => task.id), 'a3', 'a1', 'before')
    const secondOrder = moveTask(firstOrder, second.map((task) => task.id), 'b2', 'b1', 'before')

    expect(applyRailOrder(first, secondOrder).map((task) => task.id)).toEqual(['a3', 'a1', 'a2'])
    expect(applyRailOrder(second, secondOrder).map((task) => task.id)).toEqual(['b2', 'b1'])
  })

  it('preserves pinned and unpinned ids outside the current rail', () => {
    const saved = { pinned: ['a1', 'b1'], order: ['a2', 'b2'] }
    const next = moveTask(saved, ['b1', 'b2'], 'b2', 'b1', 'before')

    expect(next).toEqual({ pinned: ['a1', 'b2', 'b1'], order: ['a2'] })
  })

  it('dragging before a pinned row pins the task', () => {
    const start = pinTask(EMPTY_RAIL_ORDER, 'a')
    const visible = applyRailOrder(tasks, start).map((t) => t.id)
    const o = moveTask(start, visible, 'c', 'a', 'before')
    expect(o.pinned).toEqual(['c', 'a'])
  })

  it('dragging after a pinned row keeps the task in the pinned partition', () => {
    const start = pinTask(EMPTY_RAIL_ORDER, 'a')
    const visible = applyRailOrder(tasks, start).map((t) => t.id)
    const o = moveTask(start, visible, 'c', 'a', 'after')
    expect(o.pinned).toEqual(['a', 'c'])
  })
})

describe('persistence round-trip', () => {
  it('keeps source order separate from task order across old and new prefs', () => {
    const older = parseRailOrder('{"pinned":["task-a"],"order":["task-b"]}')
    const sources = [{ id: 'home' }, { id: 'github' }, { id: 'fleet' }]
    expect(applySourceOrder(sources, older).map((entry) => entry.id)).toEqual(['home', 'github', 'fleet'])
    const chosen = { ...older, sources: ['fleet', 'home'] }
    expect(applySourceOrder(sources, parseRailOrder(serializeRailOrder(chosen))).map((entry) => entry.id))
      .toEqual(['fleet', 'home', 'github'])
    expect(moveTask(chosen, ['task-a', 'task-b'], 'task-b', 'task-a', 'before').sources).toEqual(chosen.sources)
  })

  it('serialize → parse is identity; junk parses to empty', () => {
    const o = { pinned: ['x'], order: ['y', 'z'] }
    expect(parseRailOrder(serializeRailOrder(o))).toEqual(o)
    expect(parseRailOrder(undefined)).toEqual(EMPTY_RAIL_ORDER)
    expect(parseRailOrder('{bad')).toEqual(EMPTY_RAIL_ORDER)
    expect(parseRailOrder('{"pinned":"no","order":[1,"ok"]}')).toEqual({ pinned: [], order: ['ok'] })
  })
})

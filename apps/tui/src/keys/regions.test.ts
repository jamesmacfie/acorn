import { beforeEach, describe, expect, it } from 'vitest'
import type { Renderable } from '@opentui/core'
import {
  _resetRegions, claimIfProvisional, focusedRenderable, markItem, moveColumn, moveRegion,
  registerRegion,
} from './regions'

// Fakes rather than a rendered shell, because what is under test is bookkeeping: which node a region
// hands the keys to when you walk into it. The real thing is exercised end to end in ../browse.test.tsx.
const node = (children: Renderable[] = []): Renderable => ({
  parent: null,
  visible: true,
  focusable: false,
  isDestroyed: false,
  getChildren: () => children,
  focus() {},
} as unknown as Renderable)

describe('moveRegion', () => {
  beforeEach(_resetRegions)

  it('lands on a row that arrived after the region was first entered', () => {
    const menu = node()
    const rows: Renderable[] = []
    const browse = node(rows)
    registerRegion(menu, { paneId: 'chrome', regionId: 'menu' }, 0)
    registerRegion(browse, { paneId: 'chrome', regionId: 'browse' }, 1)

    // Into Browse while it is still empty: the frame itself is the only stop there is.
    moveRegion(1)
    expect(focusedRenderable()).toBe(browse)

    // Out, the list arrives, back in. Before this was fixed the frame stayed focused for the rest of
    // the run, so the border lit and `j` did nothing.
    moveRegion(1)
    const row = node()
    rows.push(row)
    markItem(row)
    moveRegion(1)
    expect(focusedRenderable()).toBe(row)
  })

  it('selects a row when entering an opted-in region, including after a late mount', () => {
    const menu = node()
    const rows: Renderable[] = []
    const browse = node(rows)
    const main = node()
    let picked = 0
    registerRegion(menu, { paneId: 'chrome', regionId: 'menu' }, -130, { column: 'rail' })
    registerRegion(
      browse,
      { paneId: 'chrome', regionId: 'browse' },
      -120,
      { column: 'rail', pickOnEnter: true },
    )
    registerRegion(main, { paneId: 'chrome', regionId: 'source' }, 0)

    // Browse opens before its query has produced a row, so its frame provisionally holds focus.
    moveRegion(1)
    expect(focusedRenderable()).toBe(browse)

    const row = node()
    row.parent = browse
    rows.push(row)
    markItem(row, () => { picked += 1 })
    expect(claimIfProvisional(row)).toBe(true)
    expect(focusedRenderable()).toBe(row)
    expect(picked).toBe(1)

    // Leaving and coming home restores and selects the remembered row through the same handler.
    expect(moveColumn(1)).toBe(true)
    expect(focusedRenderable()).toBe(main)
    expect(moveColumn(-1)).toBe(true)
    expect(focusedRenderable()).toBe(row)
    expect(picked).toBe(2)
  })

  it('moves between declared columns without wrapping', () => {
    const menu = node()
    const railRow = node()
    const rail = node([railRow])
    railRow.parent = rail
    const mainRow = node()
    const main = node([mainRow])
    mainRow.parent = main
    markItem(railRow)
    markItem(mainRow)
    registerRegion(menu, { paneId: 'chrome', regionId: 'menu' }, -130, { column: 'rail' })
    registerRegion(rail, { paneId: 'chrome', regionId: 'browse' }, -120, { column: 'rail' })
    registerRegion(main, { paneId: 'chrome', regionId: 'source' }, 0)

    moveRegion(1)
    expect(focusedRenderable()).toBe(railRow)
    expect(moveColumn(-1)).toBe(false)
    expect(moveColumn(1)).toBe(true)
    expect(focusedRenderable()).toBe(mainRow)
    expect(moveColumn(1)).toBe(false)
    expect(moveColumn(-1)).toBe(true)
    expect(focusedRenderable()).toBe(railRow)
  })
})

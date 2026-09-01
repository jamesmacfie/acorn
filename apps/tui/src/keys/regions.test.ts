import { beforeEach, describe, expect, it } from 'vitest'
import type { Renderable } from '@opentui/core'
import { _resetRegions, focusedRenderable, markItem, moveRegion, registerRegion } from './regions'

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
})

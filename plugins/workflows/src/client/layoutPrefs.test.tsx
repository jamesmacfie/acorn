import { beforeEach, describe, expect, it } from 'vitest'
import { forgetLayout, forgetNodeInLayout, layoutKey, readLayout, renameInLayout, writeLayout } from './layoutPrefs'

// Where the graph view's cards sit, per device (docs/workflows.md § Where positions live).
//
// In the jsdom tier rather than beside the pure draft tests, because the thing under test is
// `localStorage`: under bare Node there is nowhere to keep a scrap and every one of these reads
// would honestly answer with nothing.

const DEF = 'db:abc'

beforeEach(() => localStorage.clear())

describe('node positions', () => {
  it('keeps and reads back what was put down', () => {
    writeLayout(DEF, { investigate: { x: 44, y: 22 } })
    expect(readLayout(DEF)).toEqual({ investigate: { x: 44, y: 22 } })
  })

  it('survives a rename, because the card did not move — its name did', () => {
    writeLayout(DEF, { investigate: { x: 44, y: 22 }, review: { x: 0, y: 152 } })
    renameInLayout(DEF, 'investigate', 'reproduce')
    expect(readLayout(DEF)).toEqual({ review: { x: 0, y: 152 }, reproduce: { x: 44, y: 22 } })
  })

  it('drops a node with the node, and a layout with the definition', () => {
    writeLayout(DEF, { investigate: { x: 44, y: 22 }, review: { x: 0, y: 152 } })
    forgetNodeInLayout(DEF, 'review')
    expect(readLayout(DEF)).toEqual({ investigate: { x: 44, y: 22 } })
    forgetLayout(DEF)
    expect(readLayout(DEF)).toEqual({})
    expect(localStorage.getItem(layoutKey(DEF))).toBe(null)
  })

  it('answers with nothing for a key holding something that is not a layout', () => {
    localStorage.setItem(layoutKey(DEF), '{"investigate":"over there"}')
    expect(readLayout(DEF)).toEqual({})
    localStorage.setItem(layoutKey(DEF), 'not json')
    expect(readLayout(DEF)).toEqual({})
  })
})

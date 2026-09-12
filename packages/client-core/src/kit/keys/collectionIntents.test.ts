import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollectionIntents, PAGE } from './collectionIntents'
import { _resetCollectionState } from './collectionState'

// The rules about a list, with no host under them.
//
// This file is shared: both hosts read it for what wraps, where the first press lands, which of
// select and activate picks, and what the page keys move by (docs/tui.md § Collections). It had no
// test of its own, and the one that was owed is about what a handler *returns* — because that is what
// decides whether the key stops here or carries on to the next layer
// (docs/command-palette-and-shortcuts.md § Focus and typing).
//
// The host's own share is two functions, so a test supplies two: `land`, which would put focus on an
// item, and `onItem`, which says whether the item itself holds focus. Neither needs a DOM, and this
// package has no DOM environment by design.

const ITEMS = [
  { key: 'src', label: 'src' },
  { key: 'readme', label: 'README.md' },
]

const tree = (onExpand?: (key: string, expand: boolean) => boolean | void) => createCollectionIntents({
  id: () => 'tree',
  items: () => ITEMS,
  land: () => {},
  onItem: () => true,
  ...(onExpand ? { onExpand } : {}),
})

beforeEach(_resetCollectionState)

describe('expand and collapse say whether the row folded', () => {
  it('hands the key back when the handler says the row did not fold', () => {
    // A file has nothing to open, so Right on one is not the tree's key. Saying so is what lets the
    // tier below answer it — in the terminal that is the column move, which takes the reader from the
    // file tree to the document beside it (plugins/editor/src/client/FileTree.tsx).
    const onExpand = vi.fn(() => false)
    const keys = tree(onExpand)
    expect(keys.handle('expand')).toBe(false)
    expect(keys.handle('collapse')).toBe(false)
    expect(onExpand).toHaveBeenCalledTimes(2)
    expect(onExpand.mock.calls.map((call) => call)).toEqual([['src', true], ['src', false]])
  })

  it('claims the key when the handler returns nothing, so a caller that has not opted in is unchanged', () => {
    // `?? true`, which is the whole compatibility story: every DOM tree in the app returns `void`
    // today and keeps the behaviour it has. A caller opts into the honest answer by returning one.
    const keys = tree(() => undefined)
    expect(keys.handle('expand')).toBe(true)
    expect(keys.handle('collapse')).toBe(true)
  })

  it('claims the key when the handler says the row folded', () => {
    const keys = tree(() => true)
    expect(keys.handle('expand')).toBe(true)
    expect(keys.handle('collapse')).toBe(true)
  })

  it('hands the key back when the collection has no fold at all', () => {
    // A plain list, which is most of them. Nothing here changes: with no handler there was never
    // anything to claim.
    const keys = tree()
    expect(keys.handle('expand')).toBe(false)
    expect(keys.handle('collapse')).toBe(false)
  })

  it('moves instead of folding when the collection is horizontal', () => {
    // A tab strip's Left and Right are its arrows, not a fold, and that comes first: a horizontal
    // collection never asks the handler at all.
    const onExpand = vi.fn(() => false)
    const keys = createCollectionIntents({
      id: () => 'tabs',
      items: () => ITEMS,
      orientation: 'horizontal',
      land: () => {},
      onItem: () => true,
      onExpand,
    })
    expect(keys.handle('expand')).toBe(true)
    expect(keys.active()).toBe('readme')
    expect(onExpand).not.toHaveBeenCalled()
  })
})

describe('a page key stops at the end of the list', () => {
  // Clamped, where the arrows above it wrap. Modulo a list shorter than a page is a key that lies:
  // in a three-row list PageDown moved one row, and in a list of exactly `PAGE` rows it moved
  // nowhere, which a reader cannot tell from a dead key. Returning `false` at the edge is the other
  // half of it, because it hands the key to the tier below, where a scrolling viewport does what the
  // reader asked for (docs/tui.md § Scrolling viewports).
  //
  // The desktop gets this too, and that is intended: PageDown on the last row of a desktop list now
  // stops instead of wrapping round to the first.
  const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ key: `row-${index}` }))

  const list = (count: number) => createCollectionIntents({
    id: () => 'rows',
    items: () => rows(count),
    land: () => {},
    onItem: () => true,
  })

  it('lands on the last row from the middle of a list shorter than a page', () => {
    const keys = list(3)
    expect(keys.handle('pageNext')).toBe(true)
    expect(keys.active()).toBe('row-2')
  })

  it('hands the key back once the caret is on the last row', () => {
    const keys = list(3)
    keys.goTo('row-2')
    expect(keys.handle('pageNext')).toBe(false)
    expect(keys.active()).toBe('row-2')
  })

  it('hands the key back once the caret is on the first row', () => {
    const keys = list(3)
    expect(keys.active()).toBe('row-0')
    expect(keys.handle('pagePrev')).toBe(false)
    expect(keys.active()).toBe('row-0')
  })

  it('moves a whole page in a list with more than a page left in it', () => {
    // The unclamped case, so the clamp is not quietly a wall everywhere.
    const keys = list(PAGE * 3)
    expect(keys.handle('pageNext')).toBe(true)
    expect(keys.active()).toBe(`row-${PAGE}`)
    expect(keys.handle('pagePrev')).toBe(true)
    expect(keys.active()).toBe('row-0')
  })
})

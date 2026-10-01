import { describe, expect, it } from 'vitest'
import { overlaps, pageClip } from './overlayGeometry'

describe('native overlay geometry', () => {
  const page = { x: 100, y: 100, width: 600, height: 400 }
  it('detects partial upper-edge overlap and passive tooltip bounds', () => {
    expect(overlaps(page, { x: 90, y: 90, width: 100, height: 30 })).toBe(true)
    expect(overlaps(page, { x: 90, y: 70, width: 100, height: 30 })).toBe(false)
    expect(overlaps(page, { x: 200, y: 200, width: 0, height: 30 })).toBe(false)
  })
  it('converts window content bounds to the owning DOM branch without changing the page viewport', () => {
    expect(pageClip({ x: 10, y: 20, width: 900, height: 700 }, [page]))
      .toBe('path(evenodd, "M0,0h900v700h-900ZM90,80h600v400h-600Z")')
  })
  it('does not fill an overlapping or duplicate native page rectangle', () => {
    const viewport = { x: 0, y: 0, width: 900, height: 700 }
    expect(pageClip(viewport, [page, page])).toBe(pageClip(viewport, [page]))
    expect(pageClip(viewport, [{ x: 100, y: 100, width: 100, height: 100 }, { x: 150, y: 150, width: 100, height: 100 }]))
      .toBe('path(evenodd, "M0,0h900v700h-900ZM100,100h50v100h-50ZM150,100h50v150h-50ZM200,150h50v100h-50Z")')
  })
})
